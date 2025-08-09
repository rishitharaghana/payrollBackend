const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

const getLeaves = async (req, res) => {
  try {
    // Optional filters from query string
    const { employee_id, status } = req.query;
    let baseQuery = "SELECT * FROM leaves WHERE 1=1";
    const params = [];

    if (employee_id) {
      baseQuery += " AND employee_id = ?";
      params.push(employee_id);
    }
    if (status) {
      baseQuery += " AND status = ?";
      params.push(status);
    }

    const rows = await queryAsync(baseQuery, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const applyLeave = async (req, res) => { 
  const { employee_id, start_date, end_date, reason, leave_type } = req.body;

  if (!leave_type) {
    return res.status(400).json({ error: "Leave type is required" });
  }

  try {
    await queryAsync(
      `INSERT INTO leaves 
        (employee_id, start_date, end_date, reason, leave_type, status) 
       VALUES (?, ?, ?, ?, ?, 'Pending')`,
      [employee_id, start_date, end_date, reason, leave_type]
    );
    res.status(201).json({ message: "Leave applied, pending approval" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const updateLeaveStatus = async (req, res) => {
  const { leave_id, status } = req.body;

  if (!leave_id || !status) {
    return res.status(400).json({ error: "leave_id and status are required" });
  }

  if (!["Pending", "Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status value" });
  }

  try {
    // Update status of leave application by leave_id
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

module.exports = { getLeaves, applyLeave, updateLeaveStatus };
