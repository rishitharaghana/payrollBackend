const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

// Get all users (admin only)
const getUsers = async (req, res) => {
  try {
    const users = await queryAsync("SELECT id, name, mobile, role, department FROM hrms_users");
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Get single user by ID
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await queryAsync("SELECT id, name, mobile, role, department FROM hrms_users WHERE id = ?", [id]);
    if (!user.length) return res.status(404).json({ error: "User not found" });
    res.json(user[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Update user details
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobile, role, department } = req.body;

    await queryAsync(
      "UPDATE hrms_users SET name=?, mobile=?, role=?, department=? WHERE id=?",
      [name, mobile, role, department, id]
    );

    res.json({ message: "User updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Delete user
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    await queryAsync("DELETE FROM hrms_users WHERE id = ?", [id]);
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUser,
  deleteUser,
};
