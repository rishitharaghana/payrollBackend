const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getPayrolls, createPayroll, generatePayroll } = require("../controllers/payrollController");

router.get("/payroll", authenticateToken, getPayrolls);
router.post("/payroll", authenticateToken, createPayroll);
router.post('/payroll/generate', authenticateToken, generatePayroll)

module.exports = router;
