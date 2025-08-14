const express = require('express');
const router = express.Router();
const {authenticateToken} = require('../middleware/authenticate');
const {  createEmployee, fetchEmployees, updateEmployee, deleteEmployee } = require('../controllers/employeeController');

router.post('/employees',authenticateToken,createEmployee);
router.get('/employees',authenticateToken,fetchEmployees);
// router.get('/employee/:id', authenticateToken, getUserById);
router.put('/employees/:id', authenticateToken, updateEmployee);
router.delete('/employees/:id', authenticateToken, deleteEmployee);

module.exports= router;