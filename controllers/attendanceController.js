const pool = require('../config/db');
const util = require('util');

const queryAsync = util.promisify(pool.query).bind(pool);

const markAttendance = async (req, res) => {
  const { employee_id, date, login_time, logout_time, recipient, location } = req.body;
  const { role, id } = req.user;
  if (!employee_id || !date || !login_time || !recipient || !location) {
    return res.status(400).json({ error: 'Date, login time, recipient, and location are required' });
  }

  if (!['super_admin', 'hr'].includes(recipient)) {
    return res.status(400).json({ error: "Invalid recipient. Must be 'super_admin' or 'hr'" });
  }

  if (!['Office', 'Remote'].includes(location)) {
    return res.status(400).json({ error: "Invalid location. Must be 'Office' or 'Remote'" });
  }

  if (logout_time) {
    const login = new Date(`1970-01-01T${login_time}:00`);
    const logout = new Date(`1970-01-01T${logout_time}:00`);
    if (isNaN(login) || isNaN(logout)) {
      return res.status(400).json({ error: 'Invalid login or logout time format' });
    }
    if (logout <= login) {
      return res.status(400).json({ error: 'Logout time must be after login time' });
    }
  }

  try {
    let userTable;
    if (role === 'super_admin') userTable = 'hrms_users';
    else if (role === 'hr') userTable = 'hrs';
    else if (role === 'dept_head') userTable = 'dept_heads';
    else userTable = 'employees';

    const [user] = await queryAsync(`SELECT employee_id FROM ${userTable} WHERE id = ?`, [id]);
    if (!user || (user.employee_id !== employee_id && !['super_admin', 'hr'].includes(role))) {
      return res.status(403).json({ error: 'Unauthorized to mark attendance for this employee' });
    }

    const [existingAttendance] = await queryAsync(
      'SELECT * FROM attendance WHERE employee_id = ? AND date = ?',
      [employee_id, date]
    );
    if (existingAttendance) {
      return res.status(400).json({ error: 'Attendance already marked for this date' });
    }

    const status = ['hr', 'super_admin'].includes(role) ? 'Approved' : 'Pending';

    const query = `
      INSERT INTO attendance (employee_id, date, login_time, logout_time, status, recipient, location, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const values = [employee_id, date, login_time, logout_time || null, status, recipient, location];

    const result = await queryAsync(query, values);

    res.status(201).json({
      message: `Attendance marked successfully${status === 'Approved' ? ' and auto-approved' : ''}`,
      data: {
        id: result.insertId,
        employee_id,
        date,
        login_time,
        logout_time,
        recipient,
        location,
        status,
      },
    });
  } catch (err) {
    console.error('DB error in markAttendance:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const fetchEmployeeAttendance = async (req, res) => {
  const { role, id } = req.user;

  try {
    let userTable;
    if (role === 'super_admin') userTable = 'hrms_users';
    else if (role === 'hr') userTable = 'hrs';
    else if (role === 'dept_head') userTable = 'dept_heads';
    else userTable = 'employees';

    const [user] = await queryAsync(`SELECT employee_id, full_name FROM ${userTable} WHERE id = ?`, [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const attendance = await queryAsync(
      `SELECT id, employee_id, date, login_time, logout_time, recipient, location, status, created_at
       FROM attendance WHERE employee_id = ? ORDER BY date DESC`,
      [user.employee_id]
    );

    res.json({
      message: 'Attendance records fetched successfully',
      data: attendance.map((record) => ({
        ...record,
        employee_name: user.full_name,
      })),
    });
  } catch (err) {
    console.error('DB error in fetchEmployeeAttendance:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

const fetchAllAttendance = async (req, res) => {
  const { role, id } = req.user;

  if (!['super_admin', 'hr', 'dept_head'].includes(role)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  try {
    let query = `
      SELECT a.id, a.employee_id, DATE_FORMAT(a.date, '%Y-%m-%d') AS date, a.login_time, a.logout_time, a.recipient, a.location, a.status, a.created_at,
             COALESCE(e.full_name, h.full_name, d.full_name, u.full_name) AS employee_name,
             COALESCE(e.department_name, d.department_name, h.department_name, u.department_name) AS department_name
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.employee_id
      LEFT JOIN hrs h ON a.employee_id = h.employee_id
      LEFT JOIN dept_heads d ON a.employee_id = d.employee_id
      LEFT JOIN hrms_users u ON a.employee_id = u.employee_id
    `;
    let params = [];

    if (role === 'dept_head') {
      const [deptHead] = await queryAsync(
        'SELECT department_name FROM dept_heads WHERE id = ?',
        [id]
      );
      if (!deptHead) {
        return res.status(403).json({ error: 'Access denied: Not a department head' });
      }
      query += ' WHERE (e.department_name = ? OR d.department_name = ? OR h.department_name = ? OR u.department_name = ?) AND a.recipient = ? ORDER BY a.date DESC';
      params = [deptHead.department_name, deptHead.department_name, deptHead.department_name, deptHead.department_name, 'hr'];
    } else {
      query += ' WHERE a.recipient = ? ORDER BY a.date DESC';
      params = [role];
    }

    const attendance = await queryAsync(query, params);

    res.json({
      message: 'All attendance records fetched successfully',
      data: attendance,
    });
  } catch (err) {
    console.error('DB error in fetchAllAttendance:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

const updateAttendanceStatus = async (req, res) => {
  const { role, id } = req.user;
  const { id: attendanceId } = req.params;
  const { status } = req.body;

  if (!['super_admin', 'hr'].includes(role)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be 'Approved' or 'Rejected'" });
  }

  try {
    const [attendance] = await queryAsync(
      'SELECT * FROM attendance WHERE id = ? AND recipient = ?',
      [attendanceId, role]
    );
    if (!attendance) {
      return res.status(404).json({ error: 'Attendance record not found or not authorized' });
    }

    if (attendance.status !== 'Pending') {
      return res.status(400).json({ error: 'Only pending records can be updated' });
    }

    const query = 'UPDATE attendance SET status = ? WHERE id = ?';
    const result = await queryAsync(query, [status, attendanceId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Attendance record not found' });
    }

    res.json({
      message: `Attendance ${status.toLowerCase()} successfully`,
      data: { id: attendanceId, status },
    });
  } catch (err) {
    console.error('DB error in updateAttendanceStatus:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

const getEmployeeAverageWorkingHours = async (req, res) => {
  const { role, id } = req.user;
  const { employeeId } = req.params;
  const { start_date, end_date } = req.query;

  if (!['super_admin', 'hr', 'employee'].includes(role)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  if (role === 'employee') {
    const [user] = await queryAsync(
      `SELECT employee_id FROM employees WHERE id = ?`,
      [id]
    );
    if (!user || user.employee_id !== employeeId) {
      return res.status(403).json({
        error: 'Access denied: You can only view your own working hours',
      });
    }
  }

  try {
    const [employee] = await queryAsync(
      `SELECT COALESCE(e.full_name, h.full_name, d.full_name, u.full_name, 'Unknown') AS employee_name
       FROM attendance a
       LEFT JOIN employees e ON a.employee_id = e.employee_id
       LEFT JOIN hrs h ON a.employee_id = h.employee_id
       LEFT JOIN dept_heads d ON a.employee_id = d.employee_id
       LEFT JOIN hrms_users u ON a.employee_id = u.employee_id
       WHERE a.employee_id = ? LIMIT 1`,
      [employeeId]
    );
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    let query = `
      SELECT 
        DATE_FORMAT(a.date, '%Y-%m-%d') AS date,
        a.login_time,
        a.logout_time,
        COALESCE(CAST(TIMESTAMPDIFF(SECOND, a.login_time, a.logout_time) / 3600 AS DECIMAL(10,2)), 0) AS hours_worked
      FROM attendance a
      WHERE a.employee_id = ? 
        AND a.status = 'Approved' 
        AND a.login_time IS NOT NULL 
        AND a.logout_time IS NOT NULL
    `;
    let params = [employeeId];

    if (start_date && end_date) {
      query += ' AND a.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY a.date';

    const attendance = await queryAsync(query, params);
    console.log('Raw attendance data for employee', employeeId, ':', attendance); // Debug

    if (attendance.length === 0) {
      return res.status(200).json({
        message: 'No approved attendance records found for this employee',
        data: {
          employee_id: employeeId,
          employee_name: employee.employee_name,
          average_working_hours: 0,
          days_counted: 0,
          trend_data: [],
        },
      });
    }

    const totalHours = attendance.reduce((sum, record) => sum + (parseFloat(record.hours_worked) || 0), 0);
    const averageHours = totalHours / attendance.length;

    const trendData = attendance.map(record => ({
      date: record.date,
      hours: parseFloat(record.hours_worked) || 0,
    }));

    res.json({
      message: 'Average working hours fetched successfully',
      data: {
        employee_id: employeeId,
        employee_name: employee.employee_name,
        average_working_hours: parseFloat(averageHours.toFixed(2)) || 0,
        days_counted: attendance.length,
        trend_data: trendData,
      },
    });
  } catch (err) {
    console.error('DB error in getEmployeeAverageWorkingHours:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};


const getAllEmployeesTotalWorkingHours = async (req, res) => {
  const { role, id } = req.user;
  const { start_date, end_date } = req.query;

  if (!['super_admin', 'hr', 'dept_head'].includes(role)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  try {
    let query = `
      SELECT 
        a.employee_id,
        COALESCE(e.full_name, h.full_name, d.full_name, u.full_name, 'Unknown') AS employee_name,
        COALESCE(e.department_name, d.department_name, h.department_name, u.department_name, 'N/A') AS department_name,
        COALESCE(CAST(SUM(TIMESTAMPDIFF(SECOND, a.login_time, a.logout_time) / 3600) AS DECIMAL(10,2)), 0) AS total_working_hours
      FROM attendance a
      LEFT JOIN employees e ON a.employee_id = e.employee_id
      LEFT JOIN hrs h ON a.employee_id = h.employee_id
      LEFT JOIN dept_heads d ON a.employee_id = d.employee_id
      LEFT JOIN hrms_users u ON a.employee_id = u.employee_id
      WHERE a.status = 'Approved' 
        AND a.login_time IS NOT NULL 
        AND a.logout_time IS NOT NULL
    `;
    let params = [];

    if (start_date && end_date) {
      query += ' AND a.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    if (role === 'dept_head') {
      const [deptHead] = await queryAsync(
        'SELECT department_name FROM dept_heads WHERE id = ?',
        [id]
      );
      if (!deptHead) {
        return res.status(403).json({ error: 'Access denied: Not a department head' });
      }
      query += ' AND (e.department_name = ? OR d.department_name = ? OR h.department_name = ? OR u.department_name = ?)';
      params.push(deptHead.department_name, deptHead.department_name, deptHead.department_name, deptHead.department_name);
    }

    query += ' GROUP BY a.employee_id, employee_name, department_name';

    const attendance = await queryAsync(query, params);
    console.log('Raw attendance data for all employees:', attendance); // Debug

    const result = attendance.map(record => ({
      employee_id: record.employee_id,
      employee_name: record.employee_name,
      department_name: record.department_name,
      total_working_hours: parseFloat(record.total_working_hours) || 0,
    }));

    res.json({
      message: 'Total working hours for all employees fetched successfully',
      data: result,
    });
  } catch (err) {
    console.error('DB error in getAllEmployeesTotalWorkingHours:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};


const getTotalAverageWorkingHours = async (req, res) => {
  const { role } = req.user;
  const { start_date, end_date } = req.query;

  if (!['super_admin', 'hr'].includes(role)) {
    return res.status(403).json({ error: 'Access denied: Super admin or HR only' });
  }

  try {
    let query = `
      SELECT 
        a.date,
        COUNT(DISTINCT a.employee_id) AS employee_count,
        COALESCE(CAST(AVG(TIMESTAMPDIFF(SECOND, a.login_time, a.logout_time) / 3600) AS DECIMAL(10,2)), 0) AS total_average_working_hours
      FROM attendance a
      WHERE a.status = 'Approved' 
        AND a.login_time IS NOT NULL 
        AND a.logout_time IS NOT NULL
    `;
    let params = [];

    if (start_date && end_date) {
      query += ' AND a.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' GROUP BY a.date ORDER BY a.date';

    const attendance = await queryAsync(query, params);
    console.log('Raw attendance data for total average:', attendance); // Debug

    if (attendance.length === 0) {
      return res.status(200).json({
        message: 'No approved attendance records found',
        data: {
          total_average_working_hours: 0,
          total_days_counted: 0,
          employee_count: 0,
          trend_data: [],
        },
      });
    }

    const totalHours = attendance.reduce((sum, record) => sum + (parseFloat(record.total_average_working_hours) || 0), 0);
    const totalAverageHours = totalHours / attendance.length;
    const totalDays = attendance.length;
    const employeeCount = [...new Set(attendance.map(record => record.employee_id))].length;

    const trendData = attendance.map(record => ({
      date: record.date,
      hours: parseFloat(record.total_average_working_hours) || 0,
    }));

    res.json({
      message: 'Total average working hours fetched successfully',
      data: {
        total_average_working_hours: parseFloat(totalAverageHours.toFixed(2)) || 0,
        total_days_counted: totalDays,
        employee_count: employeeCount,
        trend_data: trendData,
      },
    });
  } catch (err) {
    console.error('DB error in getTotalAverageWorkingHours:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

module.exports = {
  markAttendance,
  fetchEmployeeAttendance,
  fetchAllAttendance,
  updateAttendanceStatus,
  getEmployeeAverageWorkingHours,
  getAllEmployeesTotalWorkingHours,
  getTotalAverageWorkingHours,
};