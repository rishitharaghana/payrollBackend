const util = require("util");
const pool = require("../config/db");

const queryAsync = util.promisify(pool.query).bind(pool);

const applyLeave = async (req, res) => {
  const { role } = req.user;
  const { start_date, end_date, reason, leave_type, recipient_id } = req.body;

  if (!start_date || !end_date || !reason || !leave_type || !recipient_id) {
    return res.status(400).json({
      error: "Start date, end date, reason, leave type, and recipient are required",
    });
  }

  if (role === "super_admin") {
    return res.status(403).json({ error: "Super admins cannot apply for leaves" });
  }

  try {
    // Validate recipient based on role
    let isValidRecipient = false;
    if (role === "employee" || role === "dept_head") {
      const hrCheck = await queryAsync(
        "SELECT employee_id FROM hrs WHERE employee_id = ? AND role = 'hr'",
        [recipient_id]
      );
      isValidRecipient = hrCheck.length > 0;
    } else if (role === "hr") {
      const adminCheck = await queryAsync(
        "SELECT employee_id FROM hrs WHERE employee_id = ? AND role = 'super_admin'",
        [recipient_id]
      );
      isValidRecipient = adminCheck.length > 0;
    }

    if (!isValidRecipient) {
      return res.status(400).json({ error: "Invalid recipient for your role" });
    }

    // Insert leave request without total_days
    const leaveQuery = `
      INSERT INTO leaves (start_date, end_date, reason, leave_type, status)
      VALUES (?, ?, ?, ?, 'Pending')
    `;
    const leaveResult = await queryAsync(leaveQuery, [
      start_date,
      end_date,
      reason,
      leave_type,
    ]);

    const leave_id = leaveResult.insertId;

    // Insert recipient
    await queryAsync(
      "INSERT INTO leave_recipients (leave_id, recipient_id) VALUES (?, ?)",
      [leave_id, recipient_id]
    );

    // Fetch the inserted leave to include total_days in the response
    const fetchQuery = `
      SELECT id, start_date, end_date, reason, leave_type, status, total_days
      FROM leaves WHERE id = ?
    `;
    const [newLeave] = await queryAsync(fetchQuery, [leave_id]);

    res.status(201).json({
      message: "Leave applied successfully",
      leave: newLeave,
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage || err.message });
  }
};
const getPendingLeaves = async (req, res) => {
  try {
    const { user_id } = req.user; // Adjust for nullable employee_id if needed
    const query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(e.name, dh.name, h.name, 'Unknown') AS employee_name,
             COALESCE(e.department_name, dh.department_name, 'HR') AS department,
             GROUP_CONCAT(COALESCE(h_rec.name, 'Unknown')) AS recipient_names
      FROM leaves l
      JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      LEFT JOIN hrs h_rec ON lr.recipient_id = h_rec.employee_id
      WHERE lr.recipient_id = ? AND l.status = 'Pending'
      GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
               l.status, l.approved_by, l.approved_at, l.total_days,
               e.name, e.department_name, dh.name, dh.department_name, h.name
    `;
    const rows = await queryAsync(query, [user_id || null]);
    rows.forEach((row) => {
      row.recipients = row.recipient_names ? row.recipient_names.split(",") : [];
      delete row.recipient_names;
    });
    res.json(rows);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage });
  }
};

const getAllLeaves = async (req, res) => {
  try {
    const { user_id, role } = req.user;
    let query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(e.name, dh.name, h.name, 'Unknown') AS employee_name,
             COALESCE(e.department_name, dh.department_name, 'HR') AS department,
             GROUP_CONCAT(COALESCE(h_rec.name, 'Unknown')) AS recipient_names
      FROM leaves l
      LEFT JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      LEFT JOIN hrs h_rec ON lr.recipient_id = h_rec.employee_id
    `;
    const params = [];

    // Adjust WHERE clause based on role
    if (role === "hr") {
      query += ` WHERE lr.recipient_id = ?`;
      params.push(user_id);
    } else if (role === "super_admin") {
      // Super admins see all leaves; no WHERE clause needed
    } else {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    query += `
      GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
               l.status, l.approved_by, l.approved_at, l.total_days,
               e.name, e.department_name, dh.name, dh.department_name, h.name
    `;

    const rows = await queryAsync(query, params);
    rows.forEach((row) => {
      row.recipients = row.recipient_names ? row.recipient_names.split(",") : [];
      delete row.recipient_names;
    });
    res.json(rows);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage });
  }
};
const updateLeaveStatus = async (req, res) => {
  const { leave_id, status } = req.body;
  const { user_id, role } = req.user;

  if (!leave_id || !status || !["Approved", "Rejected"].includes(status)) {
    return res
      .status(400)
      .json({ error: "Leave ID and valid status (Approved/Rejected) are required" });
  }

  if (!["super_admin", "hr"].includes(role)) {
    return res.status(403).json({ error: "Unauthorized to update leave status" });
  }

  try {
    const recipientCheck = await queryAsync(
      "SELECT * FROM leave_recipients WHERE leave_id = ? AND recipient_id = ?",
      [leave_id, user_id]
    );
    if (!recipientCheck.length) {
      return res.status(403).json({ error: "You are not authorized to update this leave" });
    }

    const query = `
      UPDATE leaves 
      SET status = ?, approved_by = ?, approved_at = NOW()
      WHERE id = ?
    `;
    await queryAsync(query, [status, user_id, leave_id]);

    res.json({ message: `Leave ${status.toLowerCase()} successfully`, leave_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};
const getLeaves = async (req, res) => {
  try {
    const { user_id } = req.user;
    const query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(e.name, dh.name, h.name) AS employee_name, 
             COALESCE(e.department_name, dh.department_name, 'HR') AS department,
             GROUP_CONCAT(lr.recipient_id) AS recipients
      FROM leaves l
      LEFT JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      WHERE l.employee_id = ?
      GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
               l.status, l.approved_by, l.approved_at, l.total_days,
               e.name, e.department_name, dh.name, dh.department_name, h.name
    `;
    const rows = await queryAsync(query, [user_id]);
    rows.forEach((row) => {
      row.recipients = row.recipients ? row.recipients.split(",") : [];
    });
    res.json(rows);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage });
  }
};
const getRecipientOptions = async (req, res) => {
  const { role } = req.user;
  try {
    let recipients = [];
    if (role === "employee" || role === "dept_head") {
      recipients = await queryAsync("SELECT employee_id, name FROM hrs WHERE role = 'hr'");
    } else if (role === "hr") {
      recipients = await queryAsync(
        "SELECT employee_id, name FROM hrs WHERE role = 'super_admin'"
      );
    } else {
      return res.status(403).json({ error: "Invalid role for fetching recipients" });
    }
    if (recipients.length === 0) {
      return res.status(404).json({ error: "No recipients found for your role" });
    }
    res.json(recipients);
  } catch (err) {
    console.error("DB error in getRecipientOptions:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage || err.message });
  }
};

module.exports = {
  getLeaves,
  getPendingLeaves,
  getAllLeaves,
  applyLeave,
  updateLeaveStatus,
  getRecipientOptions,
};
