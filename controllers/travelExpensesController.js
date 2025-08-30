const pool = require('../config/db');
const util = require('util');
const queryAsync = util.promisify(pool.query).bind(pool);


const submitTravelExpense = async (req, res) => {
  const { employee_id, travel_date, destination, travel_purpose, total_amount, expenses } = req.body;
  const receipts = req.files || [];
  const { role, id } = req.user;

  if (!employee_id || !travel_date || !destination || !travel_purpose || !total_amount || !expenses) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const [employee] = await queryAsync('SELECT employee_id FROM employees WHERE employee_id = ?', [employee_id]);
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    const stringEmployeeId = employee.employee_id;

    let userTable;
    if (role === 'super_admin') userTable = 'hrms_users';
    else if (role === 'hr') userTable = 'hrs';
    else if (role === 'dept_head') userTable = 'dept_heads';
    else userTable = 'employees';

    const [user] = await queryAsync(`SELECT employee_id FROM ${userTable} WHERE id = ?`, [id]);
    if (!user || (user.employee_id !== stringEmployeeId && !['super_admin', 'hr'].includes(role))) {
      return res.status(403).json({ error: 'Unauthorized to submit for this employee' });
    }

    let parsedExpenses;
    try {
      parsedExpenses = JSON.parse(expenses);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid expenses format' });
    }
    if (!Array.isArray(parsedExpenses) || parsedExpenses.length === 0) {
      return res.status(400).json({ error: 'Invalid expenses data' });
    }

    const status = ['hr', 'super_admin'].includes(role) ? 'Approved' : 'Pending';
    const submitted_to = role === 'employee' ? 'hr' : 'super_admin';

    const travelExpenseResult = await queryAsync(
      `
  INSERT INTO travel_expenses 
  (employee_id, travel_date, destination, travel_purpose, total_amount, status, approved_by, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'Pending', NULL, NOW(), NOW())
`,
      [stringEmployeeId, travel_date, destination, travel_purpose, total_amount, status, submitted_to, id]
    );
    const travelExpenseId = travelExpenseResult.insertId;

    for (const exp of parsedExpenses) {
      if (!exp.expense_date || !exp.purpose || !exp.amount) {
        return res.status(400).json({ error: 'Invalid expense item data' });
      }
      await queryAsync(
        `INSERT INTO expense_items (travel_expense_id, expense_date, purpose, amount)
         VALUES (?, ?, ?, ?)`,
        [travelExpenseId, exp.expense_date, exp.purpose, exp.amount]
      );
    }

    for (let i = 0; i < receipts.length; i++) {
      if (parsedExpenses[i]?.hasReceipt) {
        const file = receipts[i];
        await queryAsync(
          `INSERT INTO expense_receipts (travel_expense_id, file_name, file_path, file_size, uploaded_at)
           VALUES (?, ?, ?, ?, NOW())`,
          [travelExpenseId, file.originalname, file.path, file.size]
        );
      }
    }

    res.status(201).json({
      message: `Travel expense submitted successfully${status === 'Approved' ? ' and auto-approved' : ''}`,
      data: {
        id: travelExpenseId,
        employee_id: stringEmployeeId,
        travel_date,
        destination,
        travel_purpose,
        total_amount,
        status,
      },
    });
  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: 'Failed to submit travel expense' });
  }
};

