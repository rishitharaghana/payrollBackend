const util = require("util");
const pool = require("../config/db");

const queryAsync = util.promisify(pool.query).bind(pool);

const calculateLeaveDays = async (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return 0;

  let holidayDates = [];
  try {
    const holidays = await queryAsync("SELECT date FROM holidays WHERE date BETWEEN ? AND ?", [
      startDate,
      endDate,
    ]);
    holidayDates = holidays.map((h) => h.date);
  } catch (err) {
    console.error("Error querying holidays table:", err.sqlMessage || err.message);
    holidayDates = [];
  }

  let days = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split("T")[0];
    const isHoliday = holidayDates.includes(dateStr);
    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
    if (!isHoliday && !isWeekend) days++;
  }
  return days;
};

const applyLeave = async (req, res) => {
  const { role, employee_id } = req.user;
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

    const total_days = await calculateLeaveDays(start_date, end_date);
    if (total_days === 0) {
      return res.status(400).json({ error: "Invalid date range" });
    }
    const [balance] = await queryAsync(
      "SELECT balance FROM leave_balances WHERE employee_id = ? AND leave_type = ?",
      [employee_id, leave_type]
    );
    if (!balance || balance.balance < total_days) {
      return res.status(400).json({ error: `Insufficient ${leave_type} leave balance` });
    }

    const leaveQuery = `
      INSERT INTO leaves (employee_id, start_date, end_date, reason, leave_type, status, total_days)
      VALUES (?, ?, ?, ?, ?, 'Pending', ?)
    `;
    const leaveResult = await queryAsync(leaveQuery, [
      employee_id,
      start_date,
      end_date,
      reason,
      leave_type,
      total_days,
    ]);

    const leave_id = leaveResult.insertId;
    await queryAsync(
      "INSERT INTO leave_recipients (leave_id, recipient_id) VALUES (?, ?)",
      [leave_id, recipient_id]
    );

    const fetchQuery = `
      SELECT id, employee_id, start_date, end_date, reason, leave_type, status, total_days
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
  const { employee_id } = req.user;

  try {
    const query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(MAX(e.full_name), MAX(dh.full_name), MAX(h.full_name), 'Unknown') AS employee_name,
             COALESCE(MAX(e.department_name), MAX(dh.department_name), MAX(h.department_name), 'Unknown') AS department,
             GROUP_CONCAT(COALESCE(h_rec.full_name, 'Unknown')) AS recipient_names
      FROM leaves l
      JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      LEFT JOIN hrs h_rec ON lr.recipient_id = h_rec.employee_id
      WHERE lr.recipient_id = ? AND l.status = 'Pending'
      GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
               l.status, l.approved_by, l.approved_at, l.total_days
      ORDER BY l.id
    `;
    const rows = await queryAsync(query, [employee_id]);
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
  const { employee_id, role } = req.user;

  try {
    let query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(MAX(e.full_name), MAX(dh.full_name), MAX(h.full_name), 'Unknown') AS employee_name,
             COALESCE(MAX(e.department_name), MAX(dh.department_name), MAX(h.department_name), 'Unknown') AS department,
             GROUP_CONCAT(COALESCE(h_rec.full_name, 'Unknown')) AS recipient_names
      FROM leaves l
      LEFT JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      LEFT JOIN hrs h_rec ON lr.recipient_id = h_rec.employee_id
    `;
    const params = [];

    if (role === "hr") {
      query += ` WHERE lr.recipient_id = ?`;
      params.push(employee_id);
    } else if (role !== "super_admin") {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    query += ` GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
                      l.status, l.approved_by, l.approved_at, l.total_days`;
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
  const { employee_id, role } = req.user;

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
      [leave_id, employee_id]
    );
    if (!recipientCheck.length) {
      return res.status(403).json({ error: "You are not authorized to update this leave" });
    }

    const query = `
      UPDATE leaves 
      SET status = ?, approved_by = ?, approved_at = NOW()
      WHERE id = ?
    `;
    await queryAsync(query, [status, employee_id, leave_id]);

    if (status === "Approved") {
      const [leave] = await queryAsync("SELECT * FROM leaves WHERE id = ?", [leave_id]);
      const total_days = leave.total_days;
      await queryAsync(
        "UPDATE leave_balances SET balance = balance - ? WHERE employee_id = ? AND leave_type = ?",
        [total_days, leave.employee_id, leave.leave_type]
      );

      for (let d = new Date(leave.start_date); d <= new Date(leave.end_date); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        let holidayDates = [];
        try {
          const holidays = await queryAsync("SELECT date FROM holidays WHERE date = ?", [dateStr]);
          holidayDates = holidays.map((h) => h.date);
        } catch (err) {
          console.error("Error querying holidays in updateLeaveStatus:", err.sqlMessage || err.message);
          holidayDates = [];
        }
        if (holidayDates.length === 0 && d.getDay() !== 0 && d.getDay() !== 6) {
          await queryAsync(
            "INSERT INTO attendance (employee_id, date, status, recipient, location, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
            [leave.employee_id, dateStr, "Approved", employee_id, "Leave"]
          );
        }
      }
    }

    res.json({ message: `Leave ${status.toLowerCase()} successfully`, leave_id });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage });
  }
};

const getLeaves = async (req, res) => {
  const { employee_id } = req.user;

  try {
    const query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(MAX(e.full_name), MAX(dh.full_name), MAX(h.full_name), 'Unknown') AS employee_name,
             COALESCE(MAX(e.department_name), MAX(dh.department_name), MAX(h.department_name), 'Unknown') AS department,
             GROUP_CONCAT(COALESCE(h_rec.name, 'Unknown')) AS recipient_names
      FROM leaves l
      LEFT JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN employees e ON l.employee_id = e.employee_id
      LEFT JOIN dept_heads dh ON l.employee_id = dh.employee_id
      LEFT JOIN hrs h ON l.employee_id = h.employee_id
      LEFT JOIN hrs h_rec ON lr.recipient_id = h_rec.employee_id
      WHERE l.employee_id = ?
      GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
               l.status, l.approved_by, l.approved_at, l.total_days
    `;
    const rows = await queryAsync(query, [employee_id]);
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

const getRecipientOptions = async (req, res) => {
  const { role } = req.user;
  try {
    let recipients = [];
    if (role === "employee" || role === "dept_head") {
      recipients = await queryAsync("SELECT employee_id, full_name FROM hrs WHERE role = 'hr'");
    } else if (role === "hr") {
      recipients = await queryAsync(
        "SELECT employee_id, full_name FROM hrs WHERE role = 'super_admin'"
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

const getLeaveBalances = async (req, res) => {
  const { employee_id } = req.user;

  try {
    const balances = await queryAsync(
      "SELECT leave_type, balance FROM leave_balances WHERE employee_id = ?",
      [employee_id]
    );
    const balanceMap = { vacation: 0, sick: 0, casual: 0, maternity: 0 };
    balances.forEach((b) => {
      balanceMap[b.leave_type] = b.balance;
    });
    res.json(balanceMap);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage });
  }
};

module.exports = {
  getLeaves,
  getPendingLeaves,
  getAllLeaves,
  applyLeave,
  updateLeaveStatus,
  getRecipientOptions,
  getLeaveBalances,
  calculateLeaveDays
};