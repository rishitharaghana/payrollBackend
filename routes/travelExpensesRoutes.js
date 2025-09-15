const express = require('express');
const { authenticateToken } = require('../middleware/authenticate');
const { fetchTravelExpenses, submitTravelExpense, fetchTravelExpenseById, updateTravelExpenseStatus, downloadReceipt, fetchTravelExpenseHistory } = require('../controllers/travelExpensesController');
const router = express.Router();

router.post('/travel-expenses', authenticateToken,  submitTravelExpense);
router.get('/travel-expenses', authenticateToken, fetchTravelExpenses);
router.put('/travel-expenses/:id', authenticateToken, updateTravelExpenseStatus);
router.get('/travel-expenses/:id', authenticateToken, downloadReceipt);
router.get('/travel-expenses/:id', authenticateToken, fetchTravelExpenseById);
router.get('/travel-expenses/history', authenticateToken, fetchTravelExpenseHistory)

module.exports = router;    