const pool = require('../config/db');
const util = require('util');
const path = require('path');
const fs = require('fs').promises;
const queryAsync = util.promisify(pool.query).bind(pool);

const createTravelExpenses = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const { travelDate, destination, travelPurpose, expenses, totalAmount } = req.body;

  if (!['super_admin', 'hr', 'dept_head', 'employee'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  if (!travelDate || !destination?.trim() || !travelPurpose?.trim() || !expenses || !Array.isArray(expenses) || expenses.length === 0) {
    return res.status(400).json({ error: 'Travel date, destination, travel purpose, and at least one expense are required' });
  }

  if (!totalAmount || isNaN(totalAmount) || totalAmount <= 0) {
    return res.status(400).json({ error: 'Valid total amount is required' });
  }

  for (const exp of expenses) {
    if (!exp.date || !exp.purpose?.trim() || !exp.amount || isNaN(exp.amount) || exp.amount <= 0 || !exp.category) {
      return res.status(400).json({ error: 'Each expense must have a valid date, purpose, amount, and category' });
    }
    if (!['transport', 'accommodation', 'meals', 'miscellaneous'].includes(exp.category)) {
      return res.status(400).json({ error: 'Invalid expense category' });
    }
  }

  const files = req.files || [];
  if (files.length > 0) {
    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'File size exceeds 5MB limit' });
      }
    }
  }

  try {
    const table = userRole === 'super_admin' ? 'hrms_users' :
                  userRole === 'hr' ? 'hrs' :
                  userRole === 'dept_head' ? 'dept_heads' : 'employees';
    const [user] = await queryAsync(
      `SELECT employee_id FROM ${table} WHERE id = ?`,
      [userId]
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const employeeId = user.employee_id;

    await queryAsync('START TRANSACTION');

    const travelExpenseQuery = `
      INSERT INTO travel_expenses (
        employee_id, user_role, travel_date, destination, travel_purpose,
        total_amount, status, submitted_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const travelExpenseValues = [
      employeeId,
      userRole,
      travelDate,
      destination,
      travelPurpose,
      totalAmount,
      'pending',
      userId,
    ];
    const travelExpenseResult = await queryAsync(travelExpenseQuery, travelExpenseValues);
    const travelExpenseId = travelExpenseResult.insertId;

    for (const exp of expenses) {
      const expenseItemQuery = `
        INSERT INTO expense_items (travel_expense_id, expense_date, purpose, amount, category)
        VALUES (?, ?, ?, ?, ?)
      `;
      await queryAsync(expenseItemQuery, [travelExpenseId, exp.date, exp.purpose, exp.amount, exp.category]);
    }

    const fileRecords = [];
    for (const file of files) {
      const filePath = path.join('uploads', 'receipts', `${travelExpenseId}_${Date.now()}_${file.originalname}`);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, file.buffer);
      const fileQuery = `
        INSERT INTO expense_receipts (travel_expense_id, file_name, file_url, file_size)
        VALUES (?, ?, ?, ?)
      `;
      await queryAsync(fileQuery, [travelExpenseId, file.originalname, filePath, file.size]);
      fileRecords.push({ file_name: file.originalname, file_url: filePath, file_size: file.size });
    }

    await queryAsync('COMMIT');

    res.status(201).json({
      message: 'Travel expenses created successfully',
      data: {
        id: travelExpenseId,
        employee_id: employeeId,
        user_role: userRole,
        travel_date: travelDate,
        destination,
        travel_purpose: travelPurpose,
        total_amount: totalAmount,
        status: 'pending',
        submitted_by: userId,
        expenses,
        receipts: fileRecords,
      },
    });
  } catch (err) {
    await queryAsync('ROLLBACK');
    console.error('DB error:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error during creation: ${err.message}` });
  }
};

const fetchTravelExpenses = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;

  if (!['super_admin', 'hr', 'dept_head', 'employee'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  try {
    let query = `
      SELECT te.id, te.employee_id, te.user_role, te.travel_date, te.destination,
             te.travel_purpose, te.total_amount, te.status, te.submitted_by,
             te.approved_by, te.created_at, te.updated_at
      FROM travel_expenses te
    `;
    let values = [];

    if (userRole === 'employee' || userRole === 'dept_head') {
      const table = userRole === 'employee' ? 'employees' : 'dept_heads';
      const [user] = await queryAsync(`SELECT employee_id FROM ${table} WHERE id = ?`, [userId]);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      query += ' WHERE te.employee_id = ? AND te.user_role = ?';
      values.push(user.employee_id, userRole);
    }

    const travelExpenses = await queryAsync(query, values);

    for (const expense of travelExpenses) {
      const expenseItems = await queryAsync(
        'SELECT id, expense_date, purpose, amount, category FROM expense_items WHERE travel_expense_id = ?',
        [expense.id]
      );
      const receipts = await queryAsync(
        'SELECT id, file_name, file_url, file_size FROM expense_receipts WHERE travel_expense_id = ?',
        [expense.id]
      );
      expense.expenses = expenseItems;
      expense.receipts = receipts;
    }

    res.json({
      message: 'Travel expenses fetched successfully',
      data: travelExpenses,
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

const updateTravelExpenses = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const { id } = req.params;
  const { travelDate, destination, travelPurpose, expenses, totalAmount } = req.body;

  if (!['super_admin', 'hr', 'dept_head', 'employee'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  if (!travelDate || !destination?.trim() || !travelPurpose?.trim() || !expenses || !Array.isArray(expenses) || expenses.length === 0) {
    return res.status(400).json({ error: 'Travel date, destination, travel purpose, and at least one expense are required' });
  }

  if (!totalAmount || isNaN(totalAmount) || totalAmount <= 0) {
    return res.status(400).json({ error: 'Valid total amount is required' });
  }

  for (const exp of expenses) {
    if (!exp.date || !exp.purpose?.trim() || !exp.amount || isNaN(exp.amount) || exp.amount <= 0 || !exp.category) {
      return res.status(400).json({ error: 'Each expense must have a valid date, purpose, amount, and category' });
    }
    if (!['transport', 'accommodation', 'meals', 'miscellaneous'].includes(exp.category)) {
      return res.status(400).json({ error: 'Invalid expense category' });
    }
  }

  try {
    if (userRole === 'employee' || userRole === 'dept_head') {
      const table = userRole === 'employee' ? 'employees' : 'dept_heads';
      const [user] = await queryAsync(`SELECT employee_id FROM ${table} WHERE id = ?`, [userId]);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const [expense] = await queryAsync('SELECT employee_id, user_role FROM travel_expenses WHERE id = ?', [id]);
      if (!expense || expense.employee_id !== user.employee_id || expense.user_role !== userRole) {
        return res.status(403).json({ error: 'Access denied: Cannot update another user’s expenses' });
      }
    }

    await queryAsync('START TRANSACTION');

    const updateQuery = `
      UPDATE travel_expenses SET
        travel_date = ?, destination = ?, travel_purpose = ?, total_amount = ?
      WHERE id = ?
    `;
    const updateValues = [travelDate, destination, travelPurpose, totalAmount, id];
    const updateResult = await queryAsync(updateQuery, updateValues);
    if (updateResult.affectedRows === 0) {
      await queryAsync('ROLLBACK');
      return res.status(404).json({ error: 'Travel expense record not found' });
    }

    await queryAsync('DELETE FROM expense_items WHERE travel_expense_id = ?', [id]);

    for (const exp of expenses) {
      const expenseItemQuery = `
        INSERT INTO expense_items (travel_expense_id, expense_date, purpose, amount, category)
        VALUES (?, ?, ?, ?, ?)
      `;
      await queryAsync(expenseItemQuery, [id, exp.date, exp.purpose, exp.amount, exp.category]);
    }

    const files = req.files || [];
    if (files.length > 0) {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          await queryAsync('ROLLBACK');
          return res.status(400).json({ error: 'File size exceeds 5MB limit' });
        }
        const filePath = path.join('uploads', 'receipts', `${id}_${Date.now()}_${file.originalname}`);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, file.buffer);
        const fileQuery = `
          INSERT INTO expense_receipts (travel_expense_id, file_name, file_url, file_size)
          VALUES (?, ?, ?, ?)
        `;
        await queryAsync(fileQuery, [id, file.originalname, filePath, file.size]);
      }
    }
    await queryAsync('COMMIT');

    res.json({
      message: 'Travel expenses updated successfully',
      data: {
        id,
        travel_date: travelDate,
        destination,
        travel_purpose: travelPurpose,
        total_amount: totalAmount,
        expenses,
      },
    });
  } catch (err) {
    await queryAsync('ROLLBACK');
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error during update' });
  }
};

const deleteTravelExpenses = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const { id } = req.params;

  if (!['super_admin', 'hr', 'dept_head', 'employee'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  try {
    if (userRole === 'employee' || userRole === 'dept_head') {
      const table = userRole === 'employee' ? 'employees' : 'dept_heads';
      const [user] = await queryAsync(`SELECT employee_id FROM ${table} WHERE id = ?`, [userId]);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      const [expense] = await queryAsync('SELECT employee_id, user_role FROM travel_expenses WHERE id = ?', [id]);
      if (!expense || expense.employee_id !== user.employee_id || expense.user_role !== userRole) {
        return res.status(403).json({ error: 'Access denied: Cannot delete another user’s expenses' });
      }
    }

    const deleteQuery = 'DELETE FROM travel_expenses WHERE id = ?';
    const deleteResult = await queryAsync(deleteQuery, [id]);
    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Travel expense record not found' });
    }

    res.json({ message: 'Travel expenses deleted successfully', id });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error during deletion' });
  }
};

const approveTravelExpenses = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const { id } = req.params;
  const { status } = req.body;

  if (!['super_admin', 'hr'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Only super_admin or hr can approve expenses' });
  }

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "approved" or "rejected"' });
  }

  try {
    const updateQuery = `
      UPDATE travel_expenses SET
        status = ?, approved_by = ?
      WHERE id = ?
    `;
    const updateResult = await queryAsync(updateQuery, [status, userId, id]);
    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ error: 'Travel expense record not found' });
    }

    res.json({
      message: `Travel expenses ${status} successfully`,
      data: { id, status, approved_by: userId },
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error during approval' });
  }
};

module.exports = {
  createTravelExpenses,
  fetchTravelExpenses,
  updateTravelExpenses,
  deleteTravelExpenses,
  approveTravelExpenses,
};