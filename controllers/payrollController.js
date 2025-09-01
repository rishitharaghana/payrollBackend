const pool = require("../config/db");
const util = require("util");
const PDFDocument = require("pdfkit");
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
  if (!["super_admin", "hr"].includes(userRole)) {
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

  const requiredFields = {
    name,
    id,
    department,
    status,
    paymentMethod,
    month,
    paymentDate,
  };
  for (const [key, value] of Object.entries(requiredFields)) {
    if (!value?.trim()) {
      return res.status(400).json({ error: `${key} is required` });
    }
  }

  const numericFields = {
    grossSalary,
    pfDeduction,
    esicDeduction,
    taxDeduction,
    netSalary,
  };
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
    return res
      .status(400)
      .json({ error: "Invalid payment date format. Use YYYY-MM-DD" });
  }

  const calculatedNetSalary =
    grossSalary - (pfDeduction + esicDeduction + taxDeduction);
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
   res.status(201).json({
  message: "Payroll created successfully",
  data: { id: result.insertId, ...req.body, created_by: req.user.username },
});

  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error" });
  }
};



const generatePayroll = async (req, res) => {
  const { month } = req.body;
  const user = req.user;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Valid month (yyyy-MM) is required" });
  }

  try {
    // Fetch all employees
    const employees = await queryAsync(`
      SELECT employee_id, full_name, department_name as department, basic_salary, allowances, bonuses
      FROM employees
      UNION
      SELECT employee_id, full_name, NULL as department, basic_salary, allowances, bonuses
      FROM hrs
      UNION
      SELECT employee_id, full_name, department_name as department, basic_salary, allowances, bonuses
      FROM dept_heads
      UNION
      SELECT employee_id, full_name, department_name as department, basic_salary, allowances, bonuses
      FROM managers
    `);

    console.log("Employees fetched for payroll:", employees); // Debug log

    if (!employees.length) {
      return res.status(404).json({ error: "No employees found" });
    }

    // Fetch company details
    const company = await queryAsync("SELECT * FROM company LIMIT 1");
    if (!company.length) {
      return res.status(404).json({ error: "Company details not found" });
    }

    // Delete existing payroll records for the month
    await queryAsync("DELETE FROM payroll WHERE month = ?", [month]);
    console.log(`Deleted existing payroll records for month: ${month}`);

    const payrollRecords = [];
    for (const emp of employees) {
      const gross_salary =
        (parseFloat(emp.basic_salary) || 0) +
        (parseFloat(emp.allowances) || 0) +
        (parseFloat(emp.bonuses) || 0);
      const pf_deduction = Math.min((parseFloat(emp.basic_salary) || 0) * 0.12, 1800); // 12% of basic, capped at ₹1800
      const esic_deduction = gross_salary <= 21000 ? gross_salary * 0.0075 : 0; // 0.75% if gross ≤ ₹21,000
      const professional_tax = gross_salary <= 15000 ? 0 : 200; // ₹200 for gross > ₹15,000
      const tax_deduction = gross_salary * 0.1; // Simplified 10% income tax
      const net_salary =
        gross_salary - pf_deduction - esic_deduction - professional_tax - tax_deduction;

      const payrollData = {
        employee_id: emp.employee_id,
        employee_name: emp.full_name,
        department: emp.department || "HR", // Default for hrs
        gross_salary,
        net_salary,
        pf_deduction,
        esic_deduction,
        professional_tax,
        tax_deduction,
        basic_salary: parseFloat(emp.basic_salary) || 0,
        hra: (parseFloat(emp.allowances) || 0) * 0.4,
        da: (parseFloat(emp.allowances) || 0) * 0.5,
        other_allowances: (parseFloat(emp.allowances) || 0) * 0.1,
        status: user.role === "super_admin" ? "Processed" : "Pending",
        payment_method: "Bank Transfer",
        payment_date: new Date().toISOString().split("T")[0],
        month,
        created_by: user.employee_id,
        company_id: company[0].company_id,
      };

      await queryAsync("INSERT INTO payroll SET ?", payrollData);
      payrollRecords.push(payrollData);
      console.log(`Payroll record created for employee_id: ${emp.employee_id}`); // Debug log
    }

    res
      .status(201)
      .json({ message: "Payroll generated successfully", data: payrollRecords });
  } catch (error) {
    console.error(
      "Error generating payroll:",
      error.message,
      error.sqlMessage,
      error.code
    );
    res.status(500).json({ error: "Failed to generate payroll" });
  }
};


const downloadPayrollPDF = async (req, res) => {
  const userRole = req.user.role;
  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { month, employee_id } = req.query;

  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "Invalid month format. Use YYYY-MM" });
  }

  try {
    let query = "SELECT * FROM payroll WHERE month = ?";
    let params = [month];

    if (employee_id) {
      query += " AND employee_id = ?";
      params.push(employee_id);
    }

    const payrolls = await queryAsync(query, params);

    if (!payrolls.length) {
      return res.status(404).json({ error: "No payroll records found" });
    }

    // Create a new PDF document
    const doc = new PDFDocument({ margin: 50 });
    const fileName = employee_id
      ? `Payroll_${month}_${employee_id}.pdf`
      : `Payroll_${month}_All.pdf`;

    // Set response headers for PDF download
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    doc.pipe(res);

    // Add company logo or header (optional, replace with your logo path)
    // doc.image("path/to/logo.png", 50, 45, { width: 50 });

    doc
      .fontSize(20)
      .font("Helvetica-Bold")
      .text(`Payroll Report - ${month}`, 50, 50, { align: "center" });

    // Add a line
    doc.moveDown(2).lineTo(50, doc.y).lineTo(550, doc.y).stroke();

    payrolls.forEach((payroll, index) => {
      if (index > 0) {
        doc.addPage(); 
      }

      doc
        .moveDown(2)
        .fontSize(14)
        .font("Helvetica-Bold")
        .text("Employee Details", { align: "left" });
      doc.moveDown(0.5).fontSize(12).font("Helvetica");

      doc.text(`Name: ${payroll.employee_name}`);
      doc.text(`Employee ID: ${payroll.employee_id}`);
      doc.text(`Department: ${payroll.department}`);
      doc.text(`Month: ${payroll.month}`);
      doc.text(`Payment Date: ${payroll.payment_date}`);
      doc.text(`Payment Method: ${payroll.payment_method}`);
      doc.text(`Status: ${payroll.status}`);

      doc
        .moveDown(1)
        .fontSize(14)
        .font("Helvetica-Bold")
        .text("Salary Details");
      doc.moveDown(0.5).fontSize(12).font("Helvetica");

      doc.text(
        `Gross Salary: ₹${payroll.gross_salary.toLocaleString("en-IN")}`
      );
      doc.text(
        `PF Deduction: ₹${payroll.pf_deduction.toLocaleString("en-IN")}`
      );
      doc.text(
        `ESIC Deduction: ₹${payroll.esic_deduction.toLocaleString("en-IN")}`
      );
      doc.text(
        `Tax Deduction: ₹${payroll.tax_deduction.toLocaleString("en-IN")}`
      );
      doc.moveDown(0.5).font("Helvetica-Bold");
      doc.text(`Net Salary: ₹${payroll.net_salary.toLocaleString("en-IN")}`);

      doc
        .moveDown(2)
        .fontSize(10)
        .font("Helvetica-Oblique")
        .text(`Generated by: ${payroll.created_by}`);
    });
    doc.end();
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
};

function calculateTax(gross) {
  if (gross <= 250000) return 0;
  if (gross <= 500000) return gross * 0.05;
  if (gross <= 1000000) return gross * 0.2;
  return gross * 0.3;
}

module.exports = {
  getPayrolls,
  createPayroll,
  generatePayroll,
  downloadPayrollPDF,
};
