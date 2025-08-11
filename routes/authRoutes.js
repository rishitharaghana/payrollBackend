const express = require('express');
const{ loginUser } = require('../controllers/authController');
const router = express.Router();

router.post('/login', loginUser);
router.get('/login', loginUser);

module.exports = router;