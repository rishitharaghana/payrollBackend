const express = require('express');
const { authenticateToken } = require('../middleware/authenticate');
const { generatePayslip, getPayslips } = require('../controllers/payslipController');
const router = express.Router();

router.get  ('/payslip/:employeeId/:month', authenticateToken, generatePayslip);
router.get('/employees/payslips', authenticateToken, getPayslips);

module.exports = router;