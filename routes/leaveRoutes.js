const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getLeaves, applyLeave, updateLeaveStatus } = require("../controllers/leaveController");

router.get("/leave", authenticateToken, getLeaves);
router.post("/leave/status", authenticateToken, applyLeave);
router.put('/leave/:id', authenticateToken, updateLeaveStatus);

module.exports = router;
