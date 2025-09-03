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
  getEmployeeById,
  getEmployeePersonalDetails,
  getEmployeeBankDetails,
  getEmployeeDocuments,
  getEmployeeEducationDetails,
} = require("../controllers/employeeController");

router.post("/employees", authenticateToken, createEmployee);
router.post('/employees/personal-details', authenticateToken, createEmployeePersonalDetails);
router.post('/employees/education-details', authenticateToken, createEducationDetails);
router.post('/employees/documents', authenticateToken, createDocuments)
router.post('/employees/bank-details', authenticateToken, createBankDetails);
router.get("/employees", authenticateToken, fetchEmployees);
router.put("/employees/:id", authenticateToken, updateEmployee);
router.delete("/employees/:id", authenticateToken, deleteEmployee);
router.get("/profile", authenticateToken, getCurrentUserProfile);
router.get('/employees/progress', authenticateToken, getEmployeeProgress);
router.get('/employee/:id', authenticateToken, getEmployeeById);
router.get('/personal-details/:employeeId', authenticateToken, getEmployeePersonalDetails);
router.get('/bank-details/employeeId', authenticateToken, getEmployeeBankDetails);
router.get('/documents/employeeId', authenticateToken, getEmployeeDocuments);
router.get('/education-details/employeeId', authenticateToken, getEmployeeEducationDetails);


module.exports = router;