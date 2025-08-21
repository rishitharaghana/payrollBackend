const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const {  markAttendance, fetchEmployeeAttendance, fetchAllAttendance, updateAttendanceStatus } = require("../controllers/attendanceController");

router.get("/attendance/employee", authenticateToken, fetchEmployeeAttendance );
router.get("/attendance/getAll", authenticateToken, fetchAllAttendance)
router.post("/attendance", authenticateToken, markAttendance);
router.put('/attendance/status/:id', authenticateToken, updateAttendanceStatus);

module.exports = router;
