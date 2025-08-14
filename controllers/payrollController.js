const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

const getPayrolls = async (req, res) => {
  try {
    const { month } = req.query;
    let query = "SELECT * FROM payroll";
    let params = [];

    if (month) {
      query += " WHERE month = ?";
      params.push(month);
    }

    const rows = await queryAsync(query, params);
    res.json({ message: "Payroll fetched successfully", data: rows });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};

const createPayroll = async (req, res) => {
  const userRole = req.user.role;
  if (!['super_admin', 'hr'].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const {
    name,
    id,
    department,
    grossSalary,
    pfDeduction,
    esicDeduction,
    taxDeduction,
    netSalary,
    status,
    paymentMethod,
    month,
    paymentDate,
  } = req.body;

  const requiredFields = { name, id, department, status, paymentMethod, month, paymentDate };
  for (const [key, value] of Object.entries(requiredFields)) {
    if (!value?.trim()) {
      return res.status(400).json({ error: `${key} is required` });
    }
  }

  const numericFields = { grossSalary, pfDeduction, esicDeduction, taxDeduction, netSalary };
  for (const [key, value] of Object.entries(numericFields)) {
    if (isNaN(value) || Number(value) < 0) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }

  const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
  if (!monthRegex.test(month)) {
    return res.status(400).json({ error: "Invalid month format. Use YYYY-MM" });
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(paymentDate)) {
    return res.status(400).json({ error: "Invalid payment date format. Use YYYY-MM-DD" });
  }

  // Verify netSalary calculation
  const calculatedNetSalary = grossSalary - (pfDeduction + esicDeduction + taxDeduction);
  if (Math.abs(calculatedNetSalary - netSalary) > 0.01) {
    return res.status(400).json({ error: "Net salary calculation mismatch" });
  }

  try {
    const result = await queryAsync(
      `INSERT INTO payroll 
      (employee_name, employee_id, department, gross_salary, pf_deduction, esic_deduction, tax_deduction, net_salary, status, payment_method, month, payment_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        id.trim(),
        department.trim(),
        grossSalary,
        pfDeduction,
        esicDeduction,
        taxDeduction,
        netSalary,
        status.trim(),
        paymentMethod.trim(),
        month,
        paymentDate,
        req.user.username,
      ]
    );
    res.status(201).json({ message: "Payroll created successfully", data: { id: result.insertId, ...req.body } });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};

const generatePayroll = async (req, res) => {
  const userRole = req.user.role;
  if (!['super_admin', 'hr'].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { month } = req.body;
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "Invalid month format. Use YYYY-MM" });
  }

  try {
    // Fetch all active employees
    const employees = await queryAsync("SELECT * FROM employees WHERE status='active'");

    if (!employees.length) return res.status(404).json({ error: "No active employees found" });

    const payrolls = employees.map(emp => {
      const grossSalary = emp.basic_salary + emp.allowances + (emp.bonuses || 0);
      const pfDeduction = grossSalary * 0.12; // Example PF 12%
      const esicDeduction = grossSalary * 0.035; // Example ESIC 3.5%
      const taxDeduction = calculateTax(grossSalary); // Implement your tax logic
      const netSalary = grossSalary - (pfDeduction + esicDeduction + taxDeduction);

      return [
        emp.name,
        emp.id,
        emp.department,
        grossSalary,
        pfDeduction,
        esicDeduction,
        taxDeduction,
        netSalary,
        "Pending",
        "Bank Transfer",
        month,
        new Date().toISOString().slice(0, 10), // today's date
        req.user.username
      ];
    });

    const placeholders = payrolls.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",");
    await queryAsync(
      `INSERT INTO payroll 
      (employee_name, employee_id, department, gross_salary, pf_deduction, esic_deduction, tax_deduction, net_salary, status, payment_method, month, payment_date, created_by) 
      VALUES ${placeholders}`,
      payrolls.flat()
    );

    res.json({ message: `Payroll generated for ${payrolls.length} employees` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to generate payroll" });
  }
};

// Simple tax calculation (customize per your needs)
function calculateTax(gross) {
  if (gross <= 250000) return 0;
  if (gross <= 500000) return gross * 0.05;
  if (gross <= 1000000) return gross * 0.2;
  return gross * 0.3;
}

module.exports = { getPayrolls, createPayroll, generatePayroll };
