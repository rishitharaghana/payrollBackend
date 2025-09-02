const pool = require('../config/db');
const cron = require('node-cron');
const util = require('util');
const { Server } = require('socket.io');

const queryAsync = util.promisify(pool.query).bind(pool);

let io;

const initializeSocket = (server, allowedOrigins) => {
  io = new Server(server, {
    cors: { origin: allowedOrigins, methods: ['GET', 'POST'], credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error: Token required'));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Authentication error: Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`WebSocket connected: ${socket.id} (User: ${socket.user.employee_id})`);

    if (['super_admin', 'hr', 'dept_head', 'manager'].includes(socket.user.role)) {
      socket.join('employer_room');
    }

    socket.on('locationUpdate', async (data) => {
      const { visitId, employeeId, latitude, longitude } = data;

      if (socket.user.role !== 'employee' || socket.user.employee_id !== employeeId) {
        socket.emit('error', { message: 'Unauthorized: Only employees can send location updates for themselves' });
        return;
      }

      try {
        const [visit] = await queryAsync(
          'SELECT id FROM site_visits WHERE id = ? AND employee_id = ? AND end_time IS NULL',
          [visitId, employeeId]
        );
        if (!visit) {
          socket.emit('error', { message: 'Invalid or inactive site visit' });
          return;
        }

        await queryAsync(
          'INSERT INTO location_logs (visit_id, employee_id, latitude, longitude, timestamp) VALUES (?, ?, ?, ?, NOW())',
          [visitId, employeeId, latitude, longitude]
        );

        io.to('employer_room').emit('employerLocationUpdate', {
          employeeId,
          latitude,
          longitude,
          visitId,
          timestamp: new Date(),
        });
      } catch (err) {
        console.error('WebSocket error:', err.message);
        socket.emit('error', { message: 'Failed to save location' });
      }
    });

    socket.on('stopTracking', async (data) => {
      const { visitId, employeeId } = data;

      if (socket.user.role !== 'employee' || socket.user.employee_id !== employeeId) {
        socket.emit('error', { message: 'Unauthorized: Only employees can stop tracking' });
        return;
      }

      try {
        const [visit] = await queryAsync(
          'SELECT start_time FROM site_visits WHERE id = ? AND employee_id = ? AND end_time IS NULL',
          [visitId, employeeId]
        );
        if (visit) {
          const endTime = new Date();
          const duration = Math.round((endTime - new Date(visit.start_time)) / (1000 * 60));
          await queryAsync(
            'UPDATE site_visits SET end_time = ?, duration_minutes = ? WHERE id = ?',
            [endTime, duration, visitId]
          );
          io.to('employer_room').emit('visitEnded', { employeeId, visitId, duration });
        }
      } catch (err) {
        console.error('WebSocket error:', err.message);
        socket.emit('error', { message: 'Failed to stop tracking' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
    });
  });
};

const startSiteVisit = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  const { site_name } = req.body;

  if (userRole !== 'employee') {
    return res.status(403).json({ error: 'Access denied: Only employees can start site visits' });
  }
  if (!site_name?.trim()) {
    return res.status(400).json({ error: 'Site name is required' });
  }

  try {
    const [activeVisit] = await queryAsync(
      'SELECT id FROM site_visits WHERE employee_id = ? AND end_time IS NULL',
      [userId]
    );
    if (activeVisit) {
      return res.status(400).json({ error: 'An active site visit is already in progress' });
    }

    const result = await queryAsync(
      'INSERT INTO site_visits (employee_id, start_time, site_name) VALUES (?, NOW(), ?)',
      [userId, site_name]
    );

    res.status(201).json({
      message: 'Site visit started successfully',
      data: { visit_id: result.insertId, employee_id: userId, site_name },
    });
  } catch (err) {
    console.error('DB error:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: 'Database error' });
  }
};

const endSiteVisit = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  const { visit_id } = req.body;

  if (userRole !== 'employee') {
    return res.status(403).json({ error: 'Access denied: Only employees can end site visits' });
  }
  if (!visit_id) {
    return res.status(400).json({ error: 'Visit ID is required' });
  }

  try {
    const [visit] = await queryAsync(
      'SELECT start_time FROM site_visits WHERE id = ? AND employee_id = ? AND end_time IS NULL',
      [visit_id, userId]
    );
    if (!visit) {
      return res.status(404).json({ error: 'Active site visit not found' });
    }

    const endTime = new Date();
    const duration = Math.round((endTime - new Date(visit.start_time)) / (1000 * 60)); 
    await queryAsync(
      'UPDATE site_visits SET end_time = ?, duration_minutes = ? WHERE id = ?',
      [endTime, duration, visit_id]
    );

    res.json({
      message: 'Site visit ended successfully',
      data: { visit_id, employee_id: userId, duration_minutes: duration },
    });
  } catch (err) {
    console.error('DB error:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: 'Database error' });
  }
};

const fetchActiveSiteVisits = async (req, res) => {
  const userRole = req.user.role;

  if (!['super_admin', 'hr', 'dept_head', 'manager'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  try {
    const visits = await queryAsync(
      `SELECT sv.id AS visit_id, sv.employee_id, sv.site_name, sv.start_time, e.full_name
       FROM site_visits sv
       JOIN employees e ON sv.employee_id = e.employee_id
       WHERE sv.end_time IS NULL`
    ); 

    res.json({
      message: 'Active site visits fetched successfully',
      data: visits,
    });
  } catch (err) {
    console.error('DB error:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: 'Database error' });
  }
};

const processSiteVisitPayroll = async () => {
  try {
    const visits = await queryAsync(
      'SELECT employee_id, SUM(duration_minutes) AS total_minutes FROM site_visits WHERE end_time IS NOT NULL AND DATE(end_time) = CURDATE() GROUP BY employee_id'
    );

    for (const visit of visits) {
      await queryAsync(
        'INSERT INTO payroll (employee_id, hours_worked, date) VALUES (?, ?, CURDATE()) ON DUPLICATE KEY UPDATE hours_worked = hours_worked + ?',
        [visit.employee_id, visit.total_minutes / 60, visit.total_minutes / 60]
      );
    }
    console.log('Payroll processing complete:', visits);
  } catch (err) {
    console.error('Cron error:', err.message);
    throw err;
  }
};

const getSiteVisitHistory = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;

  if (userRole !== 'employee') {
    return res.status(403).json({ error: 'Access denied: Only employees can view their visit history' });
  }

  try {
    const visits = await queryAsync(
      `SELECT id, site_name, start_time, end_time, duration_minutes
       FROM site_visits
       WHERE employee_id = ? AND end_time IS NOT NULL
       ORDER BY end_time DESC
       LIMIT 100`,
      [userId]
    );

    const formattedVisits = visits.map((visit) => ({
      id: visit.id,
      site_name: visit.site_name,
      start_time: visit.start_time,
      end_time: visit.end_time,
      duration: visit.duration_minutes ? `${Math.floor(visit.duration_minutes / 60)}h ${visit.duration_minutes % 60}m` : 'N/A',
    }));

    res.json({
      message: 'Site visit history fetched successfully',
      data: formattedVisits,
    });
  } catch (err) {
    console.error('DB error:', err.message, err.sqlMessage, err.code);
    if (err.code === 'ER_NO_SUCH_TABLE') {
      res.status(500).json({ error: 'Database table not found' });
    } else {
      res.status(500).json({ error: 'Database error' });
    }
  }
};
module.exports = { startSiteVisit, initializeSocket, endSiteVisit, fetchActiveSiteVisits, processSiteVisitPayroll, getSiteVisitHistory };