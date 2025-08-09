const bcrypt = require('bcrypt');
const pool = require('../config/db');
const util = require('util');

const queryAsync = util.promisify(pool.query).bind(pool);


const getEmployees = async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && req.user.role !== 'hr') {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const employees = await queryAsync('SELECT id, name, mobile, role, department FROM hrms_users');
    res.json(employees);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const getEmployeeById = async (req, res) => {
    try {
        const { id } = req.params;
        const [rows] = await pool.query('SELECT * FROM hrms_users WHERE id = ?', [id]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

const getEmployeesByDeptHead = async (req, res) => {
    try {
        const deptHeadId = req.user.id; // from authenticateToken middleware

        // Get department of the logged-in dept head
        const deptResult = await queryAsync(
            'SELECT department FROM hrms_users WHERE id = ? AND role = "dept_head"',
            [deptHeadId]
        );

        if (deptResult.length === 0) {
            return res.status(403).json({ error: 'Not authorized or not a department head' });
        }

        const department = deptResult[0].department;

        // Get employees in that department
        const employees = await queryAsync(
            'SELECT id, name, mobile, department, role FROM hrms_users WHERE department = ? AND role = "employee"',
            [department]
        );

        res.json(employees);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {getEmployees, getEmployeeById, getEmployeesByDeptHead}