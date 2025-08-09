const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getPayrolls, createPayroll } = require("../controllers/payrollController");

router.get("/payroll", authenticateToken, getPayrolls);
router.post("/payroll", authenticateToken, createPayroll);

module.exports = router;
