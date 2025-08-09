const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getAttendance, markAttendance } = require("../controllers/attendanceController");

router.get("/attendance", authenticateToken, getAttendance);
router.post("/attendance", authenticateToken, markAttendance);

module.exports = router;
