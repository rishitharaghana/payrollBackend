const pool = require('../config/db');
const util = require('util');
const bcrypt = require('bcrypt');

const queryAsync = util.promisify(pool.query).bind(pool);

// Get all HRs
const getHRs = async (req, res) => {
  try {
    const hrs = await queryAsync("SELECT id, name, mobile, created_at FROM hrs");
    res.json(hrs);
  } catch (error) {
    console.error("Error fetching HRs:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Get HR by ID
const getHRById = async (req, res) => {
  const { id } = req.params;
  try {
    const hr = await queryAsync("SELECT id, name, mobile, created_at FROM hrs WHERE id = ?", [id]);
    if (hr.length === 0) return res.status(404).json({ error: 'HR not found' });
    res.json(hr[0]);
  } catch (error) {
    console.error("Error fetching HR:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Create new HR
const createHR = async (req, res) => {
  const { name, mobile, password } = req.body;

  if (!name || !mobile || !password) {
    return res.status(400).json({ error: 'Name, mobile and password are required' });
  }

  try {
    // Check if mobile already exists
    const existing = await queryAsync("SELECT id FROM hrs WHERE mobile = ?", [mobile]);
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Mobile number already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new HR
    const result = await queryAsync(
      "INSERT INTO hrs (name, mobile, password) VALUES (?, ?, ?)",
      [name, mobile, hashedPassword]
    );

    res.status(201).json({ message: 'HR created successfully', id: result.insertId });
  } catch (error) {
    console.error("Error creating HR:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Update HR
const updateHR = async (req, res) => {
  const { id } = req.params;
  const { name, mobile } = req.body;
  try {
    const result = await queryAsync(
      "UPDATE hrs SET name = ?, mobile = ? WHERE id = ?",
      [name, mobile, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'HR not found' });
    res.json({ message: 'HR updated successfully' });
  } catch (error) {
    console.error("Error updating HR:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

// Delete HR
const deleteHR = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await queryAsync("DELETE FROM hrs WHERE id = ?", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'HR not found' });
    res.json({ message: 'HR deleted successfully' });
  } catch (error) {
    console.error("Error deleting HR:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getHRs,
  getHRById,
  createHR,
  updateHR,
  deleteHR,
};