const fetchTravelExpenses = async (req, res) => {
  const { role, id } = req.user;

  try {
    let userTable;
    if (role === 'super_admin') userTable = 'hrms_users';
    else if (role === 'hr') userTable = 'hrs';
    else if (role === 'dept_head') userTable = 'dept_heads';
    else userTable = 'employees';

    const [user] = await queryAsync(`SELECT employee_id FROM ${userTable} WHERE id = ?`, [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let query = `
      SELECT te.*, ei.id AS expense_item_id, ei.expense_date, ei.purpose AS expense_purpose, ei.amount,
             er.id AS receipt_id, er.file_name, er.file_path, er.file_size,
             COALESCE(e.full_name, h.full_name, d.full_name, u.name) AS employee_name,
             COALESCE(e.department_name, d.department_name, h.department_name, u.department) AS department_name
      FROM travel_expenses te
      LEFT JOIN expense_items ei ON te.id = ei.travel_expense_id
      LEFT JOIN expense_receipts er ON te.id = er.travel_expense_id
      LEFT JOIN employees e ON te.employee_id = e.employee_id
      LEFT JOIN hrs h ON te.employee_id = h.employee_id
      LEFT JOIN dept_heads d ON te.employee_id = d.employee_id
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
    `;
    let params = [];

    if (role === 'dept_head') {
      const [deptHead] = await queryAsync('SELECT department_name FROM dept_heads WHERE id = ?', [id]);
      if (!deptHead) {
        return res.status(403).json({ error: 'Access denied: Not a department head' });
      }
      query += ' WHERE (e.department_name = ? OR d.department_name = ? OR h.department_name = ? OR u.department = ?) AND te.status = ?';
      params = [deptHead.department_name, deptHead.department_name, deptHead.department_name, deptHead.department_name, 'Pending'];
    } else if (role === 'employee') {
      query += ' WHERE te.employee_id = ?';
      params = [user.employee_id];
    } else {
      query += ' WHERE te.status = ?';
      params = ['Pending'];
    }

    query += ' ORDER BY te.created_at DESC';

    const submissions = await queryAsync(query, params);

    const groupedSubmissions = submissions.reduce((acc, row) => {
      const submission = acc.find(s => s.id === row.id);
      const expense = {
        id: row.expense_item_id,
        expense_date: row.expense_date,
        purpose: row.expense_purpose,
        amount: row.amount,
        receipt: row.receipt_id ? {
          id: row.receipt_id,
          file_name: row.file_name,
          file_path: row.file_path,
          file_size: row.file_size,
        } : null,
      };

      if (submission) {
        submission.expenses.push(expense);
      } else {
        acc.push({
          id: row.id,
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          department_name: row.department_name,
          travel_date: row.travel_date,
          destination: row.destination,
          travel_purpose: row.travel_purpose,
          total_amount: row.total_amount,
          status: row.status,
          approved_by: row.approved_by,
          created_at: row.created_at,
          updated_at: row.updated_at,
          expenses: [expense],
        });
      }
      return acc;
    }, []);

    res.status(200).json({
      message: 'Travel expense submissions fetched successfully',
      data: groupedSubmissions,
    });
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
};

const fetchTravelExpenseById = async (req, res) => {
  const { role, id } = req.user;

  try {
    let userTable;
    if (role === 'super_admin') userTable = 'hrms_users';
    else if (role === 'hr') userTable = 'hrs';
    else if (role === 'dept_head') userTable = 'dept_heads';
    else userTable = 'employees';

    const [user] = await queryAsync(`SELECT employee_id FROM ${userTable} WHERE id = ?`, [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [submissions] = await queryAsync(`
      SELECT te.*, ei.id AS expense_item_id, ei.expense_date, ei.purpose AS expense_purpose, ei.amount,
             er.id AS receipt_id, er.file_name, er.file_path, er.file_size,
             COALESCE(e.full_name, h.full_name, d.full_name, u.full_name) AS employee_name,
             COALESCE(e.department_name, d.department_name, h.department_name, u.department) AS department_name
      FROM travel_expenses te
      LEFT JOIN expense_items ei ON te.id = ei.travel_expense_id
      LEFT JOIN expense_receipts er ON te.id = er.travel_expense_id
      LEFT JOIN employees e ON te.employee_id = e.employee_id
      LEFT JOIN hrs h ON te.employee_id = h.employee_id
      LEFT JOIN dept_heads d ON te.employee_id = d.employee_id
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
      WHERE te.id = ?
    `, [req.params.id]);

    if (submissions.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (role === 'employee' && submissions[0].employee_id !== user.employee_id) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    if (role === 'dept_head') {
      const [deptHead] = await queryAsync('SELECT department_name FROM dept_heads WHERE id = ?', [id]);
      if (!deptHead || submissions[0].department_name !== deptHead.department_name) {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
    }

    const submission = submissions.reduce((acc, row) => {
      const expense = {
        id: row.expense_item_id,
        expense_date: row.expense_date,
        purpose: row.expense_purpose,
        amount: row.amount,
        receipt: row.receipt_id ? {
          id: row.receipt_id,
          file_name: row.file_name,
          file_path: row.file_path,
          file_size: row.file_size,
        } : null,
      };

      if (!acc.id) {
        acc = {
          id: row.id,
          employee_id: row.employee_id,
          employee_full_name: row.employee_full_name,
          department_name: row.department_name,
          travel_date: row.travel_date,
          destination: row.destination,
          travel_purpose: row.travel_purpose,
          total_amount: row.total_amount,
          status: row.status,
          approved_by: row.approved_by,
          created_at: row.created_at,
          updated_at: row.updated_at,
          expenses: [expense],
        };
      } else {
        acc.expenses.push(expense);
      }
      return acc;
    }, {});

    res.status(200).json({
      message: 'Travel expense submission fetched successfully',
      data: submission,
    });
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
};

const updateTravelExpenseStatus = async (req, res) => {
  const { role, id } = req.user;
  const { id: travelExpenseId } = req.params;
  const { status, admin_comment } = req.body;

  if (!["super_admin", "hr"].includes(role)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  if (!["Approved", "Rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be 'Approved' or 'Rejected'" });
  }

  try {
    const [submission] = await queryAsync("SELECT * FROM travel_expenses WHERE id = ?", [
      travelExpenseId,
    ]);
    if (!submission) {
      return res.status(404).json({ error: "Submission not found" });
    }

    if (submission.status !== "Pending") {
      return res.status(400).json({ error: "Only pending records can be updated" });
    }

   let userTable = role === "super_admin" ? "hrms_users" : "hrs";
const [user] = await queryAsync(`SELECT employee_id FROM ${userTable} WHERE id = ?`, [id]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    await queryAsync(
  `UPDATE travel_expenses 
   SET status = ?, approved_by = ?, admin_comment = ?, updated_at = NOW() 
   WHERE id = ?`,
  [status, user.employee_id, admin_comment || null, travelExpenseId]  
);


    res.status(200).json({
      message: `Submission ${status.toLowerCase()} successfully`,
      data: { id: travelExpenseId, status, admin_comment: admin_comment || null },
    });
  } catch (error) {
    console.error("Update error:", error);
    res.status(500).json({ error: "Failed to update submission" });
  }
};
const downloadReceipt = async (req, res) => {
  const { role, id } = req.user;

  try {
    let userTable;
    if (role === 'super_admin') userTable = 'hrms_users';
    else if (role === 'hr') userTable = 'hrs';
    else if (role === 'dept_head') userTable = 'dept_heads';
    else userTable = 'employees';

    const [user] = await queryAsync(`SELECT employee_id FROM ${userTable} WHERE id = ?`, [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [receipt] = await queryAsync(
      `SELECT er.*, te.employee_id, COALESCE(e.department_name, d.department_name, h.department_name, u.department) AS department_name
       FROM expense_receipts er
       LEFT JOIN travel_expenses te ON er.travel_expense_id = te.id
       LEFT JOIN employees e ON te.employee_id = e.employee_id
       LEFT JOIN hrs h ON te.employee_id = h.employee_id
       LEFT JOIN dept_heads d ON te.employee_id = d.employee_id
       LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
       WHERE er.id = ?`,
      [req.params.id]
    );

    if (!receipt) {
      return res.status(404).json({ error: 'Receipt not found' });
    }

    if (role === 'employee' && receipt.employee_id !== user.employee_id) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    if (role === 'dept_head') {
      const [deptHead] = await queryAsync('SELECT department_name FROM dept_heads WHERE id = ?', [id]);
      if (!deptHead || receipt.department_name !== deptHead.department_name) {
        return res.status(403).json({ error: 'Unauthorized access' });
      }
    }

    res.download(receipt.file_path, receipt.file_name);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download receipt' });
  }
};

module.exports = {
  submitTravelExpense,
  fetchTravelExpenses,
  fetchTravelExpenseById,
  updateTravelExpenseStatus,
  downloadReceipt,
};