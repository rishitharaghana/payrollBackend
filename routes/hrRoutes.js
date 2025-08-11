const express = require('express');
const router = express.Router();
const { getHRs, getHRById, updateHR, deleteHR, createHR } = require('../controllers/hrController');
const { authenticateToken } = require('../middleware/authenticate');

router.get('/hr', authenticateToken,getHRs);
router.get('/hr/:id', authenticateToken, getHRById);
router.put('/hr/:id', authenticateToken,updateHR);
router.delete('/hr/:id', authenticateToken,deleteHR);
router.get('/hr', authenticateToken, createHR);

module.exports = router;

