const pool = require('../config/db');
const util = require('util');
const path = require('path');
const fs = require('fs');

const { createMulterInstance } = require('../middleware/upload');

const queryAsync = util.promisify(pool.query).bind(pool);

const uploadDir = path.join(__dirname, '../Uploads');
if (!fs.existsSync(uploadDir)) {
  console.log(`Creating upload directory: ${uploadDir}`);
  fs.mkdirSync(uploadDir, { recursive: true });
}

const allowedTypes = {
  receipt: ['.jpg', '.jpeg', '.png', '.pdf'],
};

const upload = createMulterInstance(uploadDir, allowedTypes, {
  fileSize: 5 * 1024 * 1024, 
});

const submitTravelExpense = async (req, res) => {
  // Apply Multer middleware to handle file uploads
  upload.fields([{ name: 'receipt', maxCount: 1 }])(req, res, async (err) => {
    if (err) {
      console.error('Multer error:', err.message, err.code);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Receipt size exceeds 5MB limit' });
      }
      if (err.message.includes('Invalid file type')) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }

    const { employee_id, travel_date, destination, travel_purpose, total_amount, expenses } = req.body;
    const receipt = req.files?.['receipt']?.[0];
    const { role, id } = req.user;

    // Input validation
    if (!employee_id || !travel_date || !destination || !travel_purpose || !total_amount || !expenses) {
      if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path); // Clean up uploaded file
      return res.status(400).json({ error: 'All fields are required' });
    }

    // Validate travel_date format
    if (isNaN(Date.parse(travel_date))) {
      if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
      return res.status(400).json({ error: 'Invalid travel date' });
    }

    try {
      // Verify employee exists
      const [employee] = await queryAsync('SELECT employee_id FROM hrms_users WHERE employee_id = ?', [employee_id]);
      if (!employee) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(404).json({ error: 'Employee not found' });
      }
      const stringEmployeeId = employee.employee_id;

      // Verify user authorization
      const [user] = await queryAsync('SELECT employee_id, role FROM hrms_users WHERE id = ?', [id]);
      if (!user || (user.employee_id !== stringEmployeeId && !['super_admin', 'hr'].includes(role))) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(403).json({ error: 'Unauthorized to submit for this employee' });
      }

      // Parse and validate expenses
      let parsedExpenses;
      try {
        parsedExpenses = JSON.parse(expenses);
      } catch (error) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(400).json({ error: 'Invalid expenses format' });
      }
      if (!Array.isArray(parsedExpenses) || parsedExpenses.length === 0) {
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        return res.status(400).json({ error: 'Invalid expenses data' });
      }

      // Validate expense items
      for (const exp of parsedExpenses) {
        if (!exp.expense_date || !exp.purpose || !exp.amount || isNaN(exp.amount) || exp.amount <= 0) {
          if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
          return res.status(400).json({ error: 'Invalid expense item data' });
        }
        if (isNaN(Date.parse(exp.expense_date))) {
          if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
          return res.status(400).json({ error: 'Invalid expense date' });
        }
      }

      let receiptPath = null;
      if (receipt) {
        if (!fs.existsSync(receipt.path)) {
          return res.status(500).json({ error: 'Failed to save uploaded receipt' });
        }
        const baseUrl = process.env.UPLOADS_BASE_URL || `http:localhost:3007/uploads/`;
        receiptPath = `${baseUrl}${receipt.filename}`;
      }

      const status = ['hr', 'super_admin'].includes(role) ? 'Approved' : 'Pending';
      const submitted_to = role === 'employee' ? 'hr' : 'super_admin';

      await queryAsync('START TRANSACTION');

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

        await queryAsync('COMMIT');

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
            receipt_path: receiptPath,
          },
        });
      } catch (error) {
        await queryAsync('ROLLBACK');
        if (receipt && fs.existsSync(receipt.path)) fs.unlinkSync(receipt.path);
        throw error;
      }
    } catch (error) {
      console.error('Submit error:', error.message, error.sqlMessage, error.code);
      res.status(500).json({ error: 'Failed to submit travel expense' });
    }
  });
};

const fetchTravelExpenses = async (req, res) => {
  const { role, id } = req.user;
  const { page = 1, limit = 10 } = req.query;

  try {
    const [user] = await queryAsync('SELECT employee_id, role, department_name FROM hrms_users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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

    if (role === 'dept_head') {
      query += ' WHERE u.department_name = ? AND te.status = ?';
      countQuery += ' WHERE u.department_name = ? AND te.status = ?';
      params = [user.department_name, 'Pending'];
      countParams = [user.department_name, 'Pending'];
    } else if (role === 'employee') {
      query += ' WHERE te.employee_id = ?';
      countQuery += ' WHERE te.employee_id = ?';
      params = [user.employee_id];
      countParams = [user.employee_id];
    } else {
      query += ' WHERE te.status = ?';
      countQuery += ' WHERE te.status = ?';
      params = ['Pending'];
      countParams = ['Pending'];
    }

    query += ' ORDER BY te.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(limit) * (Number(page) - 1));

    const [submissions, countResult] = await Promise.all([
      queryAsync(query, params),
      queryAsync(countQuery, countParams),
    ]);


    const total = countResult.length > 0 && countResult[0].total !== undefined ? countResult[0].total : 0;

    const groupedSubmissions = submissions.reduce((acc, row) => {
      if (!row.id) return acc; 
      const submission = acc.find(s => s.id === row.id);
      const expense = row.expense_item_id
        ? {
            id: row.expense_item_id,
            expense_date: row.expense_date,
            purpose: row.expense_purpose,
            amount: row.amount,
          }
        : null;

      if (submission) {
        if (expense) submission.expenses.push(expense);
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
          receipt_path: row.receipt_path,
          admin_comment: row.admin_comment || null,
          expenses: expense ? [expense] : [],
        });
      }
      return acc;
    }, []);

    res.status(200).json({
      message: 'Travel expense submissions fetched successfully',
      data: groupedSubmissions,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error('Fetch error:', error.message, error.sqlMessage, error.code);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
};

const fetchTravelExpenseHistory = async (req, res) => {
  const { role, id } = req.user;
  const { page = 1, limit = 10 } = req.query;

  if (!['super_admin', 'hr'].includes(role)) {
    return res.status(403).json({ error: 'Access denied: Only HR and Super Admin can view travel expense history' });
  }

  try {
    const [user] = await queryAsync('SELECT employee_id, role FROM hrms_users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const query = `
      SELECT te.*, ei.id AS expense_item_id, ei.expense_date, ei.purpose AS expense_purpose, ei.amount,
             u.full_name AS employee_name, u.department_name
      FROM travel_expenses te
      LEFT JOIN expense_items ei ON te.id = ei.travel_expense_id
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
      ORDER BY te.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const countQuery = `
      SELECT COUNT(*) as total
      FROM travel_expenses te
    `;
    const params = [Number(limit), Number(limit) * (Number(page) - 1)];

    const [submissions, countResult] = await Promise.all([
      queryAsync(query, params),
      queryAsync(countQuery, []),
    ]);

    // Log countResult for debugging
    console.log('countResult (history):', countResult);

    // Handle empty countResult
    const total = countResult.length > 0 && countResult[0].total !== undefined ? countResult[0].total : 0;

    const groupedSubmissions = submissions.reduce((acc, row) => {
      if (!row.id) return acc; // Skip rows with null id
      const submission = acc.find(s => s.id === row.id);
      const expense = row.expense_item_id
        ? {
            id: row.expense_item_id,
            expense_date: row.expense_date,
            purpose: row.expense_purpose,
            amount: row.amount,
          }
        : null;

      if (submission) {
        if (expense) submission.expenses.push(expense);
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
          admin_comment: row.admin_comment || null,
          receipt_path: row.receipt_path,
          expenses: expense ? [expense] : [],
        });
      }
      return acc;
    }, []);

    res.status(200).json({
      message: 'Travel expense history fetched successfully',
      data: groupedSubmissions,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    console.error('Fetch history error:', error.message, error.sqlMessage, error.code);
    res.status(500).json({ error: 'Failed to fetch travel expense history' });
  }
};

const fetchTravelExpenseById = async (req, res) => {
  const { role, id } = req.user;

  try {
    const [user] = await queryAsync('SELECT employee_id, role, department_name FROM hrms_users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const submissions = await queryAsync(`
      SELECT te.*, ei.id AS expense_item_id, ei.expense_date, ei.purpose AS expense_purpose, ei.amount,
             u.full_name AS employee_name, u.department_name
      FROM travel_expenses te
      LEFT JOIN expense_items ei ON te.id = ei.travel_expense_id
      LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
      WHERE te.id = ?
    `, [req.params.id]);

    if (submissions.length === 0) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (role === 'employee' && submissions[0].employee_id !== user.employee_id) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    if (role === 'dept_head' && submissions[0].department_name !== user.department_name) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    const submission = submissions.reduce((acc, row) => {
      const expense = {
        id: row.expense_item_id,
        expense_date: row.expense_date,
        purpose: row.expense_purpose,
        amount: row.amount,
        receipt_path: row.receipt_path,
      };

      if (!acc.id) {
        acc = {
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
          admin_comment: row.admin_comment || null,
          receipt_path: row.receipt_path,
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

  if (!['super_admin', 'hr'].includes(role)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  if (!['Approved', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: "Invalid status. Must be 'Approved' or 'Rejected'" });
  }

  try {
    const [submission] = await queryAsync('SELECT * FROM travel_expenses WHERE id = ?', [travelExpenseId]);
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    if (submission.status !== 'Pending') {
      return res.status(400).json({ error: 'Only pending records can be updated' });
    }

    const [user] = await queryAsync('SELECT employee_id FROM hrms_users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
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
    console.error('Update error:', error);
    res.status(500).json({ error: 'Failed to update submission' });
  }
};

const downloadReceipt = async (req, res) => {
  const { role, id } = req.user;
  const { id: travelExpenseId } = req.params;

  try {
    const [user] = await queryAsync('SELECT employee_id, role, department_name FROM hrms_users WHERE id = ?', [id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [travelExpense] = await queryAsync(
      `SELECT te.receipt_path, te.employee_id, u.department_name, u.full_name
       FROM travel_expenses te
       LEFT JOIN hrms_users u ON te.employee_id = u.employee_id
       WHERE te.id = ?`,
      [travelExpenseId]
    );

    if (!travelExpense) {
      return res.status(404).json({ error: 'Travel expense not found' });
    }

    if (!travelExpense.receipt_path) {
      return res.status(404).json({ error: 'No receipt uploaded for this travel expense' });
    }

    if (role === 'employee' && travelExpense.employee_id !== user.employee_id) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }
    if (role === 'dept_head' && travelExpense.department_name !== user.department_name) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    const filename = path.basename(travelExpense.receipt_path);
    const filePath = path.join(uploadDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Receipt file not found on server' });
    }

    res.download(filePath, filename);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download receipt' });
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