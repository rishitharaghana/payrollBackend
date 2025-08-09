const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticate");
const { getDeptHeads, getDeptHeadById, updateDeptHead, deleteDeptHead } = require("../controllers/deptHeadController");

router.get('/deptHead', authenticateToken, getDeptHeads);
router.get('/deptHead/:id', authenticateToken, getDeptHeadById);
router.put('/deptHead/:id', authenticateToken, updateDeptHead);
router.delete('/deptHead/:id', authenticateToken,deleteDeptHead);

module.exports= router;