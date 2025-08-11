const express = require('express');
const router = express.Router();
const {authenticateToken} = require('../middleware/authenticate');
const { getUsers, getUserById, updateUser, deleteUser, createUser } = require('../controllers/userController');

router.post('/users', authenticateToken, createUser);
router.get('/users',authenticateToken,getUsers);
router.get('/users/:id', authenticateToken, getUserById);
router.put('/users/:id', authenticateToken, updateUser);
router.delete('/users/:id', authenticateToken, deleteUser);

module.exports= router;