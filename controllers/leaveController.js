const util = require("util");
const pool = require("../config/db");

const queryAsync = util.promisify(pool.query).bind(pool);

const applyLeave = async (req, res) => {
  const { user_id, role } = req.user;
  const { start_date, end_date, reason, leave_type, recipient_id } = req.body;

  if (!start_date || !end_date || !reason || !leave_type || !recipient_id) {
    return res.status(400).json({ error: "Start date, end date, reason, leave type, and recipient are required" });
  }

  if (role === "super_admin") {
    return res.status(403).json({ error: "Super admins cannot apply for leaves" });
  }

  try {
    // Validate recipient based on role
    let isValidRecipient = false;
    if (role === "employee" || role === "dept_head") {
      const hrCheck = await queryAsync("SELECT employee_id FROM hrs WHERE employee_id = ? AND role = 'hr'", [recipient_id]);
      isValidRecipient = hrCheck.length > 0;
    } else if (role === "hr") {
      const adminCheck = await queryAsync("SELECT employee_id FROM hrs WHERE employee_id = ? AND role = 'super_admin'", [recipient_id]);
      isValidRecipient = adminCheck.length > 0;
    }

    if (!isValidRecipient) {
      return res.status(400).json({ error: "Invalid recipient for your role" });
    }

    // Calculate days
    const days = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24)) + 1;

    // Insert leave request
    const leaveQuery = `
      INSERT INTO leaves (employee_id, start_date, end_date, reason, leave_type, status, days)
      VALUES (?, ?, ?, ?, ?, 'Pending', ?)
    `;
    const leaveResult = await queryAsync(leaveQuery, [
      user_id,
      start_date,
      end_date,
      reason,
      leave_type,
      days,
    ]);

    const leave_id = leaveResult.insertId;

    // Insert recipient
    const recipientQuery = "INSERT INTO leave_recipients (leave_id, recipient_id) VALUES (?, ?)";
    await queryAsync(recipientQuery, [leave_id, recipient_id]);

    res.status(201).json({
      message: "Leave applied successfully",
      leave: { id: leave_id, employee_id: user_id, start_date, end_date, reason, leave_type, status: "Pending", days },
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};

const getPendingLeaves = async (req, res) => {
  try {
    const { user_id, role } = req.user;
    if (!["super_admin", "hr"].includes(role)) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    let baseQuery = `
      SELECT l.*, 
             e.name AS employee_name, 
             e.department_name AS department,
             DATEDIFF(l.end_date, l.start_date) + 1 AS days,
             GROUP_CONCAT(lr.recipient_id) AS recipients
      FROM leaves l
      JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      WHERE lr.recipient_id = ? AND l.status = 'Pending'
      GROUP BY l.id
    `;

    if (role === "hr") {
      // HR sees leaves from employees and dept_heads
      baseQuery += " AND (e.employee_id IS NOT NULL OR dh.employee_id IS NOT NULL)";
    } else if (role === "super_admin") {
      // Super admin sees leaves from HR
      baseQuery += " AND h.employee_id IS NOT NULL";
    }

    const rows = await queryAsync(baseQuery, [user_id]);
    rows.forEach((row) => {
      row.recipients = row.recipients ? row.recipients.split(",") : [];
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const getAllLeaves = async (req, res) => {
  try {
    const { user_id, role } = req.user;
    if (!["super_admin", "hr"].includes(role)) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    let baseQuery = `
      SELECT l.*, 
             COALESCE(e.name, dh.name, h.name) AS employee_name, 
             COALESCE(e.department_name, dh.department_name, 'HR') AS department,
             DATEDIFF(l.end_date, l.start_date) + 1 AS days,
             GROUP_CONCAT(lr.recipient_id) AS recipients
      FROM leaves l
      JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      WHERE lr.recipient_id = ?
      GROUP BY l.id
    `;

    if (role === "hr") {
      baseQuery += " AND (e.employee_id IS NOT NULL OR dh.employee_id IS NOT NULL)";
    } else if (role === "super_admin") {
      baseQuery += " AND h.employee_id IS NOT NULL";
    }

    const rows = await queryAsync(baseQuery, [user_id]);
    rows.forEach((row) => {
      row.recipients = row.recipients ? row.recipients.split(",") : [];
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const updateLeaveStatus = async (req, res) => {
  const { leave_id, status } = req.body;
  const { user_id, role } = req.user;

  if (!leave_id || !status || !["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "Leave ID and valid status (Approved/Rejected) are required" });
  }

  if (!["super_admin", "hr"].includes(role)) {
    return res.status(403).json({ error: "Unauthorized to update leave status" });
  }

  try {
    // Check if the user is a recipient
    const recipientCheck = await queryAsync(
      "SELECT * FROM leave_recipients WHERE leave_id = ? AND recipient_id = ?",
      [leave_id, user_id]
    );
    if (!recipientCheck.length) {
      return res.status(403).json({ error: "You are not authorized to update this leave" });
    }

    const leaveCheck = await queryAsync(
      "SELECT employee_id FROM leaves WHERE id = ?",
      [leave_id]
    );
    if (!leaveCheck.length) {
      return res.status(404).json({ error: "Leave not found" });
    }

    const { employee_id } = leaveCheck[0];
    if (role === "hr") {
      const isValidOriginator = await queryAsync(
        `SELECT employee_id FROM employees WHERE employee_id = ?
         UNION
         SELECT employee_id FROM dept_heads WHERE employee_id = ?`,
        [employee_id, employee_id]
      );
      if (!isValidOriginator.length) {
        return res.status(403).json({ error: "HR can only update leaves from employees or department heads" });
      }
    } else if (role === "super_admin") {
      const isValidOriginator = await queryAsync(
        "SELECT employee_id FROM hrs WHERE employee_id = ? AND role != 'super_admin'",
        [employee_id]
      );
      if (!isValidOriginator.length) {
        return res.status(403).json({ error: "Super admin can only update leaves from HR" });
      }
    }

    const query = "UPDATE leaves SET status = ? WHERE id = ?";
    await queryAsync(query, [status, leave_id]);

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
      SELECT l.*, 
             COALESCE(e.name, dh.name, h.name) AS employee_name, 
             COALESCE(e.department_name, dh.department_name, 'HR') AS department,
             DATEDIFF(l.end_date, l.start_date) + 1 AS days,
             GROUP_CONCAT(lr.recipient_id) AS recipients
      FROM leaves l
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      WHERE l.employee_id = ?
      GROUP BY l.id
    `;
    const rows = await queryAsync(query, [user_id]);
    rows.forEach((row) => {
      row.recipients = row.recipients ? row.recipients.split(",") : [];
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const getRecipientOptions = async (req, res) => {
  const { role } = req.user;
  try {
    let recipients = [];
    if (role === "employee" || role === "dept_head") {
      recipients = await queryAsync("SELECT employee_id, name FROM hrs WHERE role = 'hr'");
    } else if (role === "hr") {
      recipients = await queryAsync("SELECT employee_id, name FROM hrs WHERE role = 'super_admin'");
    }
    res.json(recipients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

module.exports = { getLeaves, getPendingLeaves, getAllLeaves, applyLeave, updateLeaveStatus, getRecipientOptions };