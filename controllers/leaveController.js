const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

const getLeaves = async (req, res) => {
  try {
    const { employee_id } = req.user; // Assume authenticated user
    const baseQuery = `
      SELECT l.*, GROUP_CONCAT(lr.recipient_id) AS recipients
      FROM leaves l
      LEFT JOIN leave_recipients lr ON l.id = lr.leave_id
      WHERE l.employee_id = ?
      GROUP BY l.id
    `;
    const rows = await queryAsync(baseQuery, [employee_id]);
    // Parse recipients into arrays
    rows.forEach((row) => {
      row.recipients = row.recipients ? row.recipients.split(',') : [];
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const getPendingLeaves = async (req, res) => {
  try {
    const { user_id, role } = req.user; // Assume authenticated user with role
    if (!['super_admin', 'hr'].includes(role)) {
      return res.status(403).json({ error: "Unauthorized" });
    }
    const baseQuery = `
      SELECT l.*, e.name AS employee_name, e.department
      FROM leaves l
      JOIN employees e ON l.employee_id = e.id
      JOIN leave_recipients lr ON l.id = lr.leave_id
      WHERE lr.recipient_id = ? AND l.status = 'Pending'
    `;
    const rows = await queryAsync(baseQuery, [user_id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const applyLeave = async (req, res) => {
  const { employee_id, start_date, end_date, reason, leave_type, recipients } = req.body;

  if (!leave_type || !start_date || !end_date || !reason || !recipients || !recipients.length) {
    return res.status(400).json({ error: "All fields are required, including at least one recipient" });
  }

  try {
    const result = await queryAsync(
      `INSERT INTO leaves 
        (employee_id, start_date, end_date, reason, leave_type, status) 
       VALUES (?, ?, ?, ?, ?, 'Pending')`,
      [employee_id, start_date, end_date, reason, leave_type]
    );

    const leaveId = result.insertId;

    // Insert recipients
    for (const recipientId of recipients) {
      await queryAsync(
        `INSERT INTO leave_recipients (leave_id, recipient_id) VALUES (?, ?)`,
        [leaveId, recipientId]
      );
    }

    res.status(201).json({ message: "Leave applied, pending approval" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const updateLeaveStatus = async (req, res) => {
  const { leave_id, status } = req.body;
  const { user_id, role } = req.user;

  if (!leave_id || !status) {
    return res.status(400).json({ error: "leave_id and status are required" });
  }

  if (!["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  if (!['super_admin', 'hr'].includes(role)) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  try {
    // Verify recipient
    const recipientCheck = await queryAsync(
      "SELECT 1 FROM leave_recipients WHERE leave_id = ? AND recipient_id = ?",
      [leave_id, user_id]
    );

    if (recipientCheck.length === 0) {
      return res.status(403).json({ error: "Not authorized to update this leave" });
    }

    const result = await queryAsync(
      "UPDATE leaves SET status = ? WHERE id = ?",
      [status, leave_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Leave request not found" });
    }

    res.json({ message: `Leave ${status.toLowerCase()} successfully` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

module.exports = { getLeaves, getPendingLeaves, applyLeave, updateLeaveStatus };