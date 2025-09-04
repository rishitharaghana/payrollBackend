const PDFDocument = require("pdfkit-table");
const pool = require("../config/db");
const util = require("util");
const path = require("path");
const fs = require("fs");
const queryAsync = util.promisify(pool.query).bind(pool);

const formatCurrency = (value) => {
  return `₹${(value || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const validateMonth = (month) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Invalid month format. Use YYYY-MM");
  }
  return true;
};

// Simplified tax calculation (adjust as per actual Indian tax slabs)
const calculateTax = (gross) => {
  if (gross <= 250000) return 0;
  if (gross <= 500000) return gross * 0.05;
  if (gross <= 1000000) return gross * 0.2;
  return gross * 0.3;
};

const getPayrolls = async (req, res) => {
  try {
    const { month } = req.query;
    let query = "SELECT * FROM payroll";
    let params = [];

    if (month) {
      validateMonth(month);
      query += " WHERE month = ?";
      params.push(month);
    }

    const rows = await queryAsync(query, params);
    res.json({ message: "Payroll fetched successfully", data: rows });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage || err.message });
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
    professionalTax,
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

  const numericFields = { grossSalary, pfDeduction, esicDeduction, taxDeduction, professionalTax, netSalary };
  for (const [key, value] of Object.entries(numericFields)) {
    if (isNaN(value) || Number(value) < 0) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }

  try {
    validateMonth(month);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      return res.status(400).json({ error: "Invalid payment date format. Use YYYY-MM-DD" });
    }

    const calculatedNetSalary = grossSalary - (pfDeduction + esicDeduction + taxDeduction + professionalTax);
    if (Math.abs(calculatedNetSalary - netSalary) > 0.01) {
      return res.status(400).json({ error: "Net salary calculation mismatch" });
    }

    const result = await queryAsync(
      `INSERT INTO payroll 
      (employee_name, employee_id, department, gross_salary, pf_deduction, esic_deduction, tax_deduction, professional_tax, net_salary, status, payment_method, month, payment_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name.trim(),
        id.trim(),
        department.trim(),
        grossSalary,
        pfDeduction,
        esicDeduction,
        taxDeduction,
        professionalTax,
        netSalary,
        status.trim(),
        paymentMethod.trim(),
        month,
        paymentDate,
        req.user.employee_id,
      ]
    );
    res.status(201).json({
      message: "Payroll created successfully",
      data: { id: result.insertId, ...req.body, created_by: req.user.employee_id },
    });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ error: "Database error", details: err.sqlMessage || err.message });
  }
};

const generatePayroll = async (req, res) => {
  const { month } = req.body;
  const user = req.user;

  if (!["super_admin", "hr"].includes(user.role)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    validateMonth(month);

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

    if (!employees.length) {
      return res.status(404).json({ error: "No employees found" });
    }

    // Hardcode company details if no company table exists
    const company = {
      company_id: 1,
      company_name: "MNTechs Solutions Pvt Ltd",
      company_pan: "ABCDE1234F",
      company_gstin: "12ABCDE1234F1Z5",
      address: "123 Business Street, City, Country",
    };

    // Optional: Uncomment if you have a company table
    // const [company] = await queryAsync("SELECT * FROM company LIMIT 1");
    // if (!company) {
    //   return res.status(404).json({ error: "Company details not found" });
    // }

    await queryAsync("DELETE FROM payroll WHERE month = ?", [month]);

    const payrollRecords = [];
    for (const emp of employees) {
      const [bankDetails] = await queryAsync(
        `SELECT bank_account_number, ifsc_number FROM bank_details WHERE employee_id = ?`,
        [emp.employee_id]
      );

      const gross_salary = (parseFloat(emp.basic_salary) || 0) + (parseFloat(emp.allowances) || 0) + (parseFloat(emp.bonuses) || 0);
      const pf_deduction = Math.min((parseFloat(emp.basic_salary) || 0) * 0.12, 1800);
      const esic_deduction = gross_salary <= 21000 ? gross_salary * 0.0075 : 0;
      const professional_tax = gross_salary <= 15000 ? 0 : 200;
      const tax_deduction = calculateTax(gross_salary);
      const net_salary = gross_salary - pf_deduction - esic_deduction - professional_tax - tax_deduction;

      const payrollData = {
        employee_id: emp.employee_id,
        employee_name: emp.full_name,
        department: emp.department || "HR",
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
status: user.role === "super_admin" ? "Paid" : "Pending",
        payment_method: bankDetails ? "Bank Transfer" : "Cash",
        payment_date: new Date(month + "-01").toISOString().split("T")[0],
        month,
        created_by: user.employee_id,
        company_id: company.company_id,
      };

      await queryAsync("INSERT INTO payroll SET ?", payrollData);
      payrollRecords.push(payrollData);
    }

    res.status(201).json({ message: "Payroll generated successfully", data: payrollRecords });
  } catch (error) {
    console.error("Error generating payroll:", error.message, error.sqlMessage);
    res.status(500).json({ error: "Failed to generate payroll", details: error.message });
  }
};

