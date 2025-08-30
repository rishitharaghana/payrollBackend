const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const {
  createEmployee,
  fetchEmployees,
  updateEmployee,
  deleteEmployee,
  getCurrentUserProfile,
  createEmployeePersonalDetails,
  createDocuments,
  createEducationDetails,
  createBankDetails,
  getEmployeeProgress,
} = require("../controllers/employeeController");

router.post("/employees", authenticateToken, createEmployee);
router.post('/employees/personal-details', authenticateToken, createEmployeePersonalDetails);
router.post('/employees/education-details', authenticateToken, createEducationDetails);
router.post('/employees/document', authenticateToken, createDocuments)
router.post('/employees/bank-details', authenticateToken, createBankDetails);
router.get("/employees", authenticateToken, fetchEmployees);
router.put("/employees/:id", authenticateToken, updateEmployee);
router.delete("/employees/:id", authenticateToken, deleteEmployee);
router.get("/profile", authenticateToken, getCurrentUserProfile);
router.get('/employees/progress', authenticateToken, getEmployeeProgress);

module.exports = router;