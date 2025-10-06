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
  const startDateStr = startDate.toISOString().split("T")[0];
  const endDateStr = endDate.toISOString().split("T")[0];

  const today = new Date();  
  const todayStr = today.toISOString().split("T")[0];
  const effectiveEndDate = new Date(todayStr <= endDateStr ? todayStr : endDateStr);
  const effectiveEndDateStr = effectiveEndDate.toISOString().split("T")[0];

  try {
    console.log(`Calculating leave and attendance for "${employeeId}" in ${month}...`);

    const [employee] = await queryAsync(
      "SELECT join_date, status, role FROM hrms_users WHERE employee_id = ?",
      [employeeId]
    );
    if (!employee) {
      throw new Error(`Employee ${employeeId} not found`);
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

    // Fetch holidays (up to effectiveEndDate)
    let holidayDates = [];
    try {
      const holidays = await queryAsync(
        "SELECT holiday_date FROM holidays WHERE holiday_date BETWEEN ? AND ?",
        [startDateStr, effectiveEndDateStr]  // FIX: Cap to effectiveEndDateStr
      );
      holidayDates = holidays.map((h) =>
        h.holiday_date instanceof Date
          ? h.holiday_date.toISOString().split("T")[0]
          : h.holiday_date
      );
      console.log(`Holidays for ${month}:`, holidayDates);
    } catch (err) {
      console.error(`Error querying holidays for ${month}:`, err.sqlMessage || err.message);
      holidayDates = [];
    }

    // Fetch leaves (cap end_date to effectiveEndDate)
    const leaves = await queryAsync(
      `SELECT start_date, end_date, leave_type, leave_status, total_days 
       FROM leaves 
       WHERE employee_id = ? AND status = 'Approved' 
       AND start_date <= ? AND end_date >= ?`,
      [employeeId, effectiveEndDateStr, startDateStr]  // FIX: Use effectiveEndDateStr
    );
    console.log(`Leaves for ${employeeId} in ${month}:`, leaves);

    let paidLeaveDays = 0;
    let unpaidLeaveDays = 0;
    let leaveDetails = [];
    for (const leave of leaves) {
      const start = new Date(
        Math.max(
          new Date(
            leave.start_date instanceof Date
              ? leave.start_date
              : new Date(leave.start_date)
          ),
          effectiveStartDate
        )
      );
      const end = new Date(
        Math.min(
          new Date(
            leave.end_date instanceof Date
              ? leave.end_date
              : new Date(leave.end_date)
          ),
          effectiveEndDate  // FIX: Cap to effectiveEndDate
        )
      );
      let days = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split("T")[0];
        const isHoliday = holidayDates.includes(dateStr);
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
        if (!isHoliday && !isWeekend) {
          days++;
          if (leave.leave_status === "Unpaid") {
            unpaidLeaveDays++;
          } else {
            paidLeaveDays++;
          }
        }
      }
      leaveDetails.push({
        type: leave.leave_type,
        days,
        start_date: leave.start_date instanceof Date
          ? leave.start_date.toISOString().split("T")[0]
          : leave.start_date,
        end_date: leave.end_date instanceof Date
          ? leave.end_date.toISOString().split("T")[0]
          : leave.end_date,
        status: leave.leave_status,
      });
    }

    // Fetch attendance (cap to effectiveEndDate)
    const attendance = await queryAsync(
      `SELECT date 
       FROM attendance 
       WHERE employee_id = ? AND status = 'Approved' 
       AND date BETWEEN ? AND ? 
       AND login_time IS NOT NULL`,
      [employeeId, effectiveStartDate.toISOString().split("T")[0], effectiveEndDateStr]  // FIX: Use effectiveEndDateStr
    );
    const validAttendance = attendance.filter((a) => a.date && (typeof a.date === "string" || a.date instanceof Date));
    if (attendance.length !== validAttendance.length) {
      console.warn(
        `Filtered out ${attendance.length - validAttendance.length} invalid attendance records for ${employeeId}`
      );
    }
    const presentDays = validAttendance.length;
    console.log(`Attendance for ${employeeId} in ${month}:`, validAttendance);

    // Convert attendance dates to string format
    const attendanceDates = validAttendance.map((a) => {
      const date = a.date instanceof Date ? a.date.toISOString().split("T")[0] : a.date;
      if (!date || typeof date !== "string") {
        console.warn(`Invalid date format for attendance record:`, a);
        return null;
      }
      return date;
    }).filter((date) => date !== null);
    console.log(`Processed attendance dates for ${employeeId}:`, attendanceDates);

    // Calculate potential working days (excluding weekends and holidays)
    let potentialWorkingDays = 0;
    for (
      let d = new Date(effectiveStartDate);
      d <= effectiveEndDate;  // FIX: Use effectiveEndDate
      d.setDate(d.getDate() + 1)
    ) {
      const dateStr = d.toISOString().split("T")[0];
      const isHoliday = holidayDates.includes(dateStr);
      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
      if (!isHoliday && !isWeekend) {
        potentialWorkingDays++;
      }
    }

    // Calculate unaccounted days (potential working days with no attendance or leave record)
    // These will be treated as paid week-offs (non-working days, no deduction)
    const accountedWorkingDays = presentDays + paidLeaveDays + unpaidLeaveDays;
    const unaccountedWorkingDays = Math.max(0, potentialWorkingDays - accountedWorkingDays);
    if (unaccountedWorkingDays > 0) {
      console.log(
        `Treating ${unaccountedWorkingDays} unaccounted working days as paid week-offs for ${employeeId} in ${month} (no deduction).`
      );
    }

    // Set total working days to only include accounted working days (present + paid leave + unpaid leave)
    // Unaccounted days are excluded (treated as paid non-working days like week-offs)
    const totalWorkingDays = accountedWorkingDays;

    const result = {
      paidLeaveDays,
      unpaidLeaveDays,
      leaveDetails,
      presentDays,
      holidays: holidayDates.length,
      totalWorkingDays,
    };

    console.log(`Result for ${employeeId}, ${month}:`, result);
    return result;
  } catch (err) {
    console.error(
      `Error in calculateLeaveAndAttendance for ${employeeId}, ${month}:`,
      err.message,
      err.sqlMessage
    );
    throw new Error(
      `Failed to calculate leave and attendance: ${err.sqlMessage || err.message}`
    );
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
    let query = `
      SELECT employee_id, employee_name, department, designation_name, 
             gross_salary, pf_deduction, esic_deduction, tax_deduction, 
             professional_tax, net_salary, status, payment_method, month, payment_date
      FROM payroll`;
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
  const userId = req.user?.employee_id;
  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied" });
  }
  const { month } = req.body;
  try {
    validateMonth(month);
    console.log("Fetching employees...");
    const employees = await queryAsync(
      `SELECT employee_id, full_name, department_name, designation_name, join_date, status, role
       FROM hrms_users
       WHERE role IN ('employee', 'hr', 'dept_head', 'manager') AND status = 'active'`
    );
    if (!employees.length) {
      return res.status(404).json({ error: "No active employees found" });
    }

    console.log("Deleting existing payroll records...");
    await queryAsync("DELETE FROM payroll WHERE month = ?", [month]);
    const payrolls = [];
    const skippedEmployees = [];

    for (const emp of employees) {
      console.log(`Fetching salary structure for ${emp.employee_id}...`);
      const [salaryStructure] = await queryAsync(
        `SELECT basic_salary, hra, special_allowances, bonus, hra_percentage, 
                provident_fund_percentage, provident_fund, esic_percentage, esic, created_at
         FROM employee_salary_structure 
         WHERE employee_id = ?
         ORDER BY created_at DESC LIMIT 1`,
        [emp.employee_id]
      );
      if (!salaryStructure) {
        console.warn(`Skipping employee ${emp.employee_id} due to missing salary structure`);
        skippedEmployees.push({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          reason: 'No salary structure'
        });
        continue;
      }

      if (["employee", "manager"].includes(emp.role) && !emp.join_date) {
        console.warn(`Skipping employee ${emp.employee_id} due to missing join_date`);
        skippedEmployees.push({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          reason: 'Missing join_date'
        });
        continue;
      }

      const [existingPayroll] = await queryAsync(
        `SELECT id FROM payroll WHERE employee_id = ? AND month = ?`,
        [emp.employee_id, month]
      );
      if (existingPayroll) {
        skippedEmployees.push({
          employee_id: emp.employee_id,
          full_name: emp.full_name,
          reason: 'Payroll already exists'
        });
        continue;
      }

      const { paidLeaveDays, unpaidLeaveDays, presentDays, holidays, totalWorkingDays } = await calculateLeaveAndAttendance(emp.employee_id, month);

      const hra = Number(salaryStructure.hra) || (Number(salaryStructure.hra_percentage || 0) * Number(salaryStructure.basic_salary || 0) / 100);
      const gross_salary = Number(salaryStructure.basic_salary || 0) + hra + Number(salaryStructure.special_allowances || 0) + Number(salaryStructure.bonus || 0);

      let adjustedGrossSalary = gross_salary;
      let salaryAdjustment = 0;
      if (totalWorkingDays > 0) {
        const dailyRate = gross_salary / totalWorkingDays;
        salaryAdjustment = unpaidLeaveDays * dailyRate;
        const effectiveWorkingDays = presentDays + paidLeaveDays;
        adjustedGrossSalary = effectiveWorkingDays * dailyRate;
      }

      const pf_deduction = Number(salaryStructure.provident_fund) || Math.min(adjustedGrossSalary * ((Number(salaryStructure.provident_fund_percentage) || 12) / 100), 1800);
      const esic_deduction = Number(salaryStructure.esic) || (adjustedGrossSalary <= 21000 ? adjustedGrossSalary * ((Number(salaryStructure.esic_percentage) || 0.75) / 100) : 0);
      const professional_tax = adjustedGrossSalary <= 15000 ? 0 : 200;
      const tax_deduction = calculateTax(adjustedGrossSalary);

      let net_salary = adjustedGrossSalary - (pf_deduction + esic_deduction + professional_tax + tax_deduction);
      if (!isFinite(net_salary) || isNaN(net_salary)) net_salary = 0;

      const effectiveDays = presentDays + paidLeaveDays;

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
        basic_salary: totalWorkingDays > 0 ? Number(salaryStructure.basic_salary || 0) * effectiveDays / totalWorkingDays : 0,
        hra: totalWorkingDays > 0 ? hra * effectiveDays / totalWorkingDays : 0,
        special_allowances: totalWorkingDays > 0 ? Number(salaryStructure.special_allowances || 0) * effectiveDays / totalWorkingDays : 0,
        bonus: totalWorkingDays > 0 ? Number(salaryStructure.bonus || 0) * effectiveDays / totalWorkingDays : 0,
        net_salary,
        status: userRole === "super_admin" ? "Paid" : "Pending",
        payment_method: "Bank Transfer",
        payment_date: `${month}-01`,
        month,
        created_by: userId,
        company_id: COMPANY_CONFIG.company_id,
        paid_leave_days: paidLeaveDays,
        unpaid_leave_days: unpaidLeaveDays,
        present_days: presentDays,
        holidays: holidays,
        total_working_days: totalWorkingDays,
      };

      try {
        await queryAsync(
          `INSERT INTO payroll (
            employee_id, employee_name, department, designation_name, gross_salary, pf_deduction, esic_deduction,
            professional_tax, tax_deduction, basic_salary, hra, special_allowances, bonus, net_salary, status,
            payment_method, payment_date, month, created_by, company_id, paid_leave_days, unpaid_leave_days,
            present_days, holidays, total_working_days
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            payrollData.employee_id,
            payrollData.employee_name,
            payrollData.department,
            payrollData.designation_name,
            payrollData.gross_salary,
            payrollData.pf_deduction,
            payrollData.esic_deduction,
            payrollData.professional_tax,
            payrollData.tax_deduction,
            payrollData.basic_salary,
            payrollData.hra,
            payrollData.special_allowances,
            payrollData.bonus,
            payrollData.net_salary,
            payrollData.status,
            payrollData.payment_method,
            payrollData.payment_date,
            payrollData.month,
            payrollData.created_by,
            payrollData.company_id,
            payrollData.paid_leave_days,
            payrollData.unpaid_leave_days,
            payrollData.present_days,
            payrollData.holidays,
            payrollData.total_working_days,
          ]
        );
      } catch (insertErr) {
        console.error(`Failed to insert payroll for ${emp.employee_id}:`, insertErr.message, insertErr.sqlMessage);
        throw insertErr;
      }

      if (unpaidLeaveDays > 0 || totalWorkingDays === 0) {
        try {
          await queryAsync(
            "INSERT INTO audit_log (action, employee_id, description, performed_by, created_at) VALUES (?, ?, ?, ?, NOW())",
            [
              totalWorkingDays === 0 ? "NO_SALARY" : "UNPAID_LEAVE_DEDUCTION",
              emp.employee_id,
              totalWorkingDays === 0
                ? `No salary calculated for ${month} due to zero working days`
                : `Deducted ${formatCurrency(salaryAdjustment)} for ${unpaidLeaveDays} unpaid leave days in ${month}`,
              userId || "SYSTEM",
            ]
          );
        } catch (auditErr) {
          console.error(`Failed to insert audit log for ${emp.employee_id}:`, auditErr.message, auditErr.sqlMessage);
          throw auditErr;
        }
      }

      payrolls.push(payrollData);
    }

    if (!payrolls.length) {
      return res.status(400).json({
        error: "No payrolls generated",
        details: "All employees were skipped due to missing salary structures or other issues",
        skippedEmployees
      });
    }

    res.json({
      message: `Payroll generated successfully for ${payrolls.length} employees`,
      data: payrolls,
      skippedEmployees
    });
  } catch (err) {
    console.error("Error generating payroll:", err.message, err.sqlMessage);
    res.status(500).json({
      error: "Failed to generate payroll",
      details: err.sqlMessage || err.message
    });
  }
};

const generatePayrollForEmployee = async (req, res) => {
  const userRole = req.user?.role;
  const userId = req.user?.employee_id;
  const { employeeId, month } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  if (!employeeId || !month) {
    console.error('Missing required fields:', { employeeId, month });
    return res.status(400).json({ error: "Employee ID and month are required" });
  }

  try {
    validateMonth(month);
    console.log(`Received employeeId: "${employeeId}" (length: ${employeeId.length})`);
    console.log(`Fetching employee details for "${employeeId}"...`);
    const [employee] = await queryAsync(
      `SELECT employee_id, full_name, department_name, designation_name, join_date, status, role
       FROM hrms_users
       WHERE employee_id = ?`,
      [employeeId]
    );
    if (!employee) {
      console.error(`Employee "${employeeId}" not found in hrms_users`);
      return res.status(404).json({ error: `Employee ${employeeId} not found` });
    }
    if (employee.status !== "active") {
      console.warn(`Employee "${employeeId}" is not active (status: ${employee.status})`);
      return res.status(400).json({ error: `Employee is not active (status: ${employee.status})` });
    }

    console.log(`Fetching salary structure for "${employeeId}"...`);
    const salaryStructureQuery = `
      SELECT basic_salary, hra, special_allowances, hra_percentage, 
             provident_fund_percentage, provident_fund, esic_percentage, esic, bonus, created_at
      FROM employee_salary_structure 
      WHERE employee_id = ?
      ORDER BY created_at DESC LIMIT 1
    `;
    console.log('Executing salary structure query:', salaryStructureQuery, 'Params:', [employeeId]);
    const [salaryStructure] = await queryAsync(salaryStructureQuery, [employeeId]);
    
    if (!salaryStructure) {
      console.warn(`No salary structure found for "${employeeId}"`);
      const [similarRecords] = await queryAsync(
        `SELECT employee_id FROM employee_salary_structure WHERE employee_id LIKE ?`,
        [`%${employeeId}%`]
      );
      console.log(`Similar employee_ids found:`, similarRecords);
      return res.status(400).json({ 
        error: `No salary structure found for employee ${employeeId}`,
        similarRecords: similarRecords || []
      });
    }
    console.log(`Salary structure for "${employeeId}":`, salaryStructure);

    console.log(`Checking for existing payroll for "${employeeId}", month ${month}...`);
    const [existingPayroll] = await queryAsync(
      `SELECT id FROM payroll WHERE employee_id = ? AND month = ?`,
      [employeeId, month]
    );
    if (existingPayroll) {
      console.warn(`Payroll already exists for "${employeeId}" for ${month}`);
      return res.status(400).json({
        error: `Payroll already exists for ${employeeId} for ${month}`,
      });
    }

    console.log(`Calculating leave and attendance for "${employeeId}", month ${month}...`);
    const { paidLeaveDays, unpaidLeaveDays, presentDays, holidays, totalWorkingDays } = await calculateLeaveAndAttendance(employeeId, month);

    console.log(`Fetching bank details for "${employeeId}"...`);
    const [bankDetails] = await queryAsync(
      `SELECT bank_account_number, ifsc_number FROM bank_details WHERE employee_id = ?`,
      [employeeId]
    );

    // Helper function to parse numbers safely
    const parseNumber = (value, defaultValue = 0) => {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? defaultValue : parsed;
    };

    let payrollData;
    if (totalWorkingDays === 0) {
      console.warn(`No working days for ${employeeId} in ${month}. Generating zero payroll.`);
      payrollData = {
        employee_id: employeeId,
        employee_name: employee.full_name || "Unknown",
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
        special_allowances: 0,
        bonus: 0,
        status: userRole === "super_admin" ? "Paid" : "Pending",
        payment_method: bankDetails ? "Bank Transfer" : "Cash",
        payment_date: new Date(`${month}-01`).toISOString().split("T")[0],
        month,
        created_by: userId || "SYSTEM",
        company_id: COMPANY_CONFIG.company_id,
        paid_leave_days: paidLeaveDays,
        unpaid_leave_days: unpaidLeaveDays,
        present_days: presentDays,
        holidays: holidays,
        total_working_days: totalWorkingDays,
        leave_days: paidLeaveDays + unpaidLeaveDays,
        unpaid_leave_deduction: 0,
      };

      await queryAsync(
        "INSERT INTO audit_log (action, employee_id, description, performed_by, created_at) VALUES (?, ?, ?, ?, NOW())",
        [
          "NO_WORKING_DAYS",
          employeeId,
          `Zero working days for ${employeeId} in ${month}. Payroll generated with zero salary.`,
          userId || "SYSTEM",
        ]
      );
    } else {
      // Parse salary components safely
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
      const adjustedGrossSalary = dailyRate * effectiveWorkingDays;
      const unpaidLeaveDeduction = unpaidLeaveDays * dailyRate;

      const pf_deduction = provident_fund || Math.min(adjustedGrossSalary * provident_fund_percentage, 1800);
      const esic_deduction = esic || (adjustedGrossSalary <= 21000 ? adjustedGrossSalary * esic_percentage : 0);
      const professional_tax = adjustedGrossSalary <= 15000 ? 0 : 200;
      const tax_deduction = calculateTax(adjustedGrossSalary);

      // Log intermediate calculations
      console.log(`Intermediate calculations for ${employeeId}:`, {
        adjustedGrossSalary,
        pf_deduction,
        esic_deduction,
        professional_tax,
        tax_deduction,
        unpaidLeaveDeduction,
        dailyRate,
        effectiveWorkingDays
      });

      const net_salary = Math.max(0, adjustedGrossSalary - (pf_deduction + esic_deduction + professional_tax + tax_deduction));

      if (isNaN(net_salary)) {
        console.error(`Net salary calculation resulted in NaN for ${employeeId}. Forcing net_salary to 0.`, {
          adjustedGrossSalary,
          pf_deduction,
          esic_deduction,
          professional_tax,
          tax_deduction
        });
        throw new Error(`Invalid net salary calculation for ${employeeId}`);
      }

      payrollData = {
        employee_id: employeeId,
        employee_name: employee.full_name || "Unknown",
        department: employee.department_name || "HR",
        designation_name: employee.designation_name || null,
        gross_salary: adjustedGrossSalary,
        net_salary,
        pf_deduction,
        esic_deduction,
        professional_tax,
        tax_deduction,
        basic_salary: totalWorkingDays > 0 ? (basic_salary * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
        hra: totalWorkingDays > 0 ? (hra * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
        special_allowances: totalWorkingDays > 0 ? (special_allowances * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
        bonus: totalWorkingDays > 0 ? (bonus * effectiveWorkingDays / totalWorkingDays) || 0 : 0,
        status: userRole === "super_admin" ? "Paid" : "Pending",
        payment_method: bankDetails ? "Bank Transfer" : "Cash",
        payment_date: new Date(`${month}-01`).toISOString().split("T")[0],
        month,
        created_by: userId || "SYSTEM",
        company_id: COMPANY_CONFIG.company_id,
        paid_leave_days: paidLeaveDays,
        unpaid_leave_days: unpaidLeaveDays,
        present_days: presentDays,
        holidays: holidays,
        total_working_days: totalWorkingDays,
        leave_days: paidLeaveDays + unpaidLeaveDays,
        unpaid_leave_deduction: unpaidLeaveDeduction,
      };

      if (unpaidLeaveDays > 0) {
        await queryAsync(
          "INSERT INTO audit_log (action, employee_id, description, performed_by, created_at) VALUES (?, ?, ?, ?, NOW())",
          [
            "UNPAID_LEAVE_DEDUCTION",
            employeeId,
            `Deducted ${formatCurrency(unpaidLeaveDeduction)} for ${unpaidLeaveDays} unpaid leave days in ${month}`,
            userId || "SYSTEM",
          ]
        );
      }
    }

    console.log(`Inserting payroll for employee "${employeeId}":`, payrollData);
    const query = `
      INSERT INTO payroll (
        employee_id, employee_name, department, designation_name, gross_salary, pf_deduction, esic_deduction,
        professional_tax, tax_deduction, basic_salary, hra, special_allowances, bonus, net_salary, status,
        payment_method, payment_date, month, created_by, company_id, paid_leave_days, unpaid_leave_days,
        present_days, holidays, total_working_days, leave_days, unpaid_leave_deduction
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      payrollData.employee_id,
      payrollData.employee_name,
      payrollData.department,
      payrollData.designation_name || null,
      payrollData.gross_salary,
      payrollData.pf_deduction,
      payrollData.esic_deduction,
      payrollData.professional_tax,
      payrollData.tax_deduction,
      payrollData.basic_salary,
      payrollData.hra,
      payrollData.special_allowances,
      payrollData.bonus,
      payrollData.net_salary,
      payrollData.status,
      payrollData.payment_method,
      payrollData.payment_date,
      payrollData.month,
      payrollData.created_by,
      payrollData.company_id,
      payrollData.paid_leave_days,
      payrollData.unpaid_leave_days,
      payrollData.present_days,
      payrollData.holidays,
      payrollData.total_working_days,
      payrollData.leave_days,
      payrollData.unpaid_leave_deduction,
    ];

    console.log('Executing payroll insert query:', query, 'Values:', values);
    const result = await queryAsync(query, values);

    res.status(201).json({
      message: `Payroll generated successfully for ${employeeId} for ${month}`,
      data: { id: result.insertId, ...payrollData },
    });
  } catch (err) {
    console.error(`Error in generatePayrollForEmployee for "${employeeId}":`, err.message, err.sqlMessage);
    res.status(err.message.includes("No salary structure") ? 400 : 500).json({
      error: `Failed to generate payroll for ${employeeId}`,
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
      SELECT p.employee_id, p.employee_name, p.department, p.designation_name,
             p.gross_salary, p.net_salary, p.status, p.payment_method, p.payment_date,
             p.paid_leave_days, p.unpaid_leave_days, p.present_days, p.holidays, p.total_working_days
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