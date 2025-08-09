const pool = require('../config/db');
const util = require('util');

const queryAsync = util.promisify(pool.query).bind(pool);

const getDeptHeads = async (req, res) => {
  try {
    const deptHeads = await queryAsync("SELECT * FROM hrms_users WHERE role = 'dept_head'");
    res.json(deptHeads);
  } catch (error) {
    console.error("Error fetching department heads:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

const getDeptHeadById = async (req, res) => {
  const { id } = req.params;
  try {
    const deptHead = await queryAsync("SELECT * FROM hrms_users WHERE id = ? AND role = 'dept_head'", [id]);
    if (deptHead.length === 0) return res.status(404).json({ error: 'Department Head not found' });
    res.json(deptHead[0]);
  } catch (error) {
    console.error("Error fetching department head:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

const updateDeptHead = async (req, res) => {
  const { id } = req.params;
  const { name, mobile, department } = req.body;
  try {
    const result = await queryAsync(
      "UPDATE hrms_users SET name = ?, mobile = ?, department = ? WHERE id = ? AND role = 'dept_head'",
      [name, mobile, department, id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Department Head not found' });
    res.json({ message: 'Department Head updated successfully' });
  } catch (error) {
    console.error("Error updating department head:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

const deleteDeptHead = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await queryAsync("DELETE FROM hrms_users WHERE id = ? AND role = 'dept_head'", [id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Department Head not found' });
    res.json({ message: 'Department Head deleted successfully' });
  } catch (error) {
    console.error("Error deleting department head:", error);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getDeptHeads,
  getDeptHeadById,
  updateDeptHead,
  deleteDeptHead
};