const generatePayrollForEmployee = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  const { employeeId, month } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  if (!employeeId || !month) {
    return res.status(400).json({ error: "Employee ID and month are required" });
  }

  try {
    validateMonth(month);

    const [employee] = await queryAsync(
      `SELECT employee_id, full_name, department_name as department, basic_salary, allowances, bonuses,designation_name

       FROM employees WHERE employee_id = ?
       UNION
       SELECT employee_id, full_name, NULL as department, basic_salary, allowances, bonuses, NULL as designation_name

       FROM hrs WHERE employee_id = ?
       UNION
       SELECT employee_id, full_name, department_name as department, basic_salary, allowances, bonuses, designation_name 
       FROM dept_heads WHERE employee_id = ?
       UNION
       SELECT employee_id, full_name, department_name as department, basic_salary, allowances, bonuses, designation_name 
       FROM managers WHERE employee_id = ?`,
      [employeeId, employeeId, employeeId, employeeId]
    );
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const [existingPayroll] = await queryAsync(
      `SELECT id FROM payroll WHERE employee_id = ? AND month = ?`,
      [employeeId, month]
    );
    if (existingPayroll) {
      return res.status(400).json({ error: `Payroll already exists for ${employeeId} for ${month}` });
    }

    const [bankDetails] = await queryAsync(
      `SELECT bank_account_number, ifsc_number FROM bank_details WHERE employee_id = ?`,
      [employeeId]
    );

    // Hardcode company details if no company table exists
    const company = {
      company_id: 1,
      company_name: "MNTechs Solutions Pvt Ltd",
      company_pan: "ABCDE1234F",
      company_gstin: "12ABCDE1234F1Z5",
      address: "123 Business Street, City, Country",
    };

    const gross_salary = (parseFloat(employee.basic_salary) || 0) + (parseFloat(employee.allowances) || 0) + (parseFloat(employee.bonuses) || 0);
    const pf_deduction = Math.min((parseFloat(employee.basic_salary) || 0) * 0.12, 1800);
    const esic_deduction = gross_salary <= 21000 ? gross_salary * 0.0075 : 0;
    const professional_tax = gross_salary <= 15000 ? 0 : 200;
    const tax_deduction = calculateTax(gross_salary);
    const net_salary = gross_salary - pf_deduction - esic_deduction - professional_tax - tax_deduction;

    const payrollData = {
      employee_id: employeeId,
      employee_name: employee.full_name,
      department: employee.department || "HR",
designation_name: employee.designation_name || null,
      gross_salary,
      net_salary,
      pf_deduction,
      esic_deduction,
      professional_tax,
      tax_deduction,
      basic_salary: parseFloat(employee.basic_salary) || 0,
      hra: (parseFloat(employee.allowances) || 0) * 0.4,
      da: (parseFloat(employee.allowances) || 0) * 0.5,
      other_allowances: (parseFloat(employee.allowances) || 0) * 0.1,
status: userRole === "super_admin" ? "Paid" : "Pending",
      payment_method: bankDetails ? "Bank Transfer" : "Cash",
      payment_date: new Date(month + "-01").toISOString().split("T")[0],
      month,
      created_by: userId,
      company_id: company.company_id,
    };

    const result = await queryAsync("INSERT INTO payroll SET ?", payrollData);

    res.status(201).json({
      message: `Payroll generated successfully for ${employeeId} for ${month}`,
      data: {
        id: result.insertId,
        ...payrollData,
      },
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};





const downloadPayrollPDF = async (req, res) => {
  const userRole = req.user?.role;
  const { month, employee_id } = req.query;

  console.log("User data:", req.user);

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    validateMonth(month);

    let query = `
      SELECT p.*, e.full_name AS employee_name, COALESCE(e.department_name, 'HR') AS department,
             e.designation_name
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
      WHERE p.month = ?
    `;
    let params = [month];

    if (employee_id) {
      query += " AND p.employee_id = ?";
      params.push(employee_id);
    }

    const payrolls = await queryAsync(query, params);
    console.log("Payrolls fetched:", payrolls);

    if (!payrolls.length) {
      return res.status(404).json({ error: "No payroll records found for the specified month and employee" });
    }

    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const fileName = employee_id
      ? `Payroll_${month}_${employee_id}.pdf`
      : `Payroll_${month}_All.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    doc.pipe(res);

    // Hardcoded company details
    const company = {
      company_name: "MNTechs Solutions Pvt Ltd",
      company_pan: "ABCDE1234F",
      company_gstin: "12ABCDE1234F1Z5",
      address: "123 Business Street, City, Country",
    };

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
      .text(company.company_name, 130, 30);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(company.address, 130, 50);
    doc
      .fontSize(10)
      .text(`PAN: ${company.company_pan} | GSTIN: ${company.company_gstin}`, 130, 65);
    doc
      .fontSize(14)
      .font("Helvetica-Bold")
      .text(`Payroll Report - ${month}`, 0, 100, { align: "center" });
    doc.moveDown(2);

    // Payroll Table
    const table = {
      headers: [
        { label: "Employee ID", property: "employee_id", width: 80 },
        { label: "Name", property: "employee_name", width: 120 },
        { label: "Department", property: "department", width: 100 },
        { label: "Designation", property: "designation_name", width: 100 },
        { label: "Gross Salary", property: "gross_salary", width: 80, renderer: formatCurrency },
        { label: "Net Salary", property: "net_salary", width: 80, renderer: formatCurrency },
        { label: "Status", property: "status", width: 60 },
      ],
      rows: payrolls.map((p) => [
        p.employee_id || "-",
        p.employee_name || "-",
        p.department || "HR",
        p.designation_name || "-",
        parseFloat(p.gross_salary) || 0, // Convert to number
        parseFloat(p.net_salary) || 0,   // Convert to number
        p.status || "-",
      ]),
    };

    console.log("Table data:", table);
    try {
      await doc.table(table, {
        prepareHeader: () => doc.font("Helvetica-Bold").fontSize(10),
        prepareRow: (row, indexColumn, indexRow, rectRow) => {
          doc.font("Helvetica").fontSize(10);
          console.log(`Rendering row ${indexRow}:`, row); // Debug each row
        },
        padding: 5,
        columnSpacing: 5,
        hideHeader: false,
        minRowHeight: 20, // Ensure rows are tall enough
      });
    } catch (err) {
      console.error("Table rendering error:", err.message);
      throw new Error("Failed to render table");
    }

    // Footer
    doc.moveDown(2);
    doc
      .fontSize(10)
      .font("Helvetica")
      .text(`Generated on: ${new Date().toLocaleDateString("en-IN")}`, 40, doc.y);
    doc.text(`Generated by: ${req.user?.employee_id || "Admin"}`, 40, doc.y + 15);

    // HR Signature
    const signaturePath = path.join(__dirname, "../public/images/hr_signature.png");
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 350, doc.y + 20, { width: 100 });
    } else {
      console.warn("Signature file not found:", signaturePath);
      doc
        .fontSize(10)
        .font("Helvetica-Bold")
        .text("HR Signature: ___________________________", 350, doc.y + 20, { align: "right" });
    }

    doc.end();
  } catch (err) {
    console.error("Error generating payroll PDF:", err.message, err.sqlMessage);
    res.status(500).json({ error: "Failed to generate payroll PDF", details: err.message });
  }
};





module.exports = {
  getPayrolls,
  createPayroll,
  generatePayroll,
  generatePayrollForEmployee, 
  downloadPayrollPDF,
};