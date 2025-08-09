const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getDepartments, createDepartment } = require("../controllers/departmentController");

router.get("/department", authenticateToken, getDepartments);
router.post("/department", authenticateToken, createDepartment);

module.exports = router;
