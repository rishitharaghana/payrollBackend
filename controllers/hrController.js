const pool = require('../config/db');
const util = require('util');

const queryAsync = util.promisify(pool.query).bind(pool);

const getHRs = async (req, res) => {
  try {
    const hrs = await queryAsync("SELECT * FROM hrms_users WHERE role = 'hr'");
    res.json(hrs);
  } catch (error) {
    console.error("Error fetching HRs:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getHRById = async (req, res) => {
  const { id } = req.params;
  try {
    const hr = await queryAsync("SELECT * FROM hrms_users WHERE id = ? AND role = 'hr'", [id]);
    if (hr.length === 0) return res.status(404).json({ error: 'HR not found' });
    res.json(hr[0]);
  } catch (error) {
    console.error("Error fetching HR:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateHR = async (req, res) => {
  const { id } = req.params;
  const { name, mobile, department } = req.body;
  try {
    const result = await queryAsync(
      "UPDATE hrms_users SET name = ?, mobile = ?, department = ? WHERE id = ? AND role = 'hr'",
      [name, mobile, department, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'HR not found' });
    res.json({ message: 'HR updated successfully' });
  } catch (error) {
    console.error("Error updating HR:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

const deleteHR = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await queryAsync("DELETE FROM hrms_users WHERE id = ? AND role = 'hr'", [id]);
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
  updateHR,
  deleteHR
};
