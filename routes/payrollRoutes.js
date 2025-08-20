const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getPayrolls, createPayroll, generatePayroll, downloadPayrollPDF } = require("../controllers/payrollController");

router.get("/payroll", authenticateToken, getPayrolls);
router.post("/payroll", authenticateToken, createPayroll);
router.post('/payroll/generate', authenticateToken, generatePayroll);
router.get('/payroll/download-pdf', authenticateToken, downloadPayrollPDF);

module.exports = router;

