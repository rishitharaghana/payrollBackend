const express = require('express');
const { authenticateToken } = require('../middleware/authenticate');
const { downloadSingleCard } = require('../controllers/visitingController');
const router = express.Router();


router.get('/download/:emploeeIs/:style', authenticateToken, downloadSingleCard);
 module.exports = router;