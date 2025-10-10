const pool = require("../config/db");
const util = require("util");
const path = require("path");
const fs = require("fs");

const { createMulterInstance } = require("../middleware/upload");

const queryAsync = util.promisify(pool.query).bind(pool);

const uploadDir = path.join(__dirname, "../Uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
} 

const allowedTypes = {
  receipt: [".jpg", ".jpeg", ".png", ".pdf"],
};

const upload = createMulterInstance(uploadDir, allowedTypes, {
  fileSize: 5 * 1024 * 1024,
});

const submitTravelExpense = async (req, res) => {
  upload.fields([{ name: "receipt", maxCount: 1 }])(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Receipt size exceeds 5MB limit" });
      }
      if (err.message.includes("Invalid file type")) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }

    const { employee_id, travel_date, destination, travel_purpose, total_amount, expenses } = req.body;
    const receipt = req.files?.["receipt"]?.[0];
    const { role, id } = req.user;

    if (
      !employee_id?.trim() ||
      !travel_date ||
      !destination?.trim() ||
      !travel_purpose?.trim() ||
      !total_amount ||
      isNaN(total_amount) ||
      total_amount <= 0 ||
      !expenses
    ) {
      if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
      return res.status(400).json({ error: "All fields are required, must be non-empty, and total_amount must be a positive number" });
    }

    if (isNaN(Date.parse(travel_date))) {
      if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
      return res.status(400).json({ error: "Invalid travel date" });
    }

    try {
      const [employee] = await queryAsync(
        "SELECT employee_id, full_name, department_name FROM hrms_users WHERE employee_id = ? AND full_name IS NOT NULL AND department_name IS NOT NULL",
        [employee_id]
      );
      if (!employee) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(404).json({ error: "Employee not found or missing required profile data (full_name, department_name)" });
      }
      const stringEmployeeId = String(employee.employee_id);

      const [user] = await queryAsync("SELECT employee_id, role FROM hrms_users WHERE id = ?", [id]);
      if (!user || (user.employee_id !== stringEmployeeId && !["super_admin", "hr", "dept_head"].includes(role))) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(403).json({ error: "Unauthorized to submit for this employee" });
      }

      if (role === "dept_head" && user.employee_id !== stringEmployeeId) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(403).json({ error: "Department heads can only submit travel expenses for themselves" });
      }

      let parsedExpenses;
      try {
        parsedExpenses = JSON.parse(expenses);
      } catch (error) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(400).json({ error: "Invalid expenses format" });
      }
      if (!Array.isArray(parsedExpenses) || parsedExpenses.length === 0) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(400).json({ error: "Expenses must be a non-empty array" });
      }

      for (const exp of parsedExpenses) {
        if (
          !exp.expense_date ||
          !exp.purpose?.trim() ||
          !exp.amount ||
          isNaN(exp.amount) ||
          exp.amount <= 0
        ) {
          if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
          return res.status(400).json({ error: "Invalid expense item data: expense_date, purpose, and amount must be valid" });
        }
        if (isNaN(Date.parse(exp.expense_date))) {
          if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
          return res.status(400).json({ error: "Invalid expense date" });
        }
      }

      let receiptPath = null;
      if (receipt) {
        if (!fs.existsSync(receipt.path)) {
          return res.status(500).json({ error: "Failed to save uploaded receipt" });
        }
        const baseUrl = process.env.UPLOADS_BASE_URL || "http://localhost:3007/uploads/";
        receiptPath = `${baseUrl}${receipt.filename}`;
      }

      const status = ["hr", "super_admin"].includes(role) ? "Approved" : "Pending";
      const submitted_to = role === "employee" || role === "dept_head" ? "hr" : "super_admin";

      await queryAsync("START TRANSACTION");

      try {
        const travelExpenseResult = await queryAsync(
          `
          INSERT INTO travel_expenses 
          (employee_id, travel_date, destination, travel_purpose, total_amount, status, approved_by, created_at, updated_at, submitted_to, receipt_path)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NOW(), NOW(), ?, ?)
          `,
          [stringEmployeeId, travel_date, destination, travel_purpose, total_amount, status, submitted_to, receiptPath]
        );

        const travelExpenseId = travelExpenseResult.insertId;
        for (const exp of parsedExpenses) {
          await queryAsync(
            `INSERT INTO expense_items (travel_expense_id, expense_date, purpose, amount)
             VALUES (?, ?, ?, ?)`,
            [travelExpenseId, exp.expense_date, exp.purpose, exp.amount]
          );
        }

        const [newSubmission] = await queryAsync(
          `
          SELECT te.*, u.full_name AS employee_name, u.department_name
          FROM travel_expenses te
          LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
          WHERE te.id = ?
          `,
          [travelExpenseId]
        );

        await queryAsync("COMMIT");

        res.status(201).json({
          message: `Travel expense submitted successfully${status === "Approved" ? " and auto-approved" : ""}`,
          data: { ...newSubmission, expenses: parsedExpenses },
        });
      } catch (error) {
        await queryAsync("ROLLBACK");
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        throw error;
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to submit travel expense" });
    }
  });
};

const fetchTravelExpenses = async (req, res) => {
  const { role, id } = req.user;
  const { page = 1, limit = 10 } = req.query;

  try {
    const [user] = await queryAsync("SELECT employee_id, role, department_name FROM hrms_users WHERE id = ?", [id]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let query = `
      SELECT te.*, ei.id AS expense_item_id, ei.expense_date, ei.purpose AS expense_purpose, ei.amount,
             u.full_name AS employee_name, u.department_name
      FROM travel_expenses te
      LEFT JOIN expense_items ei ON te.id = ei.travel_expense_id
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
    `;
    let params = [];
    let countQuery = `
      SELECT COUNT(DISTINCT te.id) as total
      FROM travel_expenses te
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
    `;
    let countParams = [];

    if (role === "dept_head") {
      query += user.department_name ? " WHERE u.department_name = ? AND te.status = ?" : " WHERE te.status = ?";
      countQuery += user.department_name ? " WHERE u.department_name = ? AND te.status = ?" : " WHERE te.status = ?";
      params = user.department_name ? [user.department_name, "Pending"] : ["Pending"];
      countParams = user.department_name ? [user.department_name, "Pending"] : ["Pending"];
    } else if (role === "employee") {
      query += " WHERE te.employee_id = ?";
      countQuery += " WHERE te.employee_id = ?";
      params = [user.employee_id];
      countParams = [user.employee_id];
    } else if (role === "hr" || role === "super_admin") {
      query += " WHERE te.status = ?";
      countQuery += " WHERE te.status = ?";
      params = ["Pending"];
      countParams = ["Pending"];
    }

    query += " ORDER BY te.created_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(limit) * (Number(page) - 1));

    const [submissions, countResult] = await Promise.all([
      queryAsync(query, params),
      queryAsync(countQuery, countParams),
    ]);

    const total = countResult[0]?.total || 0;

    const groupedSubmissions = submissions.reduce((acc, row) => {
      if (!row.id) {
        return acc;
      }
      const submission = acc.find((s) => s.id === row.id);
      const expense = row.expense_item_id
        ? {
            id: row.expense_item_id,
            expense_date: row.expense_date || "N/A",
            purpose: row.expense_purpose || "N/A",
            amount: Number(row.amount) || 0,
          }
        : null;

      if (submission) {
        if (expense) submission.expenses.push(expense);
      } else {
        acc.push({
          id: row.id,
          employee_id: row.employee_id || "N/A",
          employee_name: row.employee_name || row.employee_id || "Unknown",
          department_name: row.department_name || "Unknown",
          travel_date: row.travel_date || "N/A",
          destination: row.destination || "N/A",
          travel_purpose: row.travel_purpose || "N/A",
          total_amount: Number(row.total_amount) || 0,
          status: row.status || "Unknown",
          approved_by: row.approved_by || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          admin_comment: row.admin_comment || null,
          receipt_path: row.receipt_path || null,
          expenses: expense ? [expense] : [],
        });
      }
      return acc;
    }, []);

    res.status(200).json({
      message: groupedSubmissions.length > 0
        ? "Travel expense submissions fetched successfully"
        : "No travel expense submissions found",
      data: groupedSubmissions,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
};

const fetchTravelExpenseHistory = async (req, res) => {
  const { role, id } = req.user;
  const { page = 1, limit = 10 } = req.query;

  if (!["employee", "dept_head", "hr", "super_admin"].includes(role)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  try {
    const [user] = await queryAsync("SELECT employee_id, role, department_name FROM hrms_users WHERE id = ?", [id]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    let query = `
      SELECT te.*, ei.id AS expense_item_id, ei.expense_date, ei.purpose AS expense_purpose, ei.amount,
             u.full_name AS employee_name, u.department_name
      FROM travel_expenses te
      LEFT JOIN expense_items ei ON te.id = ei.travel_expense_id
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
      WHERE te.status IN ('Approved', 'Rejected')
    `;
    let countQuery = `
      SELECT COUNT(DISTINCT te.id) as total
      FROM travel_expenses te
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
      WHERE te.status IN ('Approved', 'Rejected')
    `;
    let params = [];
    let countParams = [];

    // Filter by employee_id for employee and dept_head roles
    if (["employee", "dept_head"].includes(role)) {
      query += " AND te.employee_id = ?";
      countQuery += " AND te.employee_id = ?";
      params.push(user.employee_id);
      countParams.push(user.employee_id);
    }

    query += " ORDER BY te.created_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit), Number(limit) * (Number(page) - 1));

    const [submissions, countResult] = await Promise.all([
      queryAsync(query, params),
      queryAsync(countQuery, countParams),
    ]);

    const total = countResult[0]?.total || 0;

    const groupedSubmissions = submissions.reduce((acc, row) => {
      if (!row.id) {
        return acc;
      }
      const submission = acc.find((s) => s.id === row.id);
      const expense = row.expense_item_id
        ? {
            id: row.expense_item_id,
            expense_date: row.expense_date || "N/A",
            purpose: row.expense_purpose || "N/A",
            amount: Number(row.amount) || 0,
          }
        : null;

      if (submission) {
        if (expense) submission.expenses.push(expense);
      } else {
        acc.push({
          id: row.id,
          employee_id: row.employee_id || "N/A",
          employee_name: row.employee_name || row.employee_id || "Unknown",
          department_name: row.department_name || "Unknown",
          travel_date: row.travel_date || "N/A",
          destination: row.destination || "N/A",
          travel_purpose: row.travel_purpose || "N/A",
          total_amount: Number(row.total_amount) || 0,
          status: row.status || "Unknown",
          approved_by: row.approved_by || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
          admin_comment: row.admin_comment || null,
          receipt_path: row.receipt_path || null,
          expenses: expense ? [expense] : [],
        });
      }
      return acc;
    }, []);

    res.status(200).json({
      message: groupedSubmissions.length > 0
        ? "Travel expense history fetched successfully"
        : "No travel expense history records found",
      data: groupedSubmissions,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch travel expense history" });
  }
};

const fetchTravelExpenseById = async (req, res) => {
  const { role, id } = req.user;

  try {
    const [user] = await queryAsync("SELECT employee_id, role, department_name FROM hrms_users WHERE id = ?", [id]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const submissions = await queryAsync(
      `
      SELECT te.*, ei.id AS expense_item_id, ei.expense_date, ei.purpose AS expense_purpose, ei.amount,
             u.full_name AS employee_name, u.department_name
      FROM travel_expenses te
      LEFT JOIN expense_items ei ON te.id = ei.travel_expense_id
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
      WHERE te.id = ?
      `,
      [req.params.id]
    );

    if (submissions.length === 0) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (role === "employee" && submissions[0].employee_id !== user.employee_id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }
    if (role === "dept_head" && submissions[0].department_name !== user.department_name) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    const submission = submissions.reduce(
      (acc, row) => {
        const expense = row.expense_item_id
          ? {
              id: row.expense_item_id,
              expense_date: row.expense_date,
              purpose: row.expense_purpose,
              amount: row.amount,
            }
          : null;

        if (!acc.id) {
          acc = {
            id: row.id,
            employee_id: row.employee_id,
            employee_name: row.employee_name || row.employee_id || "Unknown",
            department_name: row.department_name || "Unknown",
            travel_date: row.travel_date,
            destination: row.destination,
            travel_purpose: row.travel_purpose,
            total_amount: row.total_amount,
            status: row.status || "Unknown",
            approved_by: row.approved_by,
            created_at: row.created_at,
            updated_at: row.updated_at,
            admin_comment: row.admin_comment || null,
            receipt_path: row.receipt_path,
            expenses: expense ? [expense] : [],
          };
        } else if (expense) {
          acc.expenses.push(expense);
        }
        return acc;
      },
      {}
    );

    res.status(200).json({
      message: "Travel expense submission fetched successfully",
      data: submission,
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch submission" });
  }
};

const updateTravelExpenseStatus = async (req, res) => {
  const { status, admin_comment } = req.body;
  const id = req.params.id;
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  const departmentName = req.user.department_name;

  if (!["hr", "super_admin", "dept_head"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }
  if (!id) {
    return res.status(400).json({ error: "Submission ID is required" });
  }
  if (!status || !["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid or missing status. Must be 'Approved' or 'Rejected'" });
  }

  try {
    const [submission] = await queryAsync(
      `SELECT te.*, u.department_name 
       FROM travel_expenses te
       JOIN hrms_users u ON te.employee_id = u.employee_id
       WHERE te.id = ? AND te.status = 'Pending'`,
      [id]
    );

    if (!submission) {
      return res.status(404).json({ error: "Submission not found or not in Pending status" });
    }
    if (userRole === "dept_head" && submission.department_name !== departmentName) {
      return res.status(403).json({ error: "Access denied: Submission not in your department" });
    }

    await queryAsync(
      `UPDATE travel_expenses 
       SET status = ?, admin_comment = ?, approved_by = ?, updated_at = NOW()
       WHERE id = ?`,
      [status, admin_comment || null, userId, id]
    );

    res.json({ message: `Travel expense ${status.toLowerCase()} successfully` });
  } catch (err) {
    res.status(500).json({ error: "Database error during status update" });
  }
};

const downloadReceipt = async (req, res) => {
  const { role, id } = req.user;
  const { id: travelExpenseId } = req.params;

  try {
    const [user] = await queryAsync("SELECT employee_id, role, department_name FROM hrms_users WHERE id = ?", [id]);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const [travelExpense] = await queryAsync(
      `
      SELECT te.receipt_path, te.employee_id, u.department_name, u.full_name
      FROM travel_expenses te
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
      WHERE te.id = ?
      `,
      [travelExpenseId]
    );

    if (!travelExpense) {
      return res.status(404).json({ error: "Travel expense not found" });
    }

    if (!travelExpense.receipt_path) {
      return res.status(404).json({ error: "No receipt uploaded for this travel expense" });
    }

    if (role === "employee" && travelExpense.employee_id !== user.employee_id) {
      return res.status(403).json({ error: "Unauthorized access" });
    }
    if (role === "dept_head" && travelExpense.department_name !== user.department_name) {
      return res.status(403).json({ error: "Unauthorized access" });
    }

    const filename = path.basename(travelExpense.receipt_path);
    const filePath = path.join(uploadDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Receipt file not found on server" });
    }

    res.download(filePath, filename);
  } catch (error) {
    res.status(500).json({ error: "Failed to download receipt" });
  }
};

module.exports = {
  submitTravelExpense,
  fetchTravelExpenses,
  fetchTravelExpenseHistory,
  fetchTravelExpenseById,
  updateTravelExpenseStatus,
  downloadReceipt,
};