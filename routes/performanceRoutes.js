const express = require('express');
const { authenticateToken } = require('../middleware/authenticate');
const { fetchEmployeePerformance, setEmployeeGoal, updateGoalProgress, conductAppraisal, submitSelfReview } = require('../controllers/performanceController');
const router = express.Router();

router.get('/employee-performance/employee_id', authenticateToken, fetchEmployeePerformance);
router.post('/employee/goals', authenticateToken, setEmployeeGoal);
router.put('/employee-performance/goals/:goal_id', authenticateToken, updateGoalProgress);
router.post('/employee/appraisals', authenticateToken, conductAppraisal);
router.post('/employee/self-review', authenticateToken, submitSelfReview);

module.exports = router;    