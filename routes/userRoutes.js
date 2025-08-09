const express = require('express');
const router = express.Router();
const {authenticateToken} = require('../middleware/authenticate');
const { getUsers, getUserById, updateUser, deleteUser } = require('../controllers/userController');

router.get('/users',authenticateToken,getUsers);
router.get('/users/:id', authenticateToken, getUserById);
router.put('/users/:id', authenticateToken, updateUser);
router.delete('/users/:id', authenticateToken, deleteUser);

module.exports= router;