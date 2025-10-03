const util = require("util");
const pool = require("../config/db");

const queryAsync = util.promisify(pool.query).bind(pool);

const calculateLeaveDays = async (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return 0;

  let holidayDates = [];
  try {
    const holidays = await queryAsync("SELECT holiday_date FROM holidays WHERE holiday_date BETWEEN ? AND ?", [
      start.toISOString().split("T")[0],
      end.toISOString().split("T")[0],
    ]);
    holidayDates = holidays.map((h) => h.holiday_date.toISOString().split("T")[0]);
  } catch (err) {
    console.error("Error querying holidays table:", err.sqlMessage || err.message);
    holidayDates = []; // Fallback to no holidays if query fails
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
  const { start_date, end_date, reason, recipient_id, leave_status = 'Paid' } = req.body;
  const { employee_id, role } = req.user;

  if (!employee_id) {
    return res.status(401).json({ error: "No authentication token found. Please log in." });
  }

  const users = await queryAsync(
    "SELECT employee_id, role FROM hrms_users WHERE employee_id = ? AND status = 'active'",
    [employee_id]
  );
  const user = users[0];
  if (!user) {
    return res.status(403).json({ error: "User not found or inactive" });
  }

  if (role === "super_admin") {
    return res.status(403).json({ error: "Super admins cannot apply for leaves" });
  }

  if (!start_date || !end_date || !reason || !recipient_id) {
    return res.status(400).json({ error: "All fields are required" });
  }

  if (!['Paid', 'Unpaid'].includes(leave_status)) {
    return res.status(400).json({ error: "Invalid leave status. Must be 'Paid' or 'Unpaid'" });
  }

  try {
    const total_days = await calculateLeaveDays(start_date, end_date);
    if (total_days <= 0) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    // Prevent multiple leaves on the same day
    const existingLeaves = await queryAsync(
      `SELECT * FROM leaves
       WHERE employee_id = ?
       AND (
             (DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?))
             OR
             (DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?))
           )`,
      [employee_id, start_date, start_date, end_date, end_date]
    );

    if (existingLeaves.length > 0) {
      return res.status(400).json({ error: "You already have a leave applied for the selected dates" });
    }

    // Determine expected recipient role
    let expectedRecipientRole = role === "employee" ? "hr" : "super_admin";

    // Fetch recipient and validate
    const recipients = await queryAsync(
      "SELECT employee_id, role FROM hrms_users WHERE employee_id = ? AND role = ? AND status = 'active'",
      [recipient_id, expectedRecipientRole]
    );
    const recipient = recipients[0];
    if (!recipient) {
      return res.status(400).json({ error: `Recipient must be an active ${expectedRecipientRole}` });
    }

    // Check paid leave balance
    if (leave_status === "Paid") {
      const currentYear = new Date().getFullYear();
      const balances = await queryAsync(
        "SELECT balance FROM leave_balances WHERE employee_id = ? AND leave_type = ? AND year = ?",
        [employee_id, 'paid', currentYear]
      );
      const balance = balances[0];
      if (!balance || balance.balance < total_days) {
        return res.status(400).json({ error: "Insufficient paid leave balance" });
      }
    }

    const currentTime = new Date().toISOString().slice(0, 19).replace("T", " ");

    // ✅ FIX: leave_type should depend on leave_status
    const leave_type = leave_status.toLowerCase(); // "paid" or "unpaid"

    // Insert leave
    const results = await queryAsync(
      `INSERT INTO leaves (employee_id, start_date, end_date, reason, leave_type, leave_status, total_days, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)`,
      [employee_id, start_date, end_date, reason, leave_type, leave_status, total_days, currentTime, currentTime]
    );
    const result = results;

    // Insert recipient mapping
    await queryAsync(
      "INSERT INTO leave_recipients (leave_id, recipient_id) VALUES (?, ?)",
      [result.insertId, recipient_id]
    );

    // Deduct paid leave balance only if leave is Paid
    if (leave_status === "Paid") {
      await queryAsync(
        "UPDATE leave_balances SET balance = balance - ? WHERE employee_id = ? AND leave_type = ? AND year = ?",
        [total_days, employee_id, 'paid', new Date().getFullYear()]
      );
    }

    res.status(201).json({ message: "Leave applied successfully", leave_id: result.insertId });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage });
  }
};

const updateLeaveStatus = async (req, res) => {
  const { leave_id, status } = req.body;
  const { employee_id, role } = req.user;
  const currentYear = new Date().getFullYear();

  if (!leave_id || !status || !["Approved", "Rejected"].includes(status)) {
    return res
      .status(400)
      .json({ error: "Leave ID and valid status (Approved/Rejected) are required" });
  }

  if (!["super_admin", "hr", "dept_head"].includes(role)) {
    return res.status(403).json({ error: "Unauthorized to update leave status" });
  }

  try {
    let recipientCheckQuery = "SELECT * FROM leave_recipients WHERE leave_id = ? AND recipient_id = ?";
    let recipientCheckParams = [leave_id, employee_id];

    if (role === "dept_head") {
      const [deptHead] = await queryAsync(
        "SELECT department_name FROM hrms_users WHERE employee_id = ? AND role = ?",
        [employee_id, "dept_head"]
      );
      if (!deptHead) {
        return res.status(403).json({ error: "Not a department head" });
      }
      recipientCheckQuery += " AND EXISTS (SELECT 1 FROM leaves l JOIN hrms_users u ON l.employee_id = u.employee_id WHERE l.id = ? AND u.department_name = ?)";
      recipientCheckParams.push(leave_id, deptHead.department_name);
    } else if (role === "super_admin") {
      // Restrict super_admin to HR-submitted leaves
      recipientCheckQuery += " AND EXISTS (SELECT 1 FROM leaves l JOIN hrms_users u ON l.employee_id = u.employee_id WHERE l.id = ? AND u.role = 'hr')";
      recipientCheckParams.push(leave_id);
    }

    const recipientCheck = await queryAsync(recipientCheckQuery, recipientCheckParams);
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
      const [leave] = await queryAsync(
        "SELECT employee_id, start_date, end_date, leave_type, leave_status, total_days FROM leaves WHERE id = ?",
        [leave_id]
      );
      if (leave.leave_status === "Paid" && leave.leave_type !== "unpaid") {
        await queryAsync(
          "UPDATE leave_balances SET balance = balance - ? WHERE employee_id = ? AND leave_type = ? AND year = ?",
          [leave.total_days, leave.employee_id, leave.leave_type, currentYear]
        );
      }

      for (let d = new Date(leave.start_date); d <= new Date(leave.end_date); d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        let holidayDates = [];
        try {
          const holidays = await queryAsync("SELECT date FROM holidays WHERE date = ?", [dateStr]);
          holidayDates = holidays.map((h) => h.date.toISOString().split("T")[0]);
        } catch (err) {
          console.error("Error querying holidays in updateLeaveStatus:", err.sqlMessage || err.message);
          await queryAsync(
            "INSERT INTO cron_logs (job_name, status, message) VALUES (?, ?, ?)",
            ["updateLeaveStatus", "error", `Failed to query holidays: ${err.sqlMessage || err.message}`]
          );
          holidayDates = [];
        }
        if (holidayDates.length === 0 && d.getDay() !== 0 && d.getDay() !== 6) {
          await queryAsync(
            "INSERT INTO attendance (employee_id, date, status, recipient, location, created_at) VALUES (?, ?, ?, ?, ?, NOW())",
            [leave.employee_id, dateStr, leave.leave_status === "Paid" ? "Approved" : "Unpaid", employee_id, "Leave"]
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

const getPendingLeaves = async (req, res) => {
  const { employee_id } = req.user;
  try {
    const query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(MAX(u.full_name), 'Unknown') AS employee_name,
             COALESCE(MAX(u.department_name), 'N/A') AS department,
             COALESCE(MAX(u.role), 'unknown') AS employee_role,
             lr.recipient_id,
             GROUP_CONCAT(COALESCE(u_rec.full_name, 'Unknown')) AS recipient_names
      FROM leaves l
      JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN hrms_users u ON l.employee_id = u.employee_id
      LEFT JOIN hrms_users u_rec ON lr.recipient_id = u_rec.employee_id
      WHERE lr.recipient_id = ? AND l.status = 'Pending'
      GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
               l.status, l.approved_by, l.approved_at, l.total_days, lr.recipient_id
      ORDER BY l.id
    `;
    const rows = await queryAsync(query, [employee_id]);
    const result = rows.map((row) => ({
      ...row,
      recipients: row.recipient_names ? row.recipient_names.split(",") : [],
      recipient_names: undefined,
    }));
    console.log(`getPendingLeaves for ${employee_id}:`, result);
    res.json(result);
  } catch (err) {
    console.error("DB error in getPendingLeaves:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage || err.message });
  }
};

const getAllLeaves = async (req, res) => {
  const { employee_id, role } = req.user;
  try {
    let query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(MAX(u.full_name), 'Unknown') AS employee_name,
             COALESCE(MAX(u.department_name), 'N/A') AS department,
             COALESCE(MAX(u.role), 'unknown') AS employee_role,
             lr.recipient_id,
             GROUP_CONCAT(COALESCE(u_rec.full_name, 'Unknown')) AS recipient_names
      FROM leaves l
      LEFT JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN hrms_users u ON l.employee_id = u.employee_id
      LEFT JOIN hrms_users u_rec ON lr.recipient_id = u_rec.employee_id
    `;
    const params = [];

    if (role === "hr") {
      query += ` WHERE lr.recipient_id = ?`;
      params.push(employee_id);
    } else if (role !== "super_admin") {
      return res.status(403).json({ error: "Unauthorized role" });
    }

    query += ` GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
                      l.status, l.approved_by, l.approved_at, l.total_days, lr.recipient_id`;
    const rows = await queryAsync(query, params);
    const result = rows.map((row) => ({
      ...row,
      recipients: row.recipient_names ? row.recipient_names.split(",") : [],
      recipient_names: undefined,
    }));
    console.log(`getAllLeaves for ${employee_id} (role: ${role}):`, result);
    res.json(result);
  } catch (err) {
    console.error("DB error in getAllLeaves:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage || err.message });
  }
};

const getLeaves = async (req, res) => {
  const { employee_id } = req.user;

  try {
    const query = `
      SELECT l.id, l.employee_id, l.start_date, l.end_date, l.reason, l.leave_type, 
             l.status, l.approved_by, l.approved_at, l.total_days,
             COALESCE(u.full_name, 'Unknown') AS employee_name,
             COALESCE(u.department_name, 'N/A') AS department,
             GROUP_CONCAT(COALESCE(u_rec.full_name, 'Pending')) AS recipient_names
      FROM leaves l
      LEFT JOIN hrms_users u ON l.employee_id = u.employee_id
      LEFT JOIN leave_recipients lr ON l.id = lr.leave_id
      LEFT JOIN hrms_users u_rec ON lr.recipient_id = u_rec.employee_id
      WHERE l.employee_id = ?
      GROUP BY l.id, l.employee_id, l.start_date, l.end_date, l.reason, 
               l.leave_type, l.status, l.approved_by, l.approved_at, l.total_days
    `;
    const rows = await queryAsync(query, [employee_id]);

    const result = rows.map((row) => ({
      ...row,
      recipients: row.recipient_names ? row.recipient_names.split(",") : ["Pending"],
      recipient_names: undefined,
    }));

    console.log("Fetched leaves:", result);
    res.json(result);
  } catch (err) {
    console.error("DB error in getLeaves:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage });
  }
};


const getRecipientOptions = async (req, res) => {
  const { role } = req.user;
  try {
    let recipients = [];
    if (role === "employee" || role === "dept_head") {
      recipients = await queryAsync(
        "SELECT employee_id AS identifier, full_name, role FROM hrms_users WHERE role = 'hr' AND status = 'active' AND employee_id IS NOT NULL AND employee_id != ''"
      );
    } else if (role === "hr") {
      recipients = await queryAsync(
        "SELECT full_name AS identifier, full_name, role FROM hrms_users WHERE role = 'super_admin' AND status = 'active'"
      );
    } else if (role === "super_admin") {
      recipients = await queryAsync(
        "SELECT employee_id AS identifier, full_name, role FROM hrms_users WHERE role = 'hr' AND status = 'active' AND employee_id IS NOT NULL AND employee_id != '' UNION SELECT full_name AS identifier, full_name, role FROM hrms_users WHERE role = 'super_admin' AND status = 'active'"
      );
    } else {
      return res.status(403).json({ error: "Invalid role for fetching recipients" });
    }

    if (recipients.length === 0) {
      return res.status(404).json({ error: "No valid recipients found for your role" });
    }

    const formattedRecipients = recipients.map((recipient) => ({
      value: recipient.identifier, // employee_id for HR, full_name for Super Admin
      label: `${recipient.full_name} (${recipient.role === "super_admin" ? "Super Admin" : "HR"})`,
      role: recipient.role,
    }));

    res.json(formattedRecipients);
  } catch (err) {
    console.error("DB error in getRecipientOptions:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage || err.message });
  }
};

const getLeaveBalances = async (req, res) => {
  const { employee_id } = req.user;
  const currentYear = new Date().getFullYear();

  try {
    const balances = await queryAsync(
      "SELECT leave_type, balance FROM leave_balances WHERE employee_id = ? AND year = ?",
      [employee_id, currentYear]
    );
    const balanceMap = { vacation: 0, sick: 0, casual: 0, maternity: 0, paternity: 0 };
    balances.forEach((b) => {
      balanceMap[b.leave_type] = b.balance;
    });
    res.json(balanceMap);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage });
  }
};

const allocateMonthlyLeaves = async (req = {}, res = null) => {
  try {
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    const currentTime = new Date().toISOString().slice(0, 19).replace("T", " ");
    const leaveType = "paid";
    const monthlyAllocation = 1;
    const maxBalance = 12; 

    const [lastAllocation] = await queryAsync(
      "SELECT id, status, message FROM cron_logs WHERE job_name = ? AND YEAR(executed_at) = ? AND MONTH(executed_at) = ?",
      ["allocateMonthlyLeaves", currentYear, currentMonth]
    );
    if (lastAllocation) {
      const message = `Monthly leave allocation for ${currentYear}-${currentMonth} already completed (status: ${lastAllocation.status}, message: ${lastAllocation.message})`;
      console.log(message);
      if (res) return res.status(400).json({ error: message });
      return { message };
    }

    const employees = await queryAsync(
      "SELECT employee_id FROM hrms_users WHERE role IN ('employee', 'hr', 'dept_head', 'manager') AND status = 'active'"
    );

    if (!employees.length) {
      const message = "No active employees found for leave allocation";
      console.log(message);
      await queryAsync(
        "INSERT INTO cron_logs (job_name, status, message, executed_at) VALUES (?, ?, ?, ?)",
        ["allocateMonthlyLeaves", "failed", message, currentTime]
      );
      if (res) return res.status(404).json({ error: message });
      throw new Error(message);
    }

    let allocatedCount = 0;
    for (const employee of employees) {
      const { employee_id } = employee;
      try {
        const [existingBalance] = await queryAsync(
          "SELECT balance FROM leave_balances WHERE employee_id = ? AND leave_type = ? AND year = ?",
          [employee_id, leaveType, currentYear]
        );

        if (existingBalance) {
          await queryAsync(
            "UPDATE leave_balances SET balance = LEAST(balance + ?, ?), updated_at = ? WHERE employee_id = ? AND leave_type = ? AND year = ?",
            [monthlyAllocation, maxBalance, currentTime, employee_id, leaveType, currentYear]
          );
          console.log(`Allocated ${monthlyAllocation} paid leave for employee ${employee_id}`);
          allocatedCount++;
        } else {
          await queryAsync(
            "INSERT INTO leave_balances (employee_id, leave_type, year, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            [employee_id, leaveType, currentYear, monthlyAllocation, currentTime, currentTime]
          );
          console.log(`Initialized paid leave with ${monthlyAllocation} for employee ${employee_id}`);
          allocatedCount++;
        }
      } catch (err) {
        console.error(`Failed to allocate leave for employee ${employee_id}:`, err.message);
        continue; 
      }
    }

    const message = `Monthly leave allocation for ${currentYear}-${currentMonth} completed successfully. Allocated for ${allocatedCount} employees.`;
    await queryAsync(
      "INSERT INTO cron_logs (job_name, status, message, executed_at) VALUES (?, ?, ?, ?)",
      ["allocateMonthlyLeaves", "success", message, currentTime]
    );
    console.log(message);
    if (res) return res.json({ message });
    return { message };
  } catch (err) {
    console.error("Error in allocateMonthlyLeaves:", err.sqlMessage || err.message);
    const errorMessage = `Failed to allocate leaves for ${currentYear}-${currentMonth}: ${err.sqlMessage || err.message}`;
    await queryAsync(
      "INSERT INTO cron_logs (job_name, status, message, executed_at) VALUES (?, ?, ?, ?)",
      ["allocateMonthlyLeaves", "failed", errorMessage, currentTime]
    );
    if (res) {
      res.status(500).json({ error: "Failed to allocate monthly leaves", details: err.sqlMessage || err.message });
    }
    throw err;
  }
};

const allocateSpecialLeave = async (req, res) => {
  const { employee_id } = req.user; 
  const leave_type = req.body.leave_type || "maternity"; 
  const days = req.body.days || (leave_type === "maternity" ? 90 : 15); 
  const currentYear = new Date().getFullYear();
  const currentTime = new Date().toISOString().slice(0, 19).replace("T", " ");

  try {
    const validLeaveTypes = ["maternity", "paternity"];
    if (!validLeaveTypes.includes(leave_type)) {
      return res.status(400).json({ error: "Invalid leave type. Must be 'maternity' or 'paternity'" });
    }

    const [existingBalance] = await queryAsync(
      "SELECT balance FROM leave_balances WHERE employee_id = ? AND leave_type = ? AND year = ?",
      [employee_id, leave_type, currentYear]
    );

    if (existingBalance) {
      return res.status(400).json({ error: `${leave_type} leave already allocated for ${currentYear}` });
    }

    await queryAsync(
      "INSERT INTO leave_balances (employee_id, leave_type, year, balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [employee_id, leave_type, currentYear, days, currentTime, currentTime]
    );
    console.log(`${leave_type} leave allocated for employee ${employee_id}`);

    res.status(201).json({ message: `${leave_type} leave allocated successfully` });
  } catch (err) {
    console.error(`Error in allocateSpecialLeave for ${leave_type}:`, err.sqlMessage || err.message);
    res.status(500).json({ error: `Failed to allocate ${leave_type} leave`, details: err.sqlMessage || err.message });
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
  calculateLeaveDays,
  allocateMonthlyLeaves,
  allocateSpecialLeave,
};