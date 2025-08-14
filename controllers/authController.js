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
      error: "Mobile number, password, and role are required for login",
    });
  }

  if (!["super_admin", "hr", "dept_head", "employee"].includes(role)) {
    return res.status(400).json({
      success: false,
      error: "Unsupported role",
    });
  }

  try {
    let userResult;
    const table = role === "super_admin" ? "hrms_users" :
                  role === "hr" ? "hrs" :
                  role === "dept_head" ? "dept_heads" : "employees";

    userResult = await queryAsync(`SELECT * FROM ${table} WHERE mobile = ?`, [mobile]);

    if (userResult.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid mobile number",
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
        role,
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
      name: user.name,
      role,
      mobile: user.mobile,
      email: user.email,
      department: user.department_name || null,
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({
      success: false,
      error: "Server error during login",
    });
  }
};

module.exports = { loginUser };