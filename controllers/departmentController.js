const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

const getDepartments = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!["super_admin", "hr"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Access denied: Only super admins and HR can fetch departments" });
    }

    const rows = await queryAsync("SELECT * FROM departments WHERE department_name != 'Manager'");
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching departments:", {
      message: err.message,
      stack: err.stack,
      sqlMessage: err.sqlMessage,
    });
    res.status(500).json({ success: false, error: `Database error: ${err.message}` });
  }
};

const createDepartment = async (req, res) => {
  const { name } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({ success: false, error: "Department name is required" });
  }

  try {
    const userRole = req.user?.role;
    if (userRole !== "super_admin") {
      return res.status(403).json({ success: false, error: "Only super admins can create departments" });
    }

    const existing = await queryAsync("SELECT department_name FROM departments WHERE department_name = ?", [name.trim()]);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: "Department name already exists" });
    }

    await queryAsync("INSERT INTO departments (department_name) VALUES (?)", [name.trim()]);
    res.status(201).json({ success: true, message: "Department created successfully" });
  } catch (err) {
    console.error("Error creating department:", {
      message: err.message,
      stack: err.stack,
      sqlMessage: err.sqlMessage,
    });
    res.status(500).json({ success: false, error: `Database error: ${err.message}` });
  }
};

const getDesignations = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!["super_admin", "hr"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Access denied: Only super admins and HR can fetch designations" });
    }

    const rows = await queryAsync("SELECT * FROM designations WHERE department_name != 'Manager'");
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching designations:", {
      message: err.message,
      stack: err.stack,
      sqlMessage: err.sqlMessage,
    });
    res.status(500).json({ success: false, error: `Database error: ${err.message}` });
  }
};

const createDesignation = async (req, res) => {
  const { designation_name, department_name } = req.body;

  if (!designation_name?.trim() || !department_name?.trim()) {
    return res.status(400).json({ success: false, error: "Designation name and department name are required" });
  }

  try {
    const userRole = req.user?.role;
    if (userRole !== "super_admin") {
      return res.status(403).json({ success: false, error: "Only super admins can create designations" });
    }

    const [department] = await queryAsync("SELECT department_name FROM departments WHERE department_name = ? AND department_name != 'Manager'", [department_name.trim()]);
    if (!department) {
      return res.status(400).json({ success: false, error: "Invalid department name" });
    }

    const [existing] = await queryAsync(
      "SELECT designation_name FROM designations WHERE designation_name = ? AND department_name = ?",
      [designation_name.trim(), department_name.trim()]
    );
    if (existing) {
      return res.status(409).json({ success: false, error: "Designation name already exists in this department" });
    }

    await queryAsync(
      "INSERT INTO designations (designation_name, department_name) VALUES (?, ?)",
      [designation_name.trim(), department_name.trim()]
    );
    res.status(201).json({ success: true, message: "Designation created successfully" });
  } catch (err) {
    console.error("Error creating designation:", {
      message: err.message,
      stack: err.stack,
      sqlMessage: err.sqlMessage,
    });
    res.status(500).json({ success: false, error: `Database error: ${err.message}` });
  }
};

const getRoles = async (req, res) => {
  try {
    const userRole = req.user?.role;
    if (!["super_admin", "hr"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Access denied: Only super admins and HR can fetch roles" });
    }

    const rows = await queryAsync("SELECT * FROM roles");
    res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching roles:", {
      message: err.message,
      stack: err.stack,
      sqlMessage: err.sqlMessage,
    });
    res.status(500).json({ success: false, error: `Database error: ${err.message}` });
  }
};

const createRole = async (req, res) => {
  const { name, description, role_id, isHRRole } = req.body;

  if (!name?.trim() || !description?.trim() || !role_id?.trim()) {
    return res.status(400).json({ success: false, error: "Name, description, and role_id are required" });
  }

  try {
    const userRole = req.user?.role;
    if (!["super_admin", "hr"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Only super admins and HR can create roles" });
    }

    if (userRole === "hr" && isHRRole) {
      return res.status(403).json({ success: false, error: "HR users cannot create HR-level roles" });
    }

    const [existing] = await queryAsync("SELECT role_id FROM roles WHERE role_id = ?", [role_id.trim()]);
    if (existing) {
      return res.status(409).json({ success: false, error: "Role ID already exists" });
    }

    await queryAsync(
      "INSERT INTO roles (name, description, role_id, isHRRole) VALUES (?, ?, ?, ?)",
      [name.trim(), description.trim(), role_id.trim(), isHRRole ? 1 : 0]
    );
    res.status(201).json({ success: true, message: "Role created successfully" });
  } catch (err) {
    console.error("Error creating role:", {
      message: err.message,
      stack: err.stack,
      sqlMessage: err.sqlMessage,
    });
    res.status(500).json({ success: false, error: `Database error: ${err.message}` });
  }
};

const updateRole = async (req, res) => {
  const { role_id } = req.params;
  const { name, description, isHRRole } = req.body;

  if (!name?.trim() || !description?.trim()) {
    return res.status(400).json({ success: false, error: "Name and description are required" });
  }

  try {
    const userRole = req.user?.role;
    if (!["super_admin", "hr"].includes(userRole)) {
      return res.status(403).json({ success: false, error: "Only super admins and HR can update roles" });
    }

    const [existingRole] = await queryAsync(
      "SELECT isHRRole FROM roles WHERE role_id = ?",
      [role_id]
    );
    if (!existingRole) {
      return res.status(404).json({ success: false, error: "Role not found" });
    }

    if (userRole === "hr" && existingRole.isHRRole) {
      return res.status(403).json({ success: false, error: "HR cannot update HR-level roles" });
    }

    if (userRole === "hr" && isHRRole) {
      return res.status(403).json({ success: false, error: "HR cannot set roles as HR-level" });
    }

    await queryAsync(
      "UPDATE roles SET name = ?, description = ?, isHRRole = ? WHERE role_id = ?",
      [name.trim(), description.trim(), isHRRole ? 1 : 0, role_id]
    );

    res.status(200).json({ success: true, message: "Role updated successfully" });
  } catch (err) {
    console.error("Error updating role:", {
      message: err.message,
      stack: err.stack,
      sqlMessage: err.sqlMessage,
    });
    res.status(500).json({ success: false, error: `Database error: ${err.message}` });
  }
};


module.exports = { getDepartments, createDepartment, getDesignations, createDesignation, getRoles, createRole, updateRole };