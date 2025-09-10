const PDFDocument = require("pdfkit-table");
const pool = require("../config/db");
const util = require("util");
const path = require("path");
const fs = require("fs");
const { permission } = require("process");
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

const validateInput = (employeeId, month) => {
  if (!employeeId) throw new Error("Invalid employee ID");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Invalid month format. Use YYYY-MM");
  return true;
};

const calculateTax = (gross) => {
  if (gross <= 250000) return 0;
  if (gross <= 500000) return gross * 0.05;
  if (gross <= 1000000) return gross * 0.2;
  return gross * 0.3;
};

const generatePayrollForEmployee = async (
  employeeId,
  month,
  userRole,
  userId
) => {
  const [employee] = await queryAsync(
    `SELECT employee_id, full_name, department_name, basic_salary, allowances, bonuses, designation_name
     FROM hrms_users
     WHERE employee_id = ? AND status = 'active'`,
    [employeeId]
  );
  if (!employee) throw new Error("Employee not found or inactive");
  if (!employee.basic_salary) throw new Error("Employee has no salary data");

  const [existingPayroll] = await queryAsync(
    `SELECT id FROM payroll WHERE employee_id = ? AND month = ?`,
    [employeeId, month]
  );
  if (existingPayroll) return null;

  const [bankDetails] = await queryAsync(
    `SELECT bank_account_number, ifsc_number FROM bank_details WHERE employee_id = ?`,
    [employeeId]
  );

  const gross_salary =
    (parseFloat(employee.basic_salary) || 0) +
    (parseFloat(employee.allowances) || 0) +
    (parseFloat(employee.bonuses) || 0);
  const pf_deduction = Math.min(gross_salary * 0.12, 1800);
  const esic_deduction = gross_salary <= 21000 ? gross_salary * 0.0075 : 0;
  const professional_tax = gross_salary <= 15000 ? 0 : 200;
  const tax_deduction = calculateTax(gross_salary);
  const net_salary =
    gross_salary -
    (pf_deduction + esic_deduction + professional_tax + tax_deduction);

  const payrollData = {
    employee_id: employeeId,
    employee_name: employee.full_name,
    department: employee.department_name || "HR",
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
    status:
      userRole === "employee"
        ? "Approved"
        : userRole === "super_admin"
        ? "Paid"
        : "Pending",
    payment_method: bankDetails ? "Bank Transfer" : "Cash",
    payment_date: new Date(`${month}-01`).toISOString().split("T")[0],
    month,
    created_by: userId,
    company_id: COMPANY_CONFIG.company_id,
  };

  await queryAsync("INSERT INTO payroll SET ?", payrollData);
  return payrollData;
};

const numberToWords = (num) => {
  if (num === 0) return "zero";
  const a = [
    "",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
  ];
  const b = [
    "",
    "",
    "twenty",
    "thirty",
    "forty",
    "fifty",
    "sixty",
    "seventy",
    "eighty",
    "ninety",
  ];

  const numToWords = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000)
      return (
        a[Math.floor(n / 100)] +
        " hundred" +
        (n % 100 ? " " + numToWords(n % 100) : "")
      );
    if (n < 100000)
      return (
        numToWords(Math.floor(n / 1000)) +
        " thousand" +
        (n % 1000 ? " " + numToWords(n % 1000) : "")
      );
    if (n < 10000000)
      return (
        numToWords(Math.floor(n / 100000)) +
        " lakh" +
        (n % 100000 ? " " + numToWords(n % 100000) : "")
      );
    return (
      numToWords(Math.floor(n / 10000000)) +
      " crore" +
      (n % 10000000 ? " " + numToWords(n % 10000000) : "")
    );
  };

  return numToWords(Math.floor(num)).trim();
};

const drawTable = (doc, title, data, startX, startY) => {
  const col1Width = 400,
    col2Width = 80,
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
      .text(value, startX + col1Width, y + 5, {
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
};

const generatePayslip = async (req, res) => {
  const { employeeId, month } = req.params;
  const { role, employee_id } = req.user;

  try {
    validateInput(employeeId, month);

    if (role === "employee" && employeeId !== employee_id) {
      return res
        .status(403)
        .json({ error: "Access denied: You can only view your own payslip" });
    }

    if (!["super_admin", "hr", "employee"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    let payroll = await queryAsync(
      `SELECT 
        p.employee_id, p.month, p.gross_salary, p.net_salary, p.pf_deduction, 
        p.esic_deduction, p.tax_deduction, p.professional_tax, p.basic_salary, 
        p.hra, p.da, p.other_allowances, p.payment_method, p.payment_date, 
        p.status, p.created_by, p.paid_leave_days, p.unpaid_leave_days, p.present_days, p.holidays, p.total_working_days,
        u.full_name AS employee_name, COALESCE(u.department_name, 'HR') AS department, 
        u.designation_name, pd.pan_number, pd.uan_number, u.dob,
        b.bank_account_number, b.ifsc_number
      FROM payroll p
      JOIN hrms_users u ON p.employee_id = u.employee_id
      LEFT JOIN personal_details pd ON p.employee_id = pd.employee_id
      LEFT JOIN bank_details b ON p.employee_id = b.employee_id
      WHERE p.employee_id = ? AND p.month = ?`,
      [employeeId, month]
    );

    if (!payroll.length) {
      const newPayroll = await generatePayrollForEmployee(
        employeeId,
        month,
        role,
        employee_id
      );
      if (!newPayroll) {
        return res.status(400).json({
          error: `Payroll already exists for ${employeeId} in ${month}`,
        });
      }
      const [userDetails] = await queryAsync(
        `SELECT dob FROM hrms_users WHERE employee_id = ?`,
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
        },
      ];
    }

    const employee = payroll[0];

    let userPassword = "default123"; 
    if (employee.dob) {
      const dobDate = new Date(employee.dob);
      if (!isNaN(dobDate)) {
        const day = String(dobDate.getDate()).padStart(2, "0");
        const month = String(dobDate.getMonth() + 1).padStart(2, "0"); 
        const year = dobDate.getFullYear();
        userPassword = `${day}-${month}-${year}`; // e.g., 25-12-1990
      } else {
        console.warn(`Invalid DOB for employee ${employeeId}: ${employee.dob}`);
      }
    } else {
      console.warn(`DOB missing for employee ${employeeId}. Using default password.`);
    }

    // Initialize PDF with DOB-based password
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

    // ... (rest of the PDF generation code remains unchanged)
    const logoPath = path.join(__dirname, "../public/images/company_logo.png");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 30, { width: 80, height: 40 });
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
        width: 250,
        align: "center",
        underline: true,
      });

    doc.moveDown(2);
    const leftDetails = [
      ["Employee Name", employee.employee_name || "-"],
      ["Employee ID", employee.employee_id || "-"],
      ["Department", employee.department || "HR"],
      ["Designation", employee.designation_name || "-"],
      ["Pay Period", employee.month || "-"],
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
        .text(":", 120, y, { width: 10, align: "center" });

      doc
        .font("Times-Roman")
        .fontSize(9)
        .fillColor("#333")
        .text(value, 140, y, { width: 120, align: "left" });

      y += 18;
    });

    y = doc.y - leftDetails.length * 18;

    rightDetails.forEach(([label, value]) => {
      doc
        .font("Times-Bold")
        .fontSize(9)
        .fillColor("#000")
        .text(label, 340, y, { width: 95, align: "left" });

      doc
        .font("Times-Bold")
        .fontSize(9)
        .fillColor("#000")
        .text(":", 410, y, { width: 10, align: "center" });

      doc
        .font("Times-Roman")
        .fontSize(9)
        .fillColor("#333")
        .text(value, 430, y, { width: 120, align: "left" });

      y += 18;
    });

    doc.moveDown(2);
    const startY = doc.y + 10;
    const earnings = [
      ["Basic Salary", formatCurrency(employee.basic_salary)],
      ["HRA", formatCurrency(employee.hra)],
      ["Dearness Allowance", formatCurrency(employee.da)],
      ["Other Allowances", formatCurrency(employee.other_allowances)],
      ["Total Earnings", formatCurrency(employee.gross_salary)],
    ];
    const deductions = [
      ["Provident Fund", formatCurrency(employee.pf_deduction)],
      ["ESIC", formatCurrency(employee.esic_deduction)],
      ["Professional Tax", formatCurrency(employee.professional_tax)],
      ["Income Tax", formatCurrency(employee.tax_deduction)],
      [
        "Total Deductions",
        formatCurrency(
          (employee.pf_deduction || 0) +
            (employee.esic_deduction || 0) +
            (employee.professional_tax || 0) +
            (employee.tax_deduction || 0)
        ),
      ],
      ["Net Pay", formatCurrency(employee.net_salary)],
    ];
    const attendanceSummary = [
      ["Total Working Days", employee.total_working_days || 0],
      ["Days Present", employee.present_days || 0],
      ["Paid Leave Days", employee.paid_leave_days || 0],
      ["Unpaid Leave Days", employee.unpaid_leave_days || 0],
      ["Holidays", employee.holidays || 0],
    ];

    let tableY = startY;
    drawTable(doc, "Earnings", earnings, 50, tableY);
    tableY += earnings.length * 20 + 30;

    drawTable(doc, "Deductions", deductions, 50, tableY);
    tableY += deductions.length * 20 + 30;

    drawTable(doc, "Attendance Summary", attendanceSummary, 50, tableY);
    tableY += attendanceSummary.length * 20 + 40;

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
      .text(
        numberToWords(employee.net_salary).replace(/^\w/, (c) =>
          c.toUpperCase()
        ),
        0,
        doc.y,
        { align: "center" }
      );

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
    res.status(error.message.includes("Invalid") ? 400 : 500).json({
      error: "Error generating payslip PDF",
      details: error.sqlMessage || error.message,
    });
  }
};

const getPayslips = async (req, res) => {
  const { role, employee_id } = req.user;
  const { page = 1, limit = 10, month } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  try {
    let query = `
      SELECT p.employee_id, p.month, u.full_name as employee, COALESCE(u.department_name, 'HR') as department, 
             u.designation_name, p.net_salary as salary, p.status,
             p.basic_salary, p.hra, p.da, p.other_allowances, p.pf_deduction, 
             p.esic_deduction, p.tax_deduction, p.professional_tax, p.payment_date,
             p.leave_days, p.present_days, p.holidays, p.total_working_days
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

    if (role === "employee") {
      query += " WHERE p.employee_id = ?";
      countQuery += " WHERE p.employee_id = ?";
      params.push(employee_id);
      countParams.push(employee_id);
    } else if (!["super_admin", "hr"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (month) {
      query += role === "employee" ? " AND p.month = ?" : " WHERE p.month = ?";
      countQuery +=
        role === "employee" ? " AND p.month = ?" : " WHERE p.month = ?";
      params.push(month);
      countParams.push(month);
    }

    query += " LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [payslips, [{ total }]] = await Promise.all([
      queryAsync(query, params),
      queryAsync(countQuery, countParams),
    ]);

    res.json({
      message: "Payslips fetched successfully",
      data: payslips,
      totalRecords: total,
    });
  } catch (error) {
    console.error(`Error fetching payslips:`, error.message, error.sqlMessage);
    res.status(500).json({
      error: "Error fetching payslips",
      details: error.sqlMessage || error.message,
    });
  }
};

module.exports = { generatePayslip, getPayslips };
