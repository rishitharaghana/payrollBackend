const pool = require('../config/db');
const util = require('util');
const bcrypt = require('bcrypt');

const queryAsync = util.promisify(pool.query).bind(pool);

const createUser = async (req, res) => {
  try {
    const { name, mobile, password, role, department } = req.body;

    if (!name || !mobile || !password || !role || !department) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existingUser = await queryAsync(
      'SELECT id FROM hrms_users WHERE mobile = ?',
      [mobile]
    );
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Mobile number already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await queryAsync(
      'INSERT INTO hrms_users (name, mobile, password, role, department) VALUES (?, ?, ?, ?, ?)',
      [name, mobile, hashedPassword, role, department]
    );

    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


const getUsers = async (req, res) => {
  try {
    const users = await queryAsync('SELECT id, name, mobile, role, department FROM hrms_users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await queryAsync('SELECT id, name, mobile, role, department FROM hrms_users WHERE id = ?', [id]);
    if (!user.length) return res.status(404).json({ error: 'User not found' });
    res.json(user[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobile, role, department } = req.body;

    await queryAsync(
      'UPDATE hrms_users SET name=?, mobile=?, role=?, department=? WHERE id=?',
      [name, mobile, role, department, id]
    );

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await queryAsync('DELETE FROM hrms_users WHERE id = ?', [id]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {           
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
};