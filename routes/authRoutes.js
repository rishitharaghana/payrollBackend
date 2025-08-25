const express = require('express');
const{ loginUser, changePassword } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authenticate');
const router = express.Router();

router.post('/login', loginUser);
router.get('/login', loginUser);
router.post('/change-password', authenticateToken, changePassword);

module.exports = router;