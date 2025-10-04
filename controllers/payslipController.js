const PDFDocument = require("pdfkit-table");
const pool = require("../config/db");
const util = require("util");
const path = require("path");
const fs = require("fs");
const { calculateLeaveAndAttendance } = require("./payrollController");

const queryAsync = util.promisify(pool.query).bind(pool);

const COMPANY_CONFIG = {
  company_id: 1,
  company_name: "MNTechs Solutions Pvt Ltd",
  company_pan: "ABCDE1234F",
  company_gstin: "12ABCDE1234F1Z5",
  address: "123 Business Street, City, Country",
};

const formatCurrency = (value) => {
  const numValue = parseFloat(value) || 0;
  return `\u20B9${numValue.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const parseNumber = (value, defaultValue = 0) => {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

const validateInput = (employeeId, month) => {
  if (!employeeId) throw new Error("Invalid employee ID");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Invalid month format. Use YYYY-MM");
  return true;
};

const calculateTax = (gross) => {
  const grossSalary = parseNumber(gross);
  if (grossSalary <= 250000) return 0;
  if (grossSalary <= 500000) return grossSalary * 0.05;
  if (grossSalary <= 1000000) return grossSalary * 0.2;
  return grossSalary * 0.3;
};

const generatePayrollForEmployee = async (employeeId, month, userRole, userId) => {
  try {
    validateInput(employeeId, month);

    const [employee] = await queryAsync(
      `SELECT employee_id, full_name, department_name, designation_name, join_date, status, role
       FROM hrms_users
       WHERE employee_id = ?`,
      [employeeId]
    );
    if (!employee) {
      console.error(`Employee "${employeeId}" not found in hrms_users`);
      throw new Error(`Employee not found: ${employeeId}`);
    }
    if (employee.status !== "active") {
      console.warn(`Employee "${employeeId}" is not active (status: ${employee.status})`);
      throw new Error(`Employee is not active (status: ${employee.status})`);
    }

    const [salaryStructure] = await queryAsync(
      `SELECT basic_salary, hra, special_allowances, bonus, hra_percentage, 
              provident_fund_percentage, provident_fund, esic_percentage, esic, created_at
       FROM employee_salary_structure 
       WHERE employee_id = ?
       ORDER BY created_at DESC LIMIT 1`,
      [employeeId]
    );
    if (!salaryStructure) {
      console.warn(`No salary structure found for "${employeeId}"`);
      const [similarRecords] = await queryAsync(
        `SELECT employee_id FROM employee_salary_structure WHERE employee_id LIKE ?`,
        [`%${employeeId}%`]
      );
      console.log(`Similar employee_ids found for ${employeeId}:`, similarRecords || []);
      throw new Error(`No salary structure found for employee ${employeeId}`);
    }
    console.log(`Salary structure for "${employeeId}":`, salaryStructure);

    // Require join_date only for employee and dept_head roles
    if (["employee", "dept_head"].includes(employee.role) && !employee.join_date) {
      console.warn(`Missing join_date for "${employeeId}" with role ${employee.role}`);
      throw new Error("Joining date is required for employee/department head roles");
    }

    const [existingPayroll] = await queryAsync(
      `SELECT id FROM payroll WHERE employee_id = ? AND month = ?`,
      [employeeId, month]
    );
    if (existingPayroll) {
      console.warn(`Payroll already exists for "${employeeId}" for ${month}`);
      return null;
    }

    const { unpaidLeaveDays, totalWorkingDays, presentDays, paidLeaveDays, holidays } = await calculateLeaveAndAttendance(employeeId, month);

    if (totalWorkingDays === 0) {
      console.warn(`No working days for "${employeeId}" in ${month}. Skipping payroll generation.`);
      throw new Error(`Cannot generate payroll for ${employeeId} in ${month}: No working days`);
    }

    const [bankDetails] = await queryAsync(
      `SELECT bank_account_number, ifsc_number FROM bank_details WHERE employee_id = ?`,
      [employeeId]
    );

    const basic_salary = parseNumber(salaryStructure.basic_salary);
    const hra_percentage = parseNumber(salaryStructure.hra_percentage);
    const provident_fund_percentage = parseNumber(salaryStructure.provident_fund_percentage, 0.12);
    const esic_percentage = parseNumber(salaryStructure.esic_percentage, 0.0075);
    const hra = parseNumber(salaryStructure.hra) || (hra_percentage * basic_salary) / 100 || 0;
    const special_allowances = parseNumber(salaryStructure.special_allowances);
    const bonus = parseNumber(salaryStructure.bonus);
    const provident_fund = parseNumber(salaryStructure.provident_fund);
    const esic = parseNumber(salaryStructure.esic);

    const gross_salary = basic_salary + hra + special_allowances + bonus;
    console.log(`Calculated gross_salary for ${employeeId}:`, gross_salary);

    const dailyRate = totalWorkingDays > 0 ? gross_salary / totalWorkingDays : 0;
    const effectiveWorkingDays = presentDays + paidLeaveDays;
    const adjusted_gross_salary = effectiveWorkingDays * dailyRate;
    const unpaid_leave_deduction = unpaidLeaveDays * dailyRate;

    const pf_deduction = provident_fund || Math.min(adjusted_gross_salary * provident_fund_percentage, 1800);
    const esic_deduction = esic || (adjusted_gross_salary <= 21000 ? adjusted_gross_salary * esic_percentage : 0);
    const professional_tax = adjusted_gross_salary <= 15000 ? 0 : 200;
    const tax_deduction = calculateTax(adjusted_gross_salary);

    const net_salary = Math.max(0, adjusted_gross_salary - (pf_deduction + esic_deduction + professional_tax + tax_deduction + unpaid_leave_deduction));

    if (isNaN(net_salary)) {
      console.error(`Net salary calculation resulted in NaN for ${employeeId}:`, {
        adjusted_gross_salary,
        pf_deduction,
        esic_deduction,
        professional_tax,
        tax_deduction,
        unpaid_leave_deduction,
      });
      await queryAsync(
        "INSERT INTO payroll_audit (employee_id, month, action, details, created_at) VALUES (?, ?, ?, ?, NOW())",
        [employeeId, month, "calculation_error", `Net salary calculation resulted in NaN`]
      );
      throw new Error(`Invalid net salary calculation for ${employeeId}`);
    }

    const payrollData = {
      employee_id: employeeId,
      employee_name: employee.full_name,
      department: employee.department_name || "HR",
      designation_name: employee.designation_name || null,
      gross_salary: adjusted_gross_salary,
      net_salary,
      pf_deduction,
      esic_deduction,
      professional_tax,
      tax_deduction,
      unpaid_leave_deduction,
      basic_salary: totalWorkingDays > 0 ? (basic_salary * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
      hra: totalWorkingDays > 0 ? (hra * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
      special_allowances: totalWorkingDays > 0 ? (special_allowances * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
      bonus: totalWorkingDays > 0 ? (bonus * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
      status: userRole === "super_admin" ? "Paid" : "Pending",
      payment_method: bankDetails ? "Bank Transfer" : "Cash",
      payment_date: new Date(`${month}-01`).toISOString().split("T")[0],
      month,
      created_by: userId,
      company_id: COMPANY_CONFIG.company_id,
      unpaid_leave_days: unpaidLeaveDays,
      paid_leave_days: paidLeaveDays,
      total_working_days: totalWorkingDays,
      present_days: presentDays,
      holidays: holidays,
    };

    console.log(`Inserting payroll for employee "${employeeId}":`, payrollData);
    await queryAsync("INSERT INTO payroll SET ?", payrollData);

    if (unpaid_leave_deduction > 0) {
      await queryAsync(
        "INSERT INTO payroll_audit (employee_id, month, action, details, created_at) VALUES (?, ?, ?, ?, NOW())",
        [employeeId, month, "unpaid_leave_deduction", `Deducted ${formatCurrency(unpaid_leave_deduction)} for ${unpaidLeaveDays} unpaid leave days`]
      );
    }

    return payrollData;
  } catch (err) {
    console.error(`Error in generatePayrollForEmployee for "${employeeId}":`, err.message, err.sqlMessage);
    throw err;
  }
};

const numberToWords = (num) => {
  if (num === 0) return "Zero";
  const a = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const b = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
  ];

  const numToWords = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000)
      return (
        a[Math.floor(n / 100)] +
        " Hundred" +
        (n % 100 ? " " + numToWords(n % 100) : "")
      );
    if (n < 100000)
      return (
        numToWords(Math.floor(n / 1000)) +
        " Thousand" +
        (n % 1000 ? " " + numToWords(n % 1000) : "")
      );
    if (n < 10000000)
      return (
        numToWords(Math.floor(n / 100000)) +
        " Lakh" +
        (n % 100000 ? " " + numToWords(n % 100000) : "")
      );
    return (
      numToWords(Math.floor(n / 10000000)) +
      " Crore" +
      (n % 10000000 ? " " + numToWords(n % 10000000) : "")
    );
  };

  return numToWords(Math.floor(num)).trim();
};

const drawTable = (doc, title, data, startX, startY) => {
  const col1Width = 420,
    col2Width = 100,
    headerHeight = 22,
    rowHeight = 20;
  let y = startY;

  doc.rect(startX, y, col1Width + col2Width, headerHeight).fill("#1a3c7a");
  doc
    .fillColor("#fff")
    .font("Times-Bold")
    .fontSize(10)
    .text(title, startX + 5, y + 5, { width: col1Width })
    .text("Amount", startX + col1Width - 25, y + 5, {
      width: col2Width,
      align: "right",
    });

  y += headerHeight;

  data.forEach(([label, value], i) => {
    if (i % 2 === 0)
      doc.rect(startX, y, col1Width + col2Width, rowHeight).fill("#f5f5f5");
    doc.fillColor("#000").font("Times-Roman").fontSize(9);
    const isBold = label.includes("Total") || label.includes("Net Pay");
    doc
      .font(isBold ? "Times-Bold" : "Times-Roman")
      .text(label, startX + 5, y + 5, { width: col1Width })
      .text(value || "-", startX + col1Width - 30, y + 5, {
        width: col2Width,
        align: "right",
      });

    doc
      .moveTo(startX, y + rowHeight)
      .lineTo(startX + col1Width + col2Width, y + rowHeight)
      .strokeColor("#ddd")
      .lineWidth(0.5)
      .stroke();
    y += rowHeight;
  });

  return y;
};

const generatePayslip = async (req, res) => {
  const { employeeId, month } = req.params;
  const { role, employee_id } = req.user;

  try {
    validateInput(employeeId, month);

    // Allow employee, dept_head, manager, and hr to view only their own payslips
    if (["employee", "dept_head", "manager", "hr"].includes(role) && employeeId !== employee_id) {
      return res
        .status(403)
        .json({ error: "Access denied: You can only view your own payslip" });
    }

    // Allow super_admin, hr, employee, dept_head, and manager roles
    if (!["super_admin", "hr", "employee", "dept_head", "manager"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    let payroll = await queryAsync(
      `SELECT 
        p.employee_id, p.month, p.gross_salary, p.net_salary, p.pf_deduction, 
        p.esic_deduction, p.tax_deduction, p.professional_tax, p.unpaid_leave_deduction,
        p.basic_salary, p.hra, p.special_allowances, p.bonus, p.payment_method, p.payment_date, 
        p.status, p.created_by, p.unpaid_leave_days, p.total_working_days,
        u.full_name AS employee_name, COALESCE(u.department_name, 'HR') AS department, 
        u.designation_name, u.role, pd.pan_number, pd.uan_number, u.dob,
        b.bank_account_number, b.ifsc_number
      FROM payroll p
      JOIN hrms_users u ON p.employee_id = u.employee_id
      LEFT JOIN personal_details pd ON p.employee_id = pd.employee_id
      LEFT JOIN bank_details b ON p.employee_id = b.employee_id
      WHERE p.employee_id = ? AND p.month = ?`,
      [employeeId, month]
    );

    if (!payroll.length) {
      try {
        const newPayroll = await generatePayrollForEmployee(employeeId, month, role, employee_id);
        if (!newPayroll) {
          return res.status(400).json({
            error: `Payroll already exists for ${employeeId} in ${month}`,
          });
        }
        const [userDetails] = await queryAsync(
          `SELECT dob, pan_number, uan_number FROM personal_details WHERE employee_id = ?`,
          [employeeId]
        );
        const [user] = await queryAsync(
          `SELECT role, department_name, designation_name FROM hrms_users WHERE employee_id = ?`,
          [employeeId]
        );
        payroll = [
          {
            ...newPayroll,
            company_name: COMPANY_CONFIG.company_name,
            company_pan: COMPANY_CONFIG.company_pan,
            company_gstin: COMPANY_CONFIG.company_gstin,
            address: COMPANY_CONFIG.address,
            dob: userDetails?.dob || null,
            pan_number: userDetails?.pan_number || "-",
            uan_number: userDetails?.uan_number || "-",
            bank_account_number: newPayroll.payment_method === "Bank Transfer" ? "****" : "-",
            ifsc_number: newPayroll.payment_method === "Bank Transfer" ? "****" : "-",
            role: user?.role || "hr",
            department: user?.department_name || "HR",
            designation_name: user?.designation_name || "-",
          },
        ];
      } catch (genErr) {
        console.error(`Failed to generate payroll for ${employeeId} in ${month}:`, genErr.message);
        return res.status(400).json({
          error: `Cannot generate payslip for ${employeeId} in ${month}`,
          details: genErr.message,
        });
      }
    }

    const employee = payroll[0];

    const numericalFields = [
      "gross_salary", "net_salary", "pf_deduction", "esic_deduction",
      "professional_tax", "tax_deduction", "unpaid_leave_deduction",
      "basic_salary", "hra", "special_allowances", "bonus",
    ];
    numericalFields.forEach((field) => {
      employee[field] = parseNumber(employee[field]);
    });

    const totalDeductions =
      employee.pf_deduction +
      employee.esic_deduction +
      employee.professional_tax +
      employee.tax_deduction +
      employee.unpaid_leave_deduction;
    if (Math.abs(employee.net_salary - (employee.gross_salary - totalDeductions)) > 0.01) {
      console.error(`Net salary mismatch for ${employeeId} in ${month}:`, {
        calculated: employee.gross_salary - totalDeductions,
        stored: employee.net_salary,
      });
      await queryAsync(
        "INSERT INTO payroll_audit (employee_id, month, action, details, created_at) VALUES (?, ?, ?, ?, NOW())",
        [employeeId, month, "calculation_error", `Net salary mismatch: calculated=${employee.gross_salary - totalDeductions}, stored=${employee.net_salary}`]
      );
      throw new Error(`Invalid net salary for ${employeeId} in ${month}`);
    }

    let userPassword = "default123";
    if (employee.dob) {
      const dobDate = new Date(employee.dob);
      if (!isNaN(dobDate)) {
        const day = String(dobDate.getDate()).padStart(2, "0");
        const month = String(dobDate.getMonth() + 1).padStart(2, "0");
        const year = dobDate.getFullYear();
        userPassword = `${day}-${month}-${year}`;
      } else {
        console.warn(`Invalid DOB for employee ${employeeId}: ${employee.dob}`);
      }
    } else {
      console.warn(`DOB missing for employee ${employeeId}. Using default password.`);
    }

    const doc = new PDFDocument({
      margin: 40,
      size: "A4",
      permissions: {
        modifying: false,
        copying: false,
        annotating: false,
        printing: "lowResolution",
      },
      userPassword: userPassword,
      ownerPassword: "owner123",
    });

    const fileName = `Payslip_${employee.employee_id}_${month}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    doc.pipe(res);

    const logoPath = path.join(__dirname, "../public/images/company_logo.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 30, { width: 80, height: 40 });
    } else {
      console.warn(`Logo file not found at ${logoPath}`);
    }

    doc
      .font("Times-Bold")
      .fontSize(18)
      .fillColor("#1a3c7a")
      .text(COMPANY_CONFIG.company_name, 140, 30);
    doc
      .font("Times-Roman")
      .fontSize(9)
      .fillColor("#444")
      .text(COMPANY_CONFIG.address, 140, 50, { width: 400 });
    doc
      .fontSize(9)
      .text(
        `PAN: ${COMPANY_CONFIG.company_pan}   GSTIN: ${COMPANY_CONFIG.company_gstin}`,
        140,
        65
      );
    doc
      .moveDown(2)
      .font("Times-Bold")
      .fontSize(14)
      .fillColor("#1a3c7a")
      .text(`Payslip for ${month}`, {
        width: 510,
        align: "center",
        underline: true,
      });

    doc.moveDown(2);
    const leftDetails = [
      ["Employee Name", employee.employee_name || "-"],
      ["Employee ID", employee.employee_id || "-"],
      ["Role", employee.role || "-"],
      ["Department", employee.department || "HR"],
      ["Designation", employee.designation_name || "-"],
      ["Pay Period", employee.month || "-"],
      ["Total Working Days", employee.total_working_days || "0"],
    ];
    const rightDetails = [
      ["PAN", employee.pan_number || "-"],
      ["UAN", employee.uan_number || "-"],
      ["Bank A/C", employee.bank_account_number || "-"],
      ["IFSC", employee.ifsc_number || "-"],
      [
        "Payment Date",
        employee.payment_date
          ? new Date(employee.payment_date).toLocaleDateString("en-IN")
          : "-",
      ],
      ["Unpaid Leave Days", employee.unpaid_leave_days || "0"],
    ];

    let y = doc.y;

    leftDetails.forEach(([label, value]) => {
      doc
        .font("Times-Bold")
        .fontSize(9)
        .fillColor("#000")
        .text(label, 50, y, { width: 85, align: "left" });

      doc
        .font("Times-Bold")
        .fontSize(9)
        .fillColor("#000")
        .text(":", 135, y, { width: 10, align: "center" });

      doc
        .font("Times-Roman")
        .fontSize(9)
        .fillColor("#333")
        .text(value, 150, y, { width: 120, align: "left" });

      y += 18;
    });

    y = doc.y - leftDetails.length * 18;

    rightDetails.forEach(([label, value]) => {
      doc
        .font("Times-Bold")
        .fontSize(9)
        .fillColor("#000")
        .text(label, 320, y, { width: 95, align: "left" });

      doc
        .font("Times-Bold")
        .fontSize(9)
        .fillColor("#000")
        .text(":", 415, y, { width: 10, align: "center" });

      doc
        .font("Times-Roman")
        .fontSize(9)
        .fillColor("#333")
        .text(value, 425, y, { width: 120, align: "left" });

      y += 18;
    });

    doc.moveDown(2);
    const startY = doc.y + 10;
    const earnings = [
      ["Basic Salary", formatCurrency(employee.basic_salary)],
      ["HRA", formatCurrency(employee.hra)],
      ["Special Allowances", formatCurrency(employee.special_allowances)],
      ["Bonus", formatCurrency(employee.bonus)],
      ["Total Earnings", formatCurrency(employee.gross_salary)],
    ];
    const deductions = [
      ["Provident Fund", formatCurrency(employee.pf_deduction)],
      ["ESIC", formatCurrency(employee.esic_deduction)],
      ["Professional Tax", formatCurrency(employee.professional_tax)],
      ["Income Tax", formatCurrency(employee.tax_deduction)],
      ["Leave Deduction", formatCurrency(employee.unpaid_leave_deduction)],
      [
        "Total Deductions",
        formatCurrency(
          employee.pf_deduction +
          employee.esic_deduction +
          employee.professional_tax +
          employee.tax_deduction +
          employee.unpaid_leave_deduction
        ),
      ],
      ["Net Pay", formatCurrency(employee.net_salary)],
    ];

    let tableY = startY;
    tableY = drawTable(doc, "Earnings", earnings, 50, tableY);
    tableY += 30;
    tableY = drawTable(doc, "Deductions", deductions, 50, tableY);
    tableY += 40;

    doc
      .font("Times-Bold")
      .fontSize(12)
      .fillColor("#000")
      .text("Net Pay: " + formatCurrency(employee.net_salary), 0, tableY, {
        align: "center",
      });
    doc.moveDown(1);

    doc
      .font("Times-Roman")
      .fontSize(10)
      .fillColor("#444")
      .text(numberToWords(employee.net_salary), 0, doc.y, { align: "center" });

    doc.moveDown(1);
    doc
      .font("Courier-Oblique")
      .fontSize(8)
      .fillColor("#666")
      .text("This is a system-generated payslip.", 0, doc.y, {
        align: "center",
      });

    doc.moveDown(4);
    doc
      .font("Times-Roman")
      .fontSize(9)
      .fillColor("#000")
      .text("Employer Signature", 350, doc.y, { width: 200, align: "right" });

    doc.moveDown(2);
    doc
      .moveTo(400, doc.y)
      .lineTo(550, doc.y)
      .strokeColor("#000")
      .lineWidth(0.5)
      .stroke();

    doc.end();
  } catch (error) {
    console.error(
      `Error generating payslip for employee ${employeeId}, month ${month}:`,
      error.message,
      error.sqlMessage
    );
    const status = error.message.includes("Invalid") ||
                   error.message.includes("No salary structure") ||
                   error.message.includes("No working days") ||
                   error.message.includes("net salary") ? 400 : 500;
    res.status(status).json({
      error: "Error generating payslip PDF",
      details: error.sqlMessage || error.message,
    });
  }
};

const getPayslips = async (req, res) => {
  const { role, employee_id } = req.user;
  const { page = 1, limit = 10, month, employeeId } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    // Validate requesting employee
    const [requestingEmployee] = await queryAsync(
      `SELECT employee_id, role, status FROM hrms_users WHERE employee_id = ?`,
      [employee_id]
    );
    if (!requestingEmployee) {
      console.error(`Requesting employee "${employee_id}" not found in hrms_users`);
      return res.status(404).json({ error: `Requesting employee ${employee_id} not found` });
    }
    if (requestingEmployee.status !== "active") {
      console.warn(`Requesting employee "${employee_id}" is not active (status: ${requestingEmployee.status})`);
      return res.status(400).json({ error: `Requesting employee is not active` });
    }

    let query = `
      SELECT p.employee_id, p.month, u.full_name as employee, COALESCE(u.department_name, 'HR') as department, 
             u.designation_name, u.role, p.net_salary as salary, p.status,
             p.payment_date, p.unpaid_leave_days, p.total_working_days,
             p.basic_salary, p.hra, p.special_allowances, p.bonus,
             p.pf_deduction, p.esic_deduction, p.professional_tax, p.tax_deduction
      FROM payroll p
      JOIN hrms_users u ON p.employee_id = u.employee_id
    `;
    let countQuery = `
      SELECT COUNT(*) as total
      FROM payroll p
      JOIN hrms_users u ON p.employee_id = u.employee_id
    `;
    let params = [];
    let countParams = [];

    // Role-based access control
    if (!["super_admin", "hr"].includes(role)) {
      // Restrict to own payslips for employee, dept_head, manager
      query += " WHERE p.employee_id = ?";
      countQuery += " WHERE p.employee_id = ?";
      params.push(employee_id);
      countParams.push(employee_id);
    } else if (role === "hr" && employeeId) {
      // HR can view specific employee's payslips, except other HR users
      const [targetEmployee] = await queryAsync(
        `SELECT role FROM hrms_users WHERE employee_id = ?`,
        [employeeId]
      );
      if (targetEmployee?.role === "hr") {
        console.warn(`HR user ${employee_id} attempted to view payslip of another HR user ${employeeId}`);
        return res.status(403).json({ error: "HR users cannot view payslips of other HR users" });
      }
      query += " WHERE p.employee_id = ?";
      countQuery += " WHERE p.employee_id = ?";
      params.push(employeeId);
      countParams.push(employeeId);
    }

    if (month) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        throw new Error("Invalid month format. Use YYYY-MM");
      }
      query += params.length ? " AND p.month = ?" : " WHERE p.month = ?";
      countQuery += countParams.length ? " AND p.month = ?" : " WHERE p.month = ?";
      params.push(month);
      countParams.push(month);
    }

    query += " ORDER BY p.month DESC, u.full_name LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    console.log(`Executing getPayslips query:`, query, params);
    const [payslips, [{ total }]] = await Promise.all([
      queryAsync(query, params),
      queryAsync(countQuery, countParams),
    ]);

    payslips.forEach((payslip) => {
      payslip.salary = parseFloat(payslip.salary) || 0;
      // Ensure numerical fields are parsed
      [
        "basic_salary",
        "hra",
        "special_allowances",
        "bonus",
        "pf_deduction",
        "esic_deduction",
        "professional_tax",
        "tax_deduction",
      ].forEach((field) => {
        payslip[field] = parseFloat(payslip[field]) || 0;
      });
    });

    console.log(`Fetched ${payslips.length} payslips, total: ${total}`);
    res.json({
      message: "Payslips fetched successfully",
      data: payslips,
      totalRecords: total,
    });
  } catch (error) {
    console.error(`Error fetching payslips:`, error.message, error.sqlMessage);
    res.status(error.message.includes("not found") ? 404 : 400).json({
      error: "Error fetching payslips",
      details: error.sqlMessage || error.message,
    });
  }
};

module.exports = { generatePayslip, getPayslips };