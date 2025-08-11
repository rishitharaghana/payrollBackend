const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

const getPayrolls = async (req, res) => {
  try {
    const rows = await queryAsync("SELECT * FROM payroll");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
};

const createPayroll = async (req, res) => {
  const {
    name,
    id,
    department,
    grossSalary,
    pfDeduction,
    esicDeduction,
    netSalary,
    status,
    paymentMethod,
    month,
  } = req.body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return res.status(400).json({ error: "Invalid or missing employee name" });
  }
  if (!id || typeof id !== "string" || id.trim() === "") {
    return res.status(400).json({ error: "Invalid or missing employee id" });
  }
  if (!department || typeof department !== "string" || department.trim() === "") {
    return res.status(400).json({ error: "Invalid or missing department" });
  }

  const monthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
  let payrollMonth = month;
  if (!payrollMonth || !monthRegex.test(payrollMonth)) {
    const now = new Date();
    payrollMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  const numFields = { grossSalary, pfDeduction, esicDeduction, netSalary };
  for (const [key, value] of Object.entries(numFields)) {
    if (value === undefined || isNaN(value) || Number(value) < 0) {
      return res.status(400).json({ error: `Invalid or missing ${key}` });
    }
  }

  if (!status || typeof status !== "string") {
    return res.status(400).json({ error: "Invalid or missing status" });
  }
  if (!paymentMethod || typeof paymentMethod !== "string") {
    return res.status(400).json({ error: "Invalid or missing payment method" });
  }

  try {
    await queryAsync(
      `INSERT INTO payroll 
      (employee_name, employee_id, department, gross_salary, pf_deduction, esic_deduction, net_salary, status, payment_method, month)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        id.trim(),
        department.trim(),
        grossSalary,
        pfDeduction,
        esicDeduction,
        netSalary,
        status.trim(),
        paymentMethod.trim(),
        payrollMonth,
      ]
    );
    res.status(201).json({ message: "Payroll record created" });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};

module.exports = { getPayrolls, createPayroll };
