// authController.js
const bcrypt = require("bcrypt");
const pool = require("../config/db");
const util = require("util");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret";
const queryAsync = util.promisify(pool.query).bind(pool);

// Check Mobile and Role Exists
const checkMobileAndRoleExists = async (req, res) => {
  const { mobile, role } = req.body;

  if (!mobile || !role) {
    return res.status(400).json({
      success: false,
      error: "Mobile number and role are required",
    });
  }

  const normalizedRole = role.toLowerCase();
  if (!["super_admin", "hr", "dept_head", "manager", "employee"].includes(normalizedRole)) {
    return res.status(400).json({
      success: false,
      error: "Unsupported role",
    });
  }

  try {
    const userResult = await queryAsync(
      "SELECT id FROM hrms_users WHERE mobile = ? AND role = ?",
      [mobile, normalizedRole]
    );

    if (!userResult.length) {
      return res.status(404).json({
        success: false,
        error: "Mobile number or role not found",
      });
    }

    return res.status(200).json({
      success: true,
      exists: true,
    });
  } catch (error) {
    console.error("Check Mobile and Role Error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error during mobile and role verification",
    });
  }
};

// Forgot Password Endpoint (Unauthenticated, similar to resetPassword in crm_users)
const forgotPassword = async (req, res) => {
  const { mobile, role, newPassword } = req.body;

  if (!mobile || !role || !newPassword) {
    return res.status(400).json({
      success: false,
      error: "Mobile number, role, and new password are required",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: "New password must be at least 8 characters",
    });
  }

  const normalizedRole = role.toLowerCase();
  if (!["super_admin", "hr", "dept_head", "manager", "employee"].includes(normalizedRole)) {
    return res.status(400).json({
      success: false,
      error: "Unsupported role",
    });
  }

  try {
    // Check if user exists
    const userResult = await queryAsync(
      "SELECT id, mobile, role FROM hrms_users WHERE mobile = ? AND role = ?",
      [mobile, normalizedRole]
    );
    if (!userResult.length) {
      return res.status(404).json({
        success: false,
        error: "Mobile number or role not found",
      });
    }

    // Update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await queryAsync("START TRANSACTION");
    await queryAsync(
      "UPDATE hrms_users SET password = ?, is_temporary_password = ? WHERE mobile = ? AND role = ?",
      [hashedPassword, false, mobile, normalizedRole]
    );
    await queryAsync("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Password reset successful",
    });
  } catch (error) {
    await queryAsync("ROLLBACK");
    console.error("Forgot Password Error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error during password reset",
    });
  }
};

// Existing loginUser and changePassword (unchanged)
const loginUser = async (req, res) => {
  const { mobile, password, role } = req.body;

  if (!mobile || !password || !role) {
    return res.status(400).json({
      success: false,
      error: "Mobile number, password, and role are required for login",
    });
  }

  const normalizedRole = role.toLowerCase();
  if (!["super_admin", "hr", "dept_head", "manager", "employee"].includes(normalizedRole)) {
    return res.status(400).json({
      success: false,
      error: "Unsupported role",
    });
  }

  try {
    const userResult = await queryAsync(
      `SELECT id, employee_id, full_name, email, mobile, password, department_name, is_temporary_password 
       FROM hrms_users 
       WHERE mobile = ? AND role = ?`,
      [mobile, normalizedRole]
    );

    if (userResult.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid mobile number or role",
      });
    }

    const user = userResult[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid password",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        employee_id: user.employee_id || null,
        role: normalizedRole,
        mobile: user.mobile,
        email: user.email,
        department: user.department_name || null,
      },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      id: user.id,
      employee_id: user.employee_id || null,
      name: user.full_name,
      role: normalizedRole,
      mobile: user.mobile,
      email: user.email || null,
      department: user.department_name || null,
      isTemporaryPassword: user.is_temporary_password || false,
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error during login",
    });
  }
};

const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const { id, role } = req.user;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      error: "Current password and new password are required",
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: "New password must be at least 8 characters",
    });
  }

  try {
    const userResult = await queryAsync(
      `SELECT password FROM hrms_users WHERE id = ? AND role = ?`,
      [id, role]
    );

    if (userResult.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User not found",
      });
    }

    const user = userResult[0];
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Current password is incorrect",
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await queryAsync(
      `UPDATE hrms_users SET password = ?, is_temporary_password = ? WHERE id = ? AND role = ?`,
      [hashedPassword, false, id, role]
    );

    return res.status(200).json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Change Password Error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error during password change",
    });
  }
};

module.exports = { loginUser, changePassword, checkMobileAndRoleExists, forgotPassword };