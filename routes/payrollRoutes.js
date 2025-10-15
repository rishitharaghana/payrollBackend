const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getPayrolls, createPayroll, generatePayroll, downloadPayrollPDF, generatePayrollForEmployee, getEmployeePayrollDetails } = require("../controllers/payrollController");

router.get("/payroll", authenticateToken, getPayrolls);
router.post('/payroll/generate', authenticateToken, generatePayroll);
router.get('/payroll/download-pdf', authenticateToken, downloadPayrollPDF);
router.get('/payroll/employee-details', authenticateToken, getEmployeePayrollDetails)
router.post('/payroll/employee', authenticateToken, generatePayrollForEmployee);

module.exports = router;

