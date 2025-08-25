const pool = require("../config/db");
const util = require("util");
const bcrypt = require("bcrypt");

const queryAsync = util.promisify(pool.query).bind(pool);

const createEmployee = async (req, res) => {
  const userRole = req.user.role;
  const {
    name,
    email,
    mobile,
    emergency_phone,
    address,
    password = 'defaultPass123',
    department_name,
    designation_name,
    employment_type,
    basic_salary,
    allowances,
    join_date,
  } = req.body;
  const role = req.body.role?.toLowerCase() || 'hr'; // Normalize role to lowercase

  console.log('req.user:', req.user);
  console.log('Request body:', req.body);

  if (!['super_admin', 'hr'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }
  if (userRole === 'hr' && role === 'hr') {
    return res.status(403).json({ error: 'HR cannot create HR accounts' });
  }

  if (!name?.trim() || !email?.trim() || !mobile?.trim()) {
    return res.status(400).json({ error: 'Name, email, and mobile are required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (emergency_phone && emergency_phone.trim() === mobile.trim()) {
    return res.status(400).json({ error: 'Mobile and emergency contact numbers cannot be the same' });
  }

  const table = role === 'hr' ? 'hrs' : role === 'dept_head' ? 'dept_heads' : 'employees';

  if (['dept_head', 'employee'].includes(role)) {
    if (!department_name || !designation_name) {
      return res.status(400).json({ error: 'Department and designation are required for Department Head or Employee' });
    }
    const [designation] = await queryAsync(
      'SELECT * FROM designations WHERE department_name = ? AND designation_name = ?',
      [department_name, designation_name]
    );
    if (!designation) {
      return res.status(400).json({ error: 'Invalid department or designation' });
    }
  }

  if (role === 'employee') {
    if (!employment_type || !join_date) {
      return res.status(400).json({ error: 'Employment type and join date are required for Employee' });
    }
    if (!['Full-time', 'Part-time', 'Internship', 'Contract'].includes(employment_type)) {
      return res.status(400).json({ error: 'Invalid employment type' });
    }
  }

  try {
    // Check for duplicate mobile across all tables
    const [existingMobile] = await queryAsync(
      `SELECT mobile FROM (
        SELECT mobile FROM hrs WHERE TRIM(mobile) = ?
        UNION
        SELECT mobile FROM dept_heads WHERE TRIM(mobile) = ?
        UNION
        SELECT mobile FROM employees WHERE TRIM(mobile) = ?
        UNION
        SELECT mobile FROM hrms_users WHERE TRIM(mobile) = ?
      ) AS all_users`,
      [mobile.trim(), mobile.trim(), mobile.trim(), mobile.trim()]
    );
    if (existingMobile) {
      return res.status(400).json({ error: 'Mobile number already in use' });
    }

    // Check for duplicate email in the target table
    const [existingEmail] = await queryAsync(
      `SELECT * FROM ${table} WHERE TRIM(LOWER(email)) = ?`,
      [email.trim().toLowerCase()]
    );
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already in use' });
    }

    // Generate employee ID
    let employeeId;
    const prefix = 'MO-EMP-';
    const [lastEmployee] = await queryAsync(
      `SELECT employee_id FROM (
        SELECT employee_id FROM hrs WHERE employee_id LIKE ?
        UNION
        SELECT employee_id FROM dept_heads WHERE employee_id LIKE ?
        UNION
        SELECT employee_id FROM employees WHERE employee_id LIKE ?
        UNION
        SELECT employee_id FROM hrms_users WHERE employee_id LIKE ?
      ) AS all_employees ORDER BY CAST(SUBSTRING(employee_id, LENGTH(?) + 1) AS UNSIGNED) DESC LIMIT 1`,
      [`${prefix}%`, `${prefix}%`, `${prefix}%`, `${prefix}%`, prefix]
    );
    if (lastEmployee) {
      const lastNumber = parseInt(lastEmployee.employee_id.replace(prefix, ''));
      employeeId = `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
    } else {
      employeeId = `${prefix}001`;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let query, values;
    if (role === 'hr') {
      query = `INSERT INTO hrs (employee_id, name, email, mobile, password, is_temporary_password)
               VALUES (?, ?, ?, ?, ?, ?)`;
      values = [employeeId, name, email, mobile, hashedPassword, true];
    } else if (role === 'dept_head') {
      query = `INSERT INTO dept_heads (employee_id, name, email, mobile, password, department_name, designation_name, is_temporary_password)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      values = [employeeId, name, email, mobile, hashedPassword, department_name, designation_name, true];
    } else {
      query = `INSERT INTO employees (employee_id, name, email, mobile, emergency_phone, address, password, department_name, designation_name, employment_type, basic_salary, allowances, join_date, is_temporary_password)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      values = [
        employeeId,
        name,
        email,
        mobile,
        emergency_phone || null,
        address || null,
        hashedPassword,
        department_name,
        designation_name,
        employment_type,
        basic_salary || 0,
        allowances || 0,
        join_date,
        true,
      ];
    }

    console.log('Executing query:', query, 'with values:', values);
    const result = await queryAsync(query, values);
    const insertedId = result.insertId;

    res.status(201).json({
      message: `${role} created successfully`,
      data: {
        id: insertedId,
        employee_id: employeeId,
        name,
        email,
        mobile,
        role,
        is_temporary_password: true,
        ...(role === 'dept_head' ? { department_name, designation_name } : {}),
        ...(role === 'employee'
          ? { department_name, designation_name, employment_type, basic_salary, allowances, join_date }
          : {}),
      },
    });
  } catch (err) {
    console.error('DB error:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error during creation: ${err.message}` });
  }
};
const updateEmployee = async (req, res) => {
  const userRole = req.user.role;
  const { id } = req.params;
  const { name, email, mobile, emergency_phone, address, role } = req.body;

  if (!["super_admin", "hr"].includes(userRole) && userRole !== role) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions to update this record" });
  }
  if (userRole === "hr" && role === "hr") {
    return res.status(403).json({ error: "HR cannot update HR accounts" });
  }

  if (!name?.trim() || !email?.trim() || !mobile?.trim() || !role) {
    return res.status(400).json({ error: "Name, email, mobile, and role are required for update" });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  const table = role === "hr" ? "hrs" : role === "dept_head" ? "dept_heads" : "employees";

  try {
    const emailCheck = await queryAsync(
      `SELECT * FROM ${table} WHERE email = ? AND id != ?`,
      [email, id]
    );
    if (emailCheck.length > 0) {
      return res.status(400).json({ error: "Email is already in use by another record" });
    }

    const query = `UPDATE ${table} SET name = ?, email = ?, mobile = ?, emergency_phone = ?, address = ? WHERE id = ?`;
    const values = [name, email, mobile, emergency_phone || null, address || null, id];

    const result = await queryAsync(query, values);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: `${role} record not found for update` });
    }

    res.json({
      message: `${role} updated successfully`,
      data: { id, role, name, email, mobile, emergency_phone, address },
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error during update" });
  }
};
const fetchEmployees = async (req, res) => {
  try {
    const userRole = req.user.role;
    if (!['super_admin', 'hr'].includes(userRole)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const hr = await queryAsync(
      "SELECT id, employee_id, name, email, mobile, is_temporary_password, 'hr' as role FROM hrs"
    );
    const deptHeads = await queryAsync(
      "SELECT id, employee_id, name, email, mobile, department_name, designation_name, is_temporary_password, 'dept_head' as role FROM dept_heads"
    );
    const employees = await queryAsync(
      "SELECT id, employee_id, name, email, mobile, department_name, designation_name, employment_type, basic_salary, allowances, join_date, is_temporary_password, 'employee' as role FROM employees"
    );
    const superAdmins = await queryAsync(
      "SELECT id, employee_id, name, email, mobile, is_temporary_password, 'super_admin' as role FROM hrms_users WHERE role = 'super_admin'"
    );

    const allEmployees = [...superAdmins, ...hr, ...deptHeads, ...employees];
    res.json({ message: 'Employees fetched successfully', data: allEmployees });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
const deleteEmployee = async (req, res) => {
  const userRole = req.user.role;
  const { id } = req.params;
  const { role } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions to delete this record" });
  }
  if (userRole === "hr" && role === "hr") {
    return res.status(403).json({ error: "HR cannot delete HR accounts" });
  }

  if (!role) {
    return res.status(400).json({ error: "Role is required for deletion" });
  }

  const table = role === "hr" ? "hrs" : role === "dept_head" ? "dept_heads" : "employees";

  if (role === "employee") {
    try {
      const payrollCheck = await queryAsync(
        "SELECT * FROM payroll WHERE employee_id = (SELECT employee_id FROM employees WHERE id = ?)",
        [id]
      );
      if (payrollCheck.length > 0) {
        return res.status(400).json({ error: "Cannot delete employee with existing payroll records. Archive or resolve dependencies first." });
      }
    } catch (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error checking dependencies" });
    }
  }

  try {
    const result = await queryAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: `${role} record not found for deletion` });
    }

    res.json({ message: `${role} deleted successfully`, role, id });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error during deletion" });
  }
};
const getCurrentUserProfile = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;

  try {
    let query, table;
    if (userRole === 'super_admin') {
      table = 'hrms_users';
      query = 'SELECT id, employee_id, name, email, mobile, is_temporary_password, role FROM hrms_users WHERE id = ?';
    } else if (userRole === 'hr') {
      table = 'hrs';
      query = 'SELECT id, employee_id, name, email, mobile, is_temporary_password, \'hr\' as role FROM hrs WHERE id = ?';
    } else if (userRole === 'dept_head') {
      table = 'dept_heads';
      query = 'SELECT id, employee_id, name, email, mobile, department_name, designation_name, is_temporary_password, \'dept_head\' as role FROM dept_heads WHERE id = ?';
    } else if (userRole === 'employee') {
      table = 'employees';
      query = 'SELECT id, employee_id, name, email, mobile, department_name, designation_name, employment_type, basic_salary, allowances, join_date, is_temporary_password, \'employee\' as role FROM employees WHERE id = ?';
    } else {
      return res.status(403).json({ error: 'Invalid user role' });
    }

    const [user] = await queryAsync(query, [userId]);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User profile fetched successfully', data: user });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
};

module.exports = { createEmployee, updateEmployee, fetchEmployees, deleteEmployee, getCurrentUserProfile };