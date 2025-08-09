const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const {
  getEmployees,
  getEmployeeById,
  getEmployeesByDeptHead,
} = require("../controllers/employeeController");

router.get("/employees", authenticateToken, getEmployees);
router.get("/employees/:id", authenticateToken, getEmployeeById);
router.get("/employees/dept", authenticateToken, getEmployeesByDeptHead);

module.exports = router;
