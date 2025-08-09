const bcrypt = require("bcrypt");
const pool = require("../config/db");
const util = require("util");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET;
const queryAsync = util.promisify(pool.query).bind(pool);

const loginUser = async (req, res) => {
  const { mobile, password } = req.body;

  if (!mobile || !password) {
    return res.status(400).json({
      success: false,
      error: "Mobile Number and password are required for login",
    });
  }

  try {
    const userResult = await queryAsync(
      "SELECT * FROM hrms_users WHERE mobile = ?",
      [mobile]
    );

    if (userResult.length === 0) {
      return res.status(401).json({
        success: false,
        error: "Invalid Mobile Number",
      });
    }

    const user = userResult[0];
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid Password",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        department: user.department,
      },
      JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      role: user.role,
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({
      success: false,
      error: "Server Error",
    });
  }
};

module.exports = { loginUser };
