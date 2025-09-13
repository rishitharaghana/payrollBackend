const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getDepartments, createDepartment, getDesignations, createDesignation, getRoles, createRole, updateRole } = require("../controllers/departmentController");

router.get("/departments", authenticateToken, getDepartments);
router.post("/departments", authenticateToken, createDepartment);
router.get('/designations', authenticateToken, getDesignations);
router.post('/designations', authenticateToken, createDesignation);
router.get('/employee/roles', authenticateToken, getRoles);
router.post('/employee/role', authenticateToken, createRole);
router.put('/role', authenticateToken, updateRole);

module.exports = router;
