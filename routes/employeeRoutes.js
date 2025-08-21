const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const {
  createEmployee,
  fetchEmployees,
  updateEmployee,
  deleteEmployee,
  getCurrentUserProfile,
} = require("../controllers/employeeController");

router.post("/employees", authenticateToken, createEmployee);
router.get("/employees", authenticateToken, fetchEmployees);
router.put("/employees/:id", authenticateToken, updateEmployee);
router.delete("/employees/:id", authenticateToken, deleteEmployee);
router.get("/profile", authenticateToken, getCurrentUserProfile);

module.exports = router;