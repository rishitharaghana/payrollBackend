const express = require('express');
const { authenticateToken } = require('../middleware/authenticate');
const { fetchTravelExpenses, createTravelExpenses, updateTravelExpenses, deleteTravelExpenses, approveTravelExpenses } = require('../controllers/travelExpensesController');
const router = express.Router();

router.post('/travel-expenses', authenticateToken, createTravelExpenses);
router.get('/travel-expenses', authenticateToken, fetchTravelExpenses);
router.put('/travel-expenses/:id', authenticateToken, updateTravelExpenses);
router.delete('/travel-expenses/:id', authenticateToken, deleteTravelExpenses);
router.put('/travel-expenses/approve', authenticateToken, approveTravelExpenses);

module.exports = router;