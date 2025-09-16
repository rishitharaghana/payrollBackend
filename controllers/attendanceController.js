const pool = require('../config/db');
const util = require('util');

const queryAsync = util.promisify(pool.query).bind(pool);

const markAttendance = async (req, res) => {
  const { employee_id, date, login_time, logout_time, recipient_id, location } = req.body;
  const { role, id } = req.user;

  console.log("markAttendance called with body:", req.body, "user:", { role, id });

  if (!employee_id || !date || !login_time || !location) {
    console.log("Validation failed. Missing fields:", {
      employee_id,
      date,
      login_time,
      location,
    });
    return res.status(400).json({ error: "Date, login time, and location are required" });
  }

  if (!["Office", "Remote"].includes(location)) {
    return res.status(400).json({ error: "Invalid location. Must be 'Office' or 'Remote'" });
  }

  if (logout_time) {
    const login = new Date(`1970-01-01T${login_time}:00`);
    const logout = new Date(`1970-01-01T${logout_time}:00`);
    if (isNaN(login) || isNaN(logout)) {
      return res.status(400).json({ error: "Invalid login or logout time format" });
    }
    if (logout <= login) {
      return res.status(400).json({ error: "Logout time must be after login time" });
    }
  }

  try {
    const [user] = await queryAsync(
      `SELECT employee_id FROM hrms_users WHERE id = ? AND role = ?`,
      [id, role]
    );
    if (!user || (user.employee_id !== employee_id && !["super_admin", "hr"].includes(role))) {
      return res.status(403).json({ error: "Unauthorized to mark attendance for this employee" });
    }

    // For HR, force recipient to be 'super_admin'
    let finalRecipientId = recipient_id;
    if (role === "hr") {
      const [superAdmin] = await queryAsync(
        `SELECT employee_id FROM hrms_users WHERE role = 'super_admin' AND status = 'active' LIMIT 1`
      );
      if (!superAdmin) {
        return res.status(400).json({ error: "No active Super Admin found" });
      }
      finalRecipientId = superAdmin.employee_id;
    } else if (role !== "super_admin") {
      // Validate recipient_id for non-HR roles
      const [recipient] = await queryAsync(
        `SELECT employee_id, full_name, role FROM hrms_users WHERE (employee_id = ? AND role = 'hr' AND status = 'active') OR (full_name = ? AND role = 'super_admin' AND status = 'active')`,
        [recipient_id, recipient_id]
      );
      if (!recipient) {
        console.log("Recipient validation failed for recipient_id:", recipient_id);
        return res.status(400).json({ error: "Invalid recipient. Must be an active HR or Super Admin" });
      }
      finalRecipientId = recipient.employee_id;
    }

    const [existingAttendance] = await queryAsync(
      "SELECT * FROM attendance WHERE employee_id = ? AND date = ?",
      [employee_id, date]
    );
    if (existingAttendance) {
      return res.status(400).json({ error: "Attendance already marked for this date" });
    }

    const status = ["hr", "super_admin"].includes(role) ? "Approved" : "Pending";

    const query = `
      INSERT INTO attendance (employee_id, date, login_time, logout_time, status, recipient, location, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const values = [
      employee_id,
      date,
      login_time,
      logout_time || null,
      status,
      finalRecipientId,
      location,
    ];

    const result = await queryAsync(query, values);

    res.status(201).json({
      message: `Attendance marked successfully${status === "Approved" ? " and auto-approved" : ""}`,
      data: {
        id: result.insertId,
        employee_id,
        date,
        login_time,
        logout_time,
        recipient_id: finalRecipientId,
        location,
        status,
      },
    });
  } catch (err) {
    console.error("DB error in markAttendance:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.sqlMessage || err.message}` });
  }
};

const fetchEmployeeAttendance = async (req, res) => {
  const { role, id } = req.user;

  try {
    const [user] = await queryAsync(
      `SELECT employee_id, full_name FROM hrms_users WHERE id = ? AND role = ?`,
      [id, role]
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const attendance = await queryAsync(
      `SELECT id, employee_id, date, login_time, logout_time, recipient AS recipient_id, location, status, 
              DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
       FROM attendance 
       WHERE employee_id = ? 
       ORDER BY date DESC 
       LIMIT 10`,
      [user.employee_id]
    );

    console.log("fetchEmployeeAttendance raw data:", attendance);

    res.json({
      message: 'Attendance records fetched successfully',
      data: {
        attendance: attendance.map((record) => ({
          id: record.id,
          employee_id: record.employee_id,
          date: record.date,
          login_time: record.login_time || 'N/A',
          logout_time: record.logout_time || 'N/A',
          status: record.status,
          recipient_id: record.recipient_id, // Changed to recipient_id
          location: record.location,
          created_at: record.created_at,
          employee_name: user.full_name,
        })),
        attendanceStatus: {
          today: attendance.find((record) => record.date === new Date().toISOString().split('T')[0])?.status || 'Not Recorded',
          lastUpdated: attendance.find((record) => record.date === new Date().toISOString().split('T')[0])?.created_at || 'N/A',
        },
      },
    });
  } catch (err) {
    console.error('DB error in fetchEmployeeAttendance:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.sqlMessage || err.message}` });
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
             u.full_name AS employee_name,
             u.department_name AS department_name
      FROM attendance a
      LEFT JOIN hrms_users u ON a.employee_id = u.employee_id
    `;
    let params = [];

    if (role === 'dept_head') {
      const [deptHead] = await queryAsync(
        'SELECT department_name FROM hrms_users WHERE id = ? AND role = ?',
        [id, 'dept_head']
      );
      if (!deptHead) {
        return res.status(403).json({ error: 'Access denied: Not a department head' });
      }
      query += ' WHERE u.department_name = ? AND a.recipient = ? ORDER BY a.date DESC';
      params = [deptHead.department_name, 'hr'];
    } else if (role === 'super_admin') {
      // Super Admin sees their own records and HR-approved records
      query += ' WHERE (a.recipient = ? OR (a.recipient = ? AND a.status = ?)) ORDER BY a.date DESC';
      params = ['super_admin', 'hr', 'Approved'];
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
      'SELECT * FROM attendance WHERE id = ? AND recipient = ? AND status = ?',
      [attendanceId, role, 'Pending']
    );
    if (!attendance) {
      return res.status(404).json({ error: 'Attendance record not found, not authorized, or not pending' });
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
      `SELECT employee_id FROM hrms_users WHERE id = ? AND role = ?`,
      [id, 'employee']
    );
    if (!user || user.employee_id !== employeeId) {
      return res.status(403).json({
        error: 'Access denied: You can only view your own working hours',
      });
    }
  }

  try {
    const [employee] = await queryAsync(
      `SELECT full_name AS employee_name
       FROM hrms_users
       WHERE employee_id = ? LIMIT 1`,
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
        u.full_name AS employee_name,
        u.department_name AS department_name,
        COALESCE(CAST(SUM(TIMESTAMPDIFF(SECOND, a.login_time, a.logout_time) / 3600) AS DECIMAL(10,2)), 0) AS total_working_hours
      FROM attendance a
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
        'SELECT department_name FROM hrms_users WHERE id = ? AND role = ?',
        [id, 'dept_head']
      );
      if (!deptHead) {
        return res.status(403).json({ error: 'Access denied: Not a department head' });
      }
      query += ' AND u.department_name = ?';
      params.push(deptHead.department_name);
    }

    query += ' GROUP BY a.employee_id, u.full_name, u.department_name';

    const attendance = await queryAsync(query, params);

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
    console.log('Raw attendance data for total average:', attendance); 

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

const getDetailedAttendance = async (req, res) => {
  const { employee_id, start_date, end_date } = req.body;
  try {
    if (!req.user || !['employee', 'dept_head', 'hr', 'super_admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
    }
    if (req.user.role === 'employee' && req.user.employee_id !== employee_id) {
      return res.status(403).json({ error: 'Access denied: Can only view own report' });
    }

    const query = `
      SELECT date, check_in, check_out, hours_worked AS hours,
             status, notes
      FROM attendance
      WHERE employee_id = ? AND date BETWEEN ? AND ?
      ORDER BY date DESC
    `;
    const [records] = await pool.query(query, [employee_id, start_date, end_date]);

    const summaryQuery = `
      SELECT 
        COALESCE(SUM(hours_worked), 0) AS total_hours,
        COALESCE(AVG(CASE WHEN status = 'Present' THEN 1 ELSE 0 END) * 100, 0) AS attendance_rate,
        COALESCE(SUM(CASE WHEN status = 'Absent' THEN 1 ELSE 0 END), 0) AS absences
      FROM attendance
      WHERE employee_id = ? AND date BETWEEN ? AND ?
    `;
    const [summary] = await pool.query(summaryQuery, [employee_id, start_date, end_date]);

    res.json({
      records,
      total_hours: summary[0].total_hours,
      attendance_rate: summary[0].attendance_rate,
      absences: summary[0].absences,
    });
  } catch (error) {
    console.error('Error fetching detailed attendance:', error);
    res.status(500).json({ error: 'An error occurred while fetching the report.' });
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
  getDetailedAttendance,
};