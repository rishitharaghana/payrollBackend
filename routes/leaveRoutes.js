const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getLeaves, applyLeave, updateLeaveStatus, getPendingLeaves } = require("../controllers/leaveController");

router.get("/leaves", authenticateToken, getLeaves);
router.post("/leaves", authenticateToken, applyLeave);
router.put('/leaves/:id', authenticateToken, updateLeaveStatus);
router.get('/leaves', authenticateToken, getPendingLeaves)

module.exports = router;
