const bcrypt = require("bcrypt");
const pool = require("../config/db");
const util = require("util");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";
const queryAsync = util.promisify(pool.query).bind(pool);

const loginUser = async (req, res) => {
  const { mobile, password, role } = req.body;

  if (!mobile || !password || !role) {
    return res.status(400).json({
      success: false,
      error: 'Mobile number, password, and role are required for login',
    });
  }

  const normalizedRole = role.toLowerCase();
  if (!['super_admin', 'hr', 'dept_head', 'employee'].includes(normalizedRole)) {
    return res.status(400).json({
      success: false,
      error: 'Unsupported role',
    });
  }

  try {
    let userResult;
    let table;
    if (normalizedRole === 'super_admin') {
      table = 'hrms_users';
    } else if (normalizedRole === 'hr') {
      table = 'hrs';
    } else if (normalizedRole === 'dept_head') {
      table = 'dept_heads';
    } else {
      table = 'employees';
    }

    userResult = await queryAsync(`SELECT * FROM ${table} WHERE mobile = ?`, [mobile]);

    if (userResult.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid mobile number',
      });
    }

    const user = userResult[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Invalid password',
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: normalizedRole,
        mobile: user.mobile,
        email: user.email,
        department: user.department_name || user.department || null,
      },
      JWT_SECRET,
      { expiresIn: '1d' }
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      id: user.id,
      name: user.name,
      role: normalizedRole,
      mobile: user.mobile,
      email: user.email || null,
      department: user.department_name || user.department || null,
      isTemporaryPassword: user.is_temporary_password || false,
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error during login',
    });
  }
};
const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const { id, role } = req.user; 

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'Current password and new password are required',
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'New password must be at least 8 characters',
    });
  }

  try {
    const table =
      role === 'super_admin' ? 'hrms_users' :
      role === 'hr' ? 'hrs' :
      role === 'dept_head' ? 'dept_heads' : 'employees';

    const userResult = await queryAsync(`SELECT * FROM ${table} WHERE id = ?`, [id]);

    if (userResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const user = userResult[0];
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: 'Current password is incorrect',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await queryAsync(
      `UPDATE ${table} SET password = ?, is_temporary_password = ? WHERE id = ?`,
      [hashedPassword, false, id]
    );

    return res.status(200).json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change Password Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Server error during password change',
    });
  }
};
module.exports = { loginUser, changePassword };