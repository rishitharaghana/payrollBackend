const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getLeaves, applyLeave, updateLeaveStatus, getPendingLeaves, getRecipientOptions, getAllLeaves, getLeaveBalances } = require("../controllers/leaveController");

router.get("/leaves", authenticateToken, getLeaves);
router.post("/leaves", authenticateToken, applyLeave);
router.put('/leaves/:id', authenticateToken, updateLeaveStatus);
router.get('/leaves/getAll', authenticateToken, getAllLeaves)
router.get('/leaves/pending', authenticateToken, getPendingLeaves);
router.get('/leaves/recipient-options', authenticateToken,getRecipientOptions);
router.get("/leaves/balances", authenticateToken, getLeaveBalances);

module.exports = router;
