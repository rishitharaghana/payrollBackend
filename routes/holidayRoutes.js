const express = require('express');
const { authenticateToken } = require('../middleware/authenticate');
const { getHolidays, createHoliday, updateHoliday, deleteHoliday } = require('../controllers/holidayController');
const router = express.Router();

router.get('/holidays', authenticateToken, getHolidays);
router.post('/holidays/add', authenticateToken, createHoliday);
router.put('/holidays/:id', authenticateToken, updateHoliday);
router.delete('/holidays/delete/:id', authenticateToken, deleteHoliday);

module.exports = router;