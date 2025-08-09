const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

// Get all departments
const getDepartments = async (req, res) => {
  try {
    const rows = await queryAsync("SELECT * FROM departments");
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
};

const createDepartment = async (req, res) => {
  const { name } = req.body;
  try {
    await queryAsync("INSERT INTO departments (name) VALUES (?)", [name]);
    res.status(201).json({ message: "Department created" });
  } catch (err) {
    res.status(500).json({ error: "Database error" });
  }
};

module.exports = { getDepartments, createDepartment };
