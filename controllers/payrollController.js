const PDFDocument = require("pdfkit-table");
const pool = require("../config/db");
const util = require("util");
const path = require("path");
const fs = require("fs");

const queryAsync = util.promisify(pool.query).bind(pool);

const COMPANY_CONFIG = {
  company_id: 1,
  company_name: "MNTechs Solutions Pvt Ltd",
  company_pan: "ABCDE1234F",
  company_gstin: "12ABCDE1234F1Z5",
  address: "123 Business Street, City, Country",
};

const formatCurrency = (value) => {
  return `₹${(parseFloat(value) || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const calculateLeaveAndAttendance = async (employeeId, month) => {
  const [year, monthNum] = month.split("-").map(Number);
  const startDate = new Date(year, monthNum - 1, 1);
  const endDate = new Date(year, monthNum, 0);
  const today = new Date("2025-09-17T14:37:00+05:30"); // Current date: 2025-09-17 02:37 PM IST
  const calculationEndDate = today < endDate ? today : endDate;
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = calculationEndDate.toISOString().split("T")[0];

  try {
    const [employee] = await queryAsync(
      "SELECT join_date, status, role FROM hrms_users WHERE employee_id = ?",
      [employeeId]
    );
    if (!employee) {
      throw new Error("Employee not found");
    }
    if (employee.status !== "active") {
      console.warn(`Employee ${employeeId} is not active (status: ${employee.status})`);
      return {
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        leaveDetails: [],
        presentDays: 0,
        holidays: 0,
        totalWorkingDays: 0,
      };
    }

    const joinDate = employee.join_date ? new Date(employee.join_date) : null;
    if (!joinDate && ["employee", "manager"].includes(employee.role)) {
      console.error(`Missing join_date for employee ${employeeId} with role ${employee.role}`);
      throw new Error("Join date is required for employee/manager roles");
    }
    const effectiveStartDate = joinDate && joinDate > startDate ? joinDate : startDate;

    if (effectiveStartDate > calculationEndDate) {
      console.log(`Employee ${employeeId} not eligible for ${month} (join_date: ${joinDate})`);
      return {
        paidLeaveDays: 0,
        unpaidLeaveDays: 0,
        leaveDetails: [],
        presentDays: 0,
        holidays: 0,
        totalWorkingDays: 0,
      };
    }

    const holidays = await queryAsync(
      "SELECT date FROM holidays WHERE date BETWEEN ? AND ?",
      [startDateStr, endDateStr]
    );
    const holidayDates = holidays.map((h) => h.date.toISOString().split("T")[0]);

    const leaves = await queryAsync(
      `SELECT start_date, end_date, leave_type, leave_status, total_days 
       FROM leaves 
       WHERE employee_id = ? AND status = 'Approved' 
       AND start_date <= ? AND end_date >= ?`,
      [employeeId, endDateStr, startDateStr]
    );

    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let leaveDetails = [];
    for (const leave of leaves) {
      const start = new Date(Math.max(new Date(leave.start_date), effectiveStartDate));
      const end = new Date(Math.min(new Date(leave.end_date), calculationEndDate));
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const isHoliday = holidayDates.includes(dateStr);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        if (!isHoliday && !isWeekend) {
          if (leave.leave_status === "Unpaid") {
            unpaidLeaveDays++;
          } else {
            paidLeaveDays++;
          }
        }
      }
      leaveDetails.push({
        type: leave.leave_type,
        days: leave.total_days,
        start_date: leave.start_date,
        end_date: leave.end_date,
        status: leave.leave_status,
      });
    }

    const attendance = await queryAsync(
      `SELECT date FROM attendance 
       WHERE employee_id = ? AND status IN ('Present', 'Approved') 
       AND date BETWEEN ? AND ?`,
      [employeeId, startDateStr, endDateStr]
    );
    const presentDays = attendance.length;

    let totalWorkingDays = 0;
    for (let d = new Date(effectiveStartDate); d <= calculationEndDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      const isHoliday = holidayDates.includes(dateStr);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      if (!isHoliday && !isWeekend) totalWorkingDays++;
    }

    console.log(`calculateLeaveAndAttendance for employee ${employeeId}, month ${month}:`, {
      join_date: employee.join_date,
      role: employee.role,
      status: employee.status,
      effectiveStartDate,
      calculationEndDate,
      totalWorkingDays,
      presentDays,
      paidLeaveDays,
      unpaidLeaveDays,
    });

    return {
      paidLeaveDays,
      unpaidLeaveDays,
      leaveDetails,
      presentDays,
      holidays: holidayDates.length,
      totalWorkingDays,
    };
  } catch (err) {
    console.error("Error in calculateLeaveAndAttendance:", err.message, err.sqlMessage);
    throw new Error(`Failed to calculate leave and attendance: ${err.sqlMessage || err.message}`);
  }
};

const validateMonth = (month) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error("Invalid month format. Use YYYY-MM");
  }
  return true;
};

const calculateTax = (gross) => {
  if (gross <= 250000) return 0;
  if (gross <= 500000) return gross * 0.05;
  if (gross <= 1000000) return gross * 0.2;
  return gross * 0.3;
};

const getPayrolls = async (req, res) => {
  try {
    const { month, page = 1, limit = 10 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let query = "SELECT * FROM payroll";
    let countQuery = "SELECT COUNT(*) as total FROM payroll";
    let params = [];
    let countParams = [];

    if (month) {
      validateMonth(month);
      query += " WHERE month = ?";
      countQuery += " WHERE month = ?";
      params.push(month);
      countParams.push(month);
    }

    query += " LIMIT ? OFFSET ?";
    params.push(parseInt(limit), offset);

    const [rows, [{ total }]] = await Promise.all([
      queryAsync(query, params),
      queryAsync(countQuery, countParams),
    ]);

    res.json({
      message: "Payroll fetched successfully",
      data: rows,
      totalRecords: total,
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage);
    res.status(500).json({
      error: "Database error",
      details: err.sqlMessage || err.message,
    });
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

  const numericFields = {
    grossSalary,
    pfDeduction,
    esicDeduction,
    taxDeduction,
    professionalTax,
    netSalary,
  };
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

    const calculatedNetSalary =
      grossSalary - (pfDeduction + esicDeduction + taxDeduction + professionalTax);
    if (Math.abs(calculatedNetSalary - netSalary) > 0.01) {
      return res.status(400).json({ error: "Net salary calculation mismatch" });
    }

    const result = await queryAsync(
      `INSERT INTO payroll 
      (employee_name, employee_id, department, gross_salary, pf_deduction, esic_deduction, tax_deduction, professional_tax, net_salary, status, payment_method, month, payment_date, created_by, company_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        COMPANY_CONFIG.company_id,
      ]
    );
    res.status(201).json({
      message: "Payroll created successfully",
      data: { id: result.insertId, ...req.body, created_by: req.user.employee_id },
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage);
    res.status(500).json({
      error: "Database error",
      details: err.sqlMessage || err.message,
    });
  }
};

const generatePayroll = async (req, res) => {
  const userRole = req.user?.role;
  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }
  const { month } = req.body;
  try {
    validateMonth(month);
    const employees = await queryAsync(
      `SELECT employee_id, full_name, department_name, basic_salary, allowances, bonuses, designation_name, join_date
       FROM hrms_users
       WHERE role IN ('employee', 'hr', 'dept_head', 'manager') AND status = 'active'`
    );
    if (!employees.length) {
      return res.status(404).json({ error: "No active employees found" });
    }

    await queryAsync("DELETE FROM payroll WHERE month = ?", [month]);
    const payrolls = [];
    for (const emp of employees) {
      if (!emp.basic_salary) {
        console.warn(`Skipping employee ${emp.employee_id} due to missing salary data`);
        continue;
      }
      if (["employee", "manager"].includes(emp.role) && !emp.join_date) {
        console.warn(`Skipping employee ${emp.employee_id} due to missing join_date`);
        continue;
      }

      const { paidLeaveDays, unpaidLeaveDays, presentDays, holidays, totalWorkingDays } = await calculateLeaveAndAttendance(emp.employee_id, month);

      const gross_salary =
        parseFloat(emp.basic_salary || 0) +
        parseFloat(emp.allowances || 0) +
        parseFloat(emp.bonuses || 0);

      let adjustedGrossSalary = gross_salary;
      let salaryAdjustment = 0;
      if (totalWorkingDays > 0) {
        const dailyRate = gross_salary / totalWorkingDays;
        salaryAdjustment = unpaidLeaveDays * dailyRate;
        const effectiveWorkingDays = presentDays + paidLeaveDays;
        adjustedGrossSalary = effectiveWorkingDays * dailyRate;
      }

      const pf_deduction = Math.min(adjustedGrossSalary * 0.12, 1800);
      const esic_deduction = adjustedGrossSalary <= 21000 ? adjustedGrossSalary * 0.0075 : 0;
      const professional_tax = adjustedGrossSalary <= 15000 ? 0 : 200;
      const tax_deduction = calculateTax(adjustedGrossSalary);
      const net_salary =
        adjustedGrossSalary - (pf_deduction + esic_deduction + professional_tax + tax_deduction);

      const payrollData = {
        employee_id: emp.employee_id,
        employee_name: emp.full_name,
        department: emp.department_name || "HR",
        designation_name: emp.designation_name || null,
        gross_salary: adjustedGrossSalary,
        pf_deduction,
        esic_deduction,
        professional_tax,
        tax_deduction,
        basic_salary: totalWorkingDays > 0 ? (parseFloat(emp.basic_salary) * (presentDays + paidLeaveDays) / totalWorkingDays) || 0 : 0,
        hra: totalWorkingDays > 0 ? (parseFloat(emp.allowances) * 0.4 * (presentDays + paidLeaveDays) / totalWorkingDays) || 0 : 0,
        da: totalWorkingDays > 0 ? (parseFloat(emp.allowances) * 0.5 * (presentDays + paidLeaveDays) / totalWorkingDays) || 0 : 0,
        other_allowances: totalWorkingDays > 0 ? (parseFloat(emp.allowances) * 0.1 * (presentDays + paidLeaveDays) / totalWorkingDays) || 0 : 0,
        net_salary,
        status: userRole === "super_admin" ? "Paid" : "Pending",
        payment_method: "Bank Transfer",
        payment_date: `${month}-01`,
        month,
        created_by: req.user.employee_id,
        company_id: COMPANY_CONFIG.company_id,
        paid_leave_days: paidLeaveDays,
        unpaid_leave_days: unpaidLeaveDays,
        present_days: presentDays,
        holidays: holidays,
        total_working_days: totalWorkingDays,
      };
      await queryAsync("INSERT INTO payroll SET ?", payrollData);

      if (unpaidLeaveDays > 0 || totalWorkingDays === 0) {
        await queryAsync(
          "INSERT INTO audit_logs (action, employee_id, details, performed_at) VALUES (?, ?, ?, NOW())",
          [
            totalWorkingDays === 0 ? "NO_SALARY" : "UNPAID_LEAVE_DEDUCTION",
            emp.employee_id,
            totalWorkingDays === 0
              ? `No salary calculated for ${month} due to zero working days`
              : `Deducted ${formatCurrency(salaryAdjustment)} for ${unpaidLeaveDays} unpaid leave days in ${month}`,
          ]
        );
      }

      payrolls.push(payrollData);
    }

    if (!payrolls.length) {
      return res.status(400).json({ error: "No valid employees found for payroll generation" });
    }

    res.json({
      message: `Payroll generated successfully for ${payrolls.length} employees`,
      data: payrolls,
    });
  } catch (err) {
    console.error("Error generating payroll:", err.message, err.sqlMessage);
    res.status(500).json({
      error: "Failed to generate payroll",
      details: err.sqlMessage || err.message,
    });
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
      `SELECT employee_id, full_name, department_name, basic_salary, allowances, bonuses, designation_name, join_date, status, role
       FROM hrms_users
       WHERE employee_id = ?`,
      [employeeId]
    );
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }
    if (employee.status !== "active") {
      return res.status(400).json({ error: `Employee is not active (status: ${employee.status})` });
    }
    if (!employee.basic_salary) {
      return res.status(400).json({ error: "Employee has no salary data" });
    }
    if (["employee", "manager"].includes(employee.role) && !employee.join_date) {
      return res.status(400).json({ error: "Join date is required for employee/manager roles" });
    }

    const [existingPayroll] = await queryAsync(
      `SELECT id FROM payroll WHERE employee_id = ? AND month = ?`,
      [employeeId, month]
    );
    if (existingPayroll) {
      return res.status(400).json({
        error: `Payroll already exists for ${employeeId} for ${month}`,
      });
    }

    const { paidLeaveDays, unpaidLeaveDays, presentDays, holidays, totalWorkingDays } = await calculateLeaveAndAttendance(employeeId, month);

    if (totalWorkingDays === 0) {
      const payrollData = {
        employee_id: employeeId,
        employee_name: employee.full_name,
        department: employee.department_name || "HR",
        designation_name: employee.designation_name || null,
        gross_salary: 0,
        net_salary: 0,
        pf_deduction: 0,
        esic_deduction: 0,
        professional_tax: 0,
        tax_deduction: 0,
        basic_salary: 0,
        hra: 0,
        da: 0,
        other_allowances: 0,
        status: userRole === "super_admin" ? "Paid" : "Pending",
        payment_method: "None",
        payment_date: new Date(`${month}-01`).toISOString().split("T")[0],
        month,
        created_by: userId,
        company_id: COMPANY_CONFIG.company_id,
        paid_leave_days: paidLeaveDays,
        unpaid_leave_days: unpaidLeaveDays,
        present_days: presentDays,
        holidays: holidays,
        total_working_days: totalWorkingDays,
      };

      const result = await queryAsync("INSERT INTO payroll SET ?", payrollData);
      await queryAsync(
        "INSERT INTO audit_logs (action, employee_id, details, performed_at) VALUES (?, ?, ?, NOW())",
        [employeeId, "NO_SALARY", `No salary calculated for ${month} due to zero working days`]
      );

      return res.status(201).json({
        message: `Payroll generated successfully for ${employeeId} for ${month}`,
        data: { id: result.insertId, ...payrollData },
      });
    }

    const [bankDetails] = await queryAsync(
      `SELECT bank_account_number, ifsc_number FROM bank_details WHERE employee_id = ?`,
      [employeeId]
    );

    const gross_salary =
      (parseFloat(employee.basic_salary) || 0) +
      (parseFloat(employee.allowances) || 0) +
      (parseFloat(employee.bonuses) || 0);
    const dailyRate = totalWorkingDays > 0 ? gross_salary / totalWorkingDays : 0;
    const effectiveWorkingDays = presentDays + paidLeaveDays;
    const adjustedGrossSalary = effectiveWorkingDays * dailyRate;
    const pf_deduction = Math.min(adjustedGrossSalary * 0.12, 1800);
    const esic_deduction = adjustedGrossSalary <= 21000 ? adjustedGrossSalary * 0.0075 : 0;
    const professional_tax = adjustedGrossSalary <= 15000 ? 0 : 200;
    const tax_deduction = calculateTax(adjustedGrossSalary);
    const net_salary =
      adjustedGrossSalary - (pf_deduction + esic_deduction + professional_tax + tax_deduction);

    const payrollData = {
      employee_id: employeeId,
      employee_name: employee.full_name,
      department: employee.department_name || "HR",
      designation_name: employee.designation_name || null,
      gross_salary: adjustedGrossSalary,
      net_salary,
      pf_deduction,
      esic_deduction,
      professional_tax,
      tax_deduction,
      basic_salary: totalWorkingDays > 0 ? (parseFloat(employee.basic_salary) * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
      hra: totalWorkingDays > 0 ? (parseFloat(employee.allowances) * 0.4 * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
      da: totalWorkingDays > 0 ? (parseFloat(employee.allowances) * 0.5 * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
      other_allowances: totalWorkingDays > 0 ? (parseFloat(employee.allowances) * 0.1 * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
      status: userRole === "super_admin" ? "Paid" : "Pending",
      payment_method: bankDetails ? "Bank Transfer" : "Cash",
      payment_date: new Date(`${month}-01`).toISOString().split("T")[0],
      month,
      created_by: userId,
      company_id: COMPANY_CONFIG.company_id,
      paid_leave_days: paidLeaveDays,
      unpaid_leave_days: unpaidLeaveDays,
      present_days: presentDays,
      holidays: holidays,
      total_working_days: totalWorkingDays,
    };

    const result = await queryAsync("INSERT INTO payroll SET ?", payrollData);

    if (unpaidLeaveDays > 0) {
      await queryAsync(
        "INSERT INTO audit_logs (action, employee_id, details, performed_at) VALUES (?, ?, ?, NOW())",
        [
          "UNPAID_LEAVE_DEDUCTION",
          employeeId,
          `Deducted ${formatCurrency(unpaidLeaveDays * dailyRate)} for ${unpaidLeaveDays} unpaid leave days in ${month}`,
        ]
      );
    }

    res.status(201).json({
      message: `Payroll generated successfully for ${employeeId} for ${month}`,
      data: { id: result.insertId, ...payrollData },
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage);
    res.status(500).json({
      error: `Database error: ${err.message}`,
      details: err.sqlMessage || err.message,
    });
  }
};

const downloadPayrollPDF = async (req, res) => {
  const userRole = req.user?.role;
  const { month, employee_id } = req.query;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }

  try {
    validateMonth(month);
    let query = `
      SELECT p.*, u.full_name AS employee_name, COALESCE(u.department_name, 'HR') AS department,
             u.designation_name, u.join_date
      FROM payroll p
      JOIN hrms_users u ON p.employee_id = u.employee_id
      WHERE p.month = ?
    `;
    let params = [month];

    if (employee_id) {
      query += " AND p.employee_id = ?";
      params.push(employee_id);
    }

    const payrolls = await queryAsync(query, params);
    if (!payrolls.length) {
      return res.status(404).json({
        error: `No payroll records found for ${employee_id ? `employee ${employee_id}` : "the specified month"}`,
      });
    }

    const doc = new PDFDocument({ margin: 40, size: "A4", autoFirstPage: true });
    const fileName = employee_id
      ? `Payroll_${month}_${employee_id}.pdf`
      : `Payroll_${month}_All.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    let streamEnded = false;
    doc.on("error", (err) => {
      console.error("PDF stream error:", err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate PDF", details: err.message });
      }
      streamEnded = true;
    });

    res.on("finish", () => {
      streamEnded = true;
    });

    doc.pipe(res);
    doc.font("Helvetica");

    let pageNumber = 1;
    doc.on("pageAdded", () => {
      pageNumber++;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#6B7280")
        .text(`Page ${pageNumber}`, 500, 780, { align: "right" });
    });

    doc
      .font("Helvetica")
      .fontSize(60)
      .fillColor("#E5E7EB")
      .opacity(0.1)
      .text("CONFIDENTIAL", 100, 300, { align: "center", rotate: 45 })
      .opacity(1);

    const logoPath = path.join(__dirname, "../public/images/company_logo.png");
    doc.rect(0, 0, 595, 80).fill("#F3F4F6").fillColor("#111827");
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 15, { width: 100, height: 50 });
    } else {
      console.warn("Logo file not found:", logoPath);
      doc
        .font("Helvetica")
        .fontSize(12)
        .fillColor("#EF4444")
        .text("Logo Unavailable", 40, 25);
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(20)
      .fillColor("#111827")
      .text(COMPANY_CONFIG.company_name, 150, 20, { width: 400, wordWrap: true });
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#6B7280")
      .text(COMPANY_CONFIG.address, 150, 45, { width: 400, wordWrap: true });
    doc
      .fontSize(9)
      .text(
        `PAN: ${COMPANY_CONFIG.company_pan} | GSTIN: ${COMPANY_CONFIG.company_gstin}`,
        150,
        60,
        { width: 400 }
      );

    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor("#1F2937")
      .text(`Payroll Report - ${month}${employee_id ? ` for ${employee_id}` : ""}`, 40, 100, { align: "center" });
    doc.moveDown(1);

    const table = {
      headers: [
        { label: "Emp ID", property: "employee_id", width: 80, align: "center" },
        { label: "Name", property: "employee_name", width: 100, align: "left" },
        { label: "Department", property: "department", width: 70, align: "left" },
        { label: "Designation", property: "designation_name", width: 80, align: "left" },
        { label: "Gross Salary", property: "gross_salary", width: 70, align: "right", renderer: formatCurrency },
        { label: "Net Salary", property: "net_salary", width: 70, align: "right", renderer: formatCurrency },
        { label: "Status", property: "status", width: 50, align: "center" },
      ],
      datas: payrolls
        .filter((p) => p.employee_id && p.employee_name)
        .map((p) => ({
          employee_id: (p.employee_id || "-").substring(0, 15),
          employee_name: (p.employee_name || "-").substring(0, 18),
          department: (p.department || "HR").substring(0, 12),
          designation_name: (p.designation_name || "-").substring(0, 15),
          gross_salary: parseFloat(p.gross_salary) || 0,
          net_salary: parseFloat(p.net_salary) || 0,
          status: (p.status || "-").substring(0, 10),
        })),
    };

    doc.y = 150;
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#1F2937")
      .text("Payroll Summary", 40, doc.y, { align: "left" });
    doc.moveDown(0.5);

    await doc.table(table, {
      x: 40,
      width: 510,
      padding: 4,
      columnSpacing: 4,
      minRowHeight: 20,
      prepareHeader: () => {
        doc
          .rect(40, doc.y, 510, 25)
          .fill("#111827")
          .fillColor("#FFFFFF")
          .font("Helvetica-Bold")
          .fontSize(10);
      },
      prepareRow: (row, indexColumn, indexRow, rectRow) => {
        doc.font("Helvetica").fontSize(8).fillColor("#111827");
        if (indexRow % 2 === 0) {
          doc
            .rect(rectRow.x, rectRow.y, rectRow.width, rectRow.height)
            .fill("#F9FAFB")
            .fillColor("#111827");
        }
        if (indexColumn === table.headers.length - 1) {
          doc.fillColor(row.status === "Paid" ? "#15803D" : "#DC2626").font("Helvetica-Bold");
        }
        return 20;
      },
      border: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      headerBorder: { top: 1, bottom: 1, left: 1, right: 1 },
      wordWrap: true,
      maxHeight: 650,
      continuedHeader: () => {
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#6B7280")
          .text(`(Continued from Page ${pageNumber - 1})`, 40, doc.y + 10, { align: "left" });
        doc.moveDown(0.5);
      },
    });

    doc.moveDown(1);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#6B7280")
      .text(`Generated on: ${new Date().toLocaleDateString("en-IN")}`, 40, doc.y, { align: "left" });
    doc.text(`Generated by: ${req.user?.employee_id || "Admin"}`, 40, doc.y + 15);

    const signaturePath = path.join(__dirname, "../public/images/hr_signature.png");
    if (fs.existsSync(signaturePath)) {
      doc.image(signaturePath, 400, doc.y + 20, { width: 100, height: 40 });
    } else {
      console.warn("Signature file not found:", signaturePath);
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor("#1F2937")
        .text("Admin Authorized Signatory", 400, doc.y + 20, { align: "right", width: 150 });
    }

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#6B7280")
      .text("Page 1", 500, 780, { align: "right" });

    if (!streamEnded) {
      doc.end();
    }
  } catch (err) {
    console.error("Error generating payroll PDF:", err.message, err.sqlMessage);
    if (!res.headersSent) {
      res.status(500).json({
        error: "Failed to generate payroll PDF",
        details: err.sqlMessage || err.message,
      });
    }
  }
};

module.exports = {
  getPayrolls,
  createPayroll,
  generatePayroll,
  generatePayrollForEmployee,
  downloadPayrollPDF,
  calculateLeaveAndAttendance,
};