const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

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

  if (!name) {
    return res.status(400).json({ error: "Department name is required" });
  }

  try {
    if (!req.user || req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Only super admins can create departments" });
    }

    const existing = await queryAsync("SELECT department_name FROM departments WHERE department_name = ?", [name]);
    if (existing.length > 0) {
      return res.status(409).json({ error: "Department name already exists" });
    }

    await queryAsync("INSERT INTO departments (department_name) VALUES (?)", [name]);
    res.status(201).json({ message: "Department created successfully" });
  } catch (err) {
    console.error("Error creating department:", {
      message: err.message,
      stack: err.stack,
      sqlMessage: err.sqlMessage,
    });
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};


module.exports = { getDepartments, createDepartment };
