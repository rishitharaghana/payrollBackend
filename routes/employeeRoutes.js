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
  updateEmployeePersonalDetails,
  updateEducationDetails,
  updateBankDetails,
} = require("../controllers/employeeController");

router.post("/employees", authenticateToken, createEmployee);
router.post('/employees/personal-details', authenticateToken, createEmployeePersonalDetails);
router.post('/employees/education-details', authenticateToken, createEducationDetails);
router.post('/employees/documents', authenticateToken, createDocuments)
router.post('/employees/bank-details', authenticateToken, createBankDetails);
router.get("/employees", authenticateToken, fetchEmployees);
router.put("/employees/:id", authenticateToken, updateEmployee);
router.delete("/employees/:id/terminate", authenticateToken, deleteEmployee);
router.get("/profile", authenticateToken, getCurrentUserProfile);
router.get('/employees/progress', authenticateToken, getEmployeeProgress);
router.get('/employee/:id', authenticateToken, getEmployeeById);
router.get('/employees/personal-details/:employeeId', authenticateToken, getEmployeePersonalDetails);
router.get('/employees/bank-details/:employeeId', authenticateToken, getEmployeeBankDetails);
router.get('/employees/documents/:employeeId', authenticateToken, getEmployeeDocuments);
router.get('/employees/education-details/:employeeId', authenticateToken, getEmployeeEducationDetails);
router.put('/employees/personal-details/:employeeId', authenticateToken, updateEmployeePersonalDetails);
router.put('/employees/education-details/:employeeId', authenticateToken, updateEducationDetails);
router.put('/employees/bank-details/:employeeId', authenticateToken, updateBankDetails);

module.exports = router;