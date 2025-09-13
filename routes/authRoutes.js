const express = require('express');
const{ loginUser, changePassword, forgotPassword, checkMobileAndRoleExists } = require('../controllers/authController');
const { authenticateToken } = require('../middleware/authenticate');
const router = express.Router();

router.post('/login', loginUser);
router.get('/login', loginUser);
router.post('/change-password', authenticateToken, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/check-mobile', checkMobileAndRoleExists)

module.exports = router;