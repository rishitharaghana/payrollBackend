 const express = require('express');
 const { authenticateToken } = require('../middleware/authenticate');
const { getDashboardData } = require('../controllers/dashboardController');
 const router = express.Router();

 router.get('/dashboard/:role', authenticateToken, getDashboardData);

module.exports = router;