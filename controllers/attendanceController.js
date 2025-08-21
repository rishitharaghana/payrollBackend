const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

const markAttendance = async (req, res) => {
  const userRole = req.user.role;
  const userEmployeeId = req.user.employee_id;
  const { date, login_time, logout_time, recipient } = req.body;

  if (userRole !== "employee") {
    return res.status(403).json({ error: "Access denied: Only employees can mark attendance" });
  }

  if (!date || !login_time || !recipient) {
    return res.status(400).json({ error: "Date, login time, and recipient are required" });
  }

  if (!["super_admin", "hr"].includes(recipient)) {
    return res.status(400).json({ error: "Invalid recipient. Must be 'super_admin' or 'hr'" });
  }

  if (logout_time) {
    const login = new Date(`1970-01-01T${login_time}:00`);
    const logout = new Date(`1970-01-01T${logout_time}:00`);
    if (logout <= login) {
      return res.status(400).json({ error: "Logout time must be after login time" });
    }
  }

  try {
    const [employee] = await queryAsync(
      "SELECT * FROM employees WHERE employee_id = ?",
      [userEmployeeId]
    );
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const [existingAttendance] = await queryAsync(
      "SELECT * FROM attendance WHERE employee_id = ? AND date = ?",
      [userEmployeeId, date]
    );
    if (existingAttendance) {
      return res.status(400).json({ error: "Attendance already marked for this date" });
    }

    const query = `INSERT INTO attendance (employee_id, date, login_time, logout_time, recipient, submitted_at)
                   VALUES (?, ?, ?, ?, ?, NOW())`;
    const values = [userEmployeeId, date, login_time, logout_time || null, recipient];

    const result = await queryAsync(query, values);

    res.status(201).json({
      message: "Attendance marked successfully",
      data: {
        id: result.insertId,
        employee_id: userEmployeeId,
        date,
        login_time,
        logout_time,
        recipient,
        status: "Pending",
      },
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const fetchEmployeeAttendance = async (req, res) => {
  const userRole = req.user.role;
  const userEmployeeId = req.user.employee_id;

  if (userRole !== "employee") {
    return res.status(403).json({ error: "Access denied: Only employees can view their attendance" });
  }

  try {
    const attendance = await queryAsync(
      "SELECT id, employee_id, date, login_time, logout_time, recipient, submitted_at, status FROM attendance WHERE employee_id = ? ORDER BY date DESC",
      [userEmployeeId]
    );

    res.json({
      message: "Attendance records fetched successfully",
      data: attendance,
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};

const fetchAllAttendance = async (req, res) => {
  const userRole = req.user.role;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  try {
    const attendance = await queryAsync(
      `SELECT a.id, a.employee_id, a.date, a.login_time, a.logout_time, a.recipient, a.submitted_at, a.status, 
              e.name AS employee_name 
       FROM attendance a 
       JOIN employees e ON a.employee_id = e.employee_id 
       ORDER BY a.date DESC`
    );

    res.json({
      message: "All attendance records fetched successfully",
      data: attendance,
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};

const updateAttendanceStatus = async (req, res) => {
  const userRole = req.user.role;
  const { id } = req.params;
  const { status } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  if (!["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be 'Approved' or 'Rejected'" });
  }

  try {
    const [attendance] = await queryAsync("SELECT * FROM attendance WHERE id = ?", [id]);
    if (!attendance) {
      return res.status(404).json({ error: "Attendance record not found" });
    }

    const query = "UPDATE attendance SET status = ? WHERE id = ?";
    const result = await queryAsync(query, [status, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Attendance record not found" });
    }

    res.json({
      message: `Attendance ${status.toLowerCase()} successfully`,
      data: { id, status },
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};

module.exports = {
  markAttendance,
  fetchEmployeeAttendance,
  fetchAllAttendance,
  updateAttendanceStatus,
};