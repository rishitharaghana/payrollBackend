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
  const userRole = req.user.role;
  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const { month } = req.body;
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return res.status(400).json({ error: "Invalid month format. Use YYYY-MM" });
  }

  try {
    const employees = await queryAsync(
      "SELECT * FROM employees WHERE status='active'"
    );

    if (!employees.length)
      return res.status(404).json({ error: "No active employees found" });

    const payrolls = employees.map((emp) => {
      const grossSalary =
        emp.basic_salary + emp.allowances + (emp.bonuses || 0);
      const pfDeduction = grossSalary * 0.12;
      const esicDeduction = grossSalary * 0.035;
      const taxDeduction = calculateTax(grossSalary);
      const netSalary =
        grossSalary - (pfDeduction + esicDeduction + taxDeduction);

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
        new Date().toISOString().slice(0, 10),
        req.user.username,
      ];
    });

    const placeholders = payrolls
      .map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .join(",");
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
