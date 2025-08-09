const express = require('express');
const router = express.Router();
const {authenticationToken} = require('../middleware/authenticate');
const { getHRs, getHRById, updateHR, deleteHR } = require('../controllers/hrController');

router.get('/hr', authenticationToken,getHRs);
router.get('/hr/:id', authenticationToken, getHRById);
router.put('/hr/:id', authenticationToken,updateHR);
router.delete('/hr/:id', authenticationToken,deleteHR);

module.exports = router;

