const PDFDocument = require("pdfkit-table");
const pool = require("../config/db");
const util = require("util");
const path = require("path");
const fs = require("fs");
const queryAsync = util.promisify(pool.query).bind(pool);

const formatCurrency = (value) => {
  const numValue = parseFloat(value) || 0;
  return `₹${numValue.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const validateInput = (employeeId, month) => {
  if (!employeeId) {
    throw new Error("Invalid employee ID");
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Invalid month format. Use YYYY-MM");
  }
  return true;
};

const generatePayslip = async (req, res) => {
  const { employeeId, month } = req.params;
  const { role, employee_id } = req.user;

  console.log("User data:", req.user); // Debug

  try {
    validateInput(employeeId, month);

    // Restrict employees to their own payslips
    if (role === "employee" && employeeId !== employee_id) {
      return res.status(403).json({ error: "Access denied: You can only view your own payslip" });
    }

    // Allow super_admin, hr, and employees to access payslips
    if (!["super_admin", "hr", "employee"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const query = `
      SELECT 
        p.employee_id, p.month, p.gross_salary, p.net_salary, p.pf_deduction, 
        p.esic_deduction, p.tax_deduction, p.professional_tax, p.basic_salary, 
        p.hra, p.da, p.other_allowances, p.payment_method, p.payment_date, 
        p.created_by, e.full_name AS employee_name, COALESCE(e.department_name, 'HR') AS department, 
        e.designation_name, pd.pan_number, pd.uan_number, 
        b.bank_account_number, b.ifsc_number AS ifsc_code, c.company_name, c.company_pan, c.company_gstin, c.address
      FROM payroll p
      JOIN (
        SELECT employee_id, full_name, department_name, designation_name 
        FROM employees 
        UNION 
        SELECT employee_id, full_name, NULL, NULL 
        FROM hrs 
        UNION 
        SELECT employee_id, full_name, department_name, designation_name 
        FROM dept_heads 
        UNION 
        SELECT employee_id, full_name, department_name, designation_name 
        FROM managers
      ) e ON p.employee_id = e.employee_id
      LEFT JOIN personal_details pd ON p.employee_id = pd.employee_id
      LEFT JOIN bank_details b ON p.employee_id = b.employee_id
      JOIN company c ON p.company_id = c.company_id
      WHERE p.employee_id = ? AND p.month = ?
    `;
    const rows = await queryAsync(query, [employeeId, month]);
    console.log("Payslip data:", rows); // Debug

    if (rows.length === 0) {
      return res.status(404).json({ error: `No payroll record found for employee ${employeeId} in ${month}` });
    }

    const employee = rows[0];

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const fileName = `Payslip_${employee.employee_id}_${month}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    doc.pipe(res);

    // Watermark
    doc
      .fontSize(50)
      .font("Helvetica")
      .opacity(0.1)
      .text("CONFIDENTIAL", 100, 300, { align: "center", rotate: 45 });

    // Company Header
    const logoPath = path.join(__dirname, "../public/images/company_logo.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 30, { width: 80 });
    } else {
      console.warn("Logo file not found:", logoPath);
      doc.fontSize(10).text("Logo Unavailable", 40, 30);
    }
    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .opacity(1)
      .text(employee.company_name || "MNTechs Solutions Pvt Ltd", 130, 30);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(employee.address || "123 Business Street, City, Country", 130, 50);
    doc
      .fontSize(10)
      .text(`PAN: ${employee.company_pan || "ABCDE1234F"} | GSTIN: ${employee.company_gstin || "12ABCDE1234F1Z5"}`, 130, 65);
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(`Payslip for ${month}`, 0, 100, { align: "center" });
    doc.moveDown(2);

    // Employee Details Table
    const employeeTable = {
      headers: [
        { label: "Field", property: "field", width: 200, align: "left" },
        { label: "Value", property: "value", width: 300, align: "left" },
      ],
      rows: [
        ["Name", employee.employee_name || "-"],
        ["Employee ID", employee.employee_id || "-"],
        ["Department", employee.department || "HR"],
        ["Designation", employee.designation_name || "-"],
        ["PAN", employee.pan_number || "-"],
        ["UAN", employee.uan_number || "-"],
        ["Bank A/C", employee.bank_account_number || "-"],
        ["IFSC", employee.ifsc_code || "-"],
        ["Pay Period", employee.month || "-"],
        ["Payment Date", employee.payment_date ? new Date(employee.payment_date).toLocaleDateString("en-IN") : "-"],
        ["Payment Method", employee.payment_method || "-"],
      ],
    };

    console.log("Employee table data:", employeeTable);
    try {
      await doc.table(employeeTable, {
        prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
        prepareRow: (row, indexColumn, indexRow) => {
          doc.font("Helvetica").fontSize(10);
          console.log(`Rendering employee table row ${indexRow}:`, row);
        },
        padding: 5,
        columnSpacing: 5,
        hideHeader: false,
        minRowHeight: 20,
      });
    } catch (err) {
      console.error("Employee table rendering error:", err.message);
      throw new Error("Failed to render employee table");
    }

    doc.moveDown(2);

    // Earnings and Deductions Tables (Side by Side)
    const tableWidth = 250;
    const tableX = 40;
    const tableX2 = tableX + tableWidth + 20;

    // Earnings Table
    doc.fontSize(12).font("Helvetica-Bold").text("Earnings", tableX, doc.y, { underline: true });
    const earningsTable = {
      headers: [
        { label: "Description", property: "description", width: 150, align: "left" },
        { label: "Amount", property: "amount", width: 100, align: "right" },
      ],
      rows: [
        ["Basic Salary", formatCurrency(parseFloat(employee.basic_salary))],
        ["House Rent Allowance (HRA)", formatCurrency(parseFloat(employee.hra))],
        ["Dearness Allowance (DA)", formatCurrency(parseFloat(employee.da))],
        ["Other Allowances", formatCurrency(parseFloat(employee.other_allowances))],
        ["Gross Salary", formatCurrency(parseFloat(employee.gross_salary))],
      ],
    };

    console.log("Earnings table data:", earningsTable);
    try {
      await doc.table(earningsTable, {
        x: tableX,
        width: tableWidth,
        prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
        prepareRow: (row, indexColumn, indexRow) => {
          doc.font("Helvetica").fontSize(10);
          console.log(`Rendering earnings table row ${indexRow}:`, row);
        },
        padding: 5,
        columnSpacing: 5,
        hideHeader: false,
        minRowHeight: 20,
      });
    } catch (err) {
      console.error("Earnings table rendering error:", err.message);
      throw new Error("Failed to render earnings table");
    }

    // Deductions Table
    doc.fontSize(12).font("Helvetica-Bold").text("Deductions", tableX2, earningsTable.y || doc.y, { underline: true });
    const deductionsTable = {
      headers: [
        { label: "Description", property: "description", width: 150, align: "left" },
        { label: "Amount", property: "amount", width: 100, align: "right" },
      ],
      rows: [
        ["Provident Fund (PF)", formatCurrency(parseFloat(employee.pf_deduction))],
        ["ESIC", formatCurrency(parseFloat(employee.esic_deduction))],
        ["Professional Tax", formatCurrency(parseFloat(employee.professional_tax))],
        ["Income Tax", formatCurrency(parseFloat(employee.tax_deduction))],
        ["Net Salary", formatCurrency(parseFloat(employee.net_salary))],
      ],
    };

    console.log("Deductions table data:", deductionsTable);
    try {
      await doc.table(deductionsTable, {
        x: tableX2,
        width: tableWidth,
        prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
        prepareRow: (row, indexColumn, indexRow) => {
          doc.font("Helvetica").fontSize(10);
          console.log(`Rendering deductions table row ${indexRow}:`, row);
        },
        padding: 5,
        columnSpacing: 5,
        hideHeader: false,
        minRowHeight: 20,
      });
    } catch (err) {
      console.error("Deductions table rendering error:", err.message);
      throw new Error("Failed to render deductions table");
    }

    // Footer
    doc.moveDown(2);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Generated by: ${req.user?.employee_id || "Admin"}`, 40, doc.y);
    doc
      .fontSize(10)
      .text(
        "This is a computer-generated payslip and does not require a signature unless specified.",
        40,
        doc.y + 15,
        { align: "center" }
      );
    const signaturePath = path.join(__dirname, "../public/images/hr_signature.png");
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 400, doc.y + 20, { width: 100 });
    } else {
      console.warn("Signature file not found:", signaturePath);
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("HR Signature: ___________________________", 400, doc.y + 20, { align: "right" });
    }

    doc.end();
  } catch (error) {
    console.error(`Error generating payslip for employee ${employeeId}, month ${month}:`, error.message, error.sqlMessage);
    res.status(error.message.includes("Invalid") ? 400 : 500).json({
      error: "Error generating payslip PDF",
      details: error.message,
    });
  }
};

const getPayslips = async (req, res) => {
  const { role, employee_id } = req.user;

  try {
    let query = `
      SELECT p.employee_id, p.month, e.full_name as employee, COALESCE(e.department_name, 'HR') as department, 
             e.designation_name, p.net_salary as salary,
             p.basic_salary, p.hra, p.da, p.other_allowances, p.pf_deduction, 
             p.esic_deduction, p.tax_deduction, p.professional_tax
      FROM payroll p
      JOIN (
        SELECT employee_id, full_name, department_name, designation_name FROM employees
        UNION
        SELECT employee_id, full_name, NULL, NULL FROM hrs
        UNION
        SELECT employee_id, full_name, department_name, designation_name FROM dept_heads
        UNION
        SELECT employee_id, full_name, department_name, designation_name FROM managers
      ) e ON p.employee_id = e.employee_id
    `;
    let params = [];

    if (role === "employee") {
      query += " WHERE p.employee_id = ?";
      params.push(employee_id);
    } else if (!["super_admin", "hr"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const payslips = await queryAsync(query, params);
    console.log("Fetched payslips:", payslips);
    res.json({ message: "Payslips fetched successfully", data: payslips });
  } catch (error) {
    console.error(`Error fetching payslips:`, error.message, error.sqlMessage);
    res.status(500).json({ error: "Error fetching payslips", details: error.message });
  }
};

module.exports = { generatePayslip, getPayslips };