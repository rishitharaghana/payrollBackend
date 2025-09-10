const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const {  markAttendance, fetchEmployeeAttendance, fetchAllAttendance, updateAttendanceStatus, getEmployeeAverageWorkingHours, getAllEmployeesTotalWorkingHours, getTotalAverageWorkingHours, getDetailedAttendance } = require("../controllers/attendanceController");

router.get("/attendance/employee", authenticateToken, fetchEmployeeAttendance );
router.get("/attendance/getAll", authenticateToken, fetchAllAttendance)
router.post("/attendance", authenticateToken, markAttendance);
router.put('/attendance/status/:id', authenticateToken, updateAttendanceStatus);
router.get('/attendance/avg-hours/:employeeId', authenticateToken, getEmployeeAverageWorkingHours);
router.get('/attendance/All/avg-hours', authenticateToken, getAllEmployeesTotalWorkingHours);
router.get('/attendance/employee/avg-hours', authenticateToken, getTotalAverageWorkingHours);
router.post('/attendance/detailed', authenticateToken, getDetailedAttendance)

module.exports = router;
            