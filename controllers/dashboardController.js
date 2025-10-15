const pool = require('../config/db');
const util = require('util');

const formatCurrency = (value) => {
  return `₹${(parseFloat(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const queryAsync = util.promisify(pool.query).bind(pool);

const quickActionsByRole = {
  super_admin: [
    { title: 'Manage Employees', icon: 'Users', link: '/admin/employees' },
    { title: 'Approve Leaves', icon: 'Calendar', link: '/admin/leave-approvals' },
    { title: 'Payroll Overview', icon: 'CreditCard', link: '/admin/payroll' },
    { title: 'Generate Payroll', icon: 'FileText', link: '/admin/generate-payroll' },
    { title: 'Download Payroll PDF', icon: 'Download', link: '/admin/download-payroll' },
  ],
  hr: [
    { title: 'Manage Employees', icon: 'Users', link: '/admin/employees' },
    { title: 'Approve Leaves', icon: 'Calendar', link: '/admin/leave-approvals' },
    { title: 'Payroll', icon: 'CreditCard', link: '/admin/payroll' },
    { title: 'Generate Payroll', icon: 'FileText', link: '/admin/generate-payroll' },
  ],
  dept_head: [
    { title: 'Team Attendance', icon: 'Clock', link: '/admin/team-attendance' },
    { title: 'Team Performance', icon: 'Users', link: '/admin/team-performance' },
    { title: 'Leave Approvals', icon: 'Calendar', link: '/admin/leave-approvals' },
  ],
};

const getDashboardData = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  const { role } = req.params;
  const { start_date, end_date } = req.query;

  if (!['super_admin', 'hr', 'dept_head'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }
  if (!['super_admin', 'hr', 'dept_head'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (userRole === 'hr' && role === 'super_admin') {
    return res.status(403).json({ error: 'HR cannot access super_admin dashboard' });
  }
  if (userRole === 'dept_head' && role !== 'dept_head') {
    return res.status(403).json({ error: 'Department heads can only access their own dashboard' });
  }

  let departmentName = null;
  if (role === 'dept_head') {
    const [deptHead] = await queryAsync(
      'SELECT department_name FROM hrms_users WHERE employee_id = ? AND role = "dept_head"',
      [userId]
    );
    if (!deptHead) {
      return res.status(403).json({ error: 'Not a department head' });
    }
    departmentName = deptHead.department_name;
  }

  try {
    const dashboardData = {
      stats: [],
      quickActions: quickActionsByRole[role] || [],
      recentActivities: [],
      performanceMetrics: [],
      leaveBalances: {},
    };

    // === Build Stats Query Dynamically ===
    let employeeFilterClause = ''; // For total_employees and payroll
    let attendanceFilterClause = ''; // For present_today (optional join filter)
    let attendanceRateFilterClause = ''; // For attendance rate
    let statsParams = [];

    const isOrgWide = role === 'super_admin' || role === 'hr';

       if (isOrgWide) {
     
      employeeFilterClause = `WHERE role != 'super_admin'`;
      attendanceRateFilterClause = `WHERE role != 'super_admin'`;
    } else if (role === 'dept_head') {
      employeeFilterClause = `WHERE department_name = ? AND role != 'super_admin'`;
      attendanceFilterClause = `JOIN hrms_users u2 ON a.employee_id = u2.employee_id WHERE u2.department_name = ? AND u2.role != 'super_admin'`;
      attendanceRateFilterClause = `WHERE department_name = ? AND role != 'super_admin'`;
      statsParams = [departmentName];
    }
    let pendingLeavesClause, pendingLeavesParams;
    if (isOrgWide) {
      pendingLeavesClause = `WHERE l.status = 'Pending'`;
      pendingLeavesParams = [];
    } else {
      pendingLeavesClause = `WHERE l.status = 'Pending' AND lr.recipient_id = ?`;
      pendingLeavesParams = [userId];
    }

    const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM hrms_users ${employeeFilterClause}) as total_employees,
        (SELECT COUNT(DISTINCT a.employee_id) FROM attendance a
         ${attendanceFilterClause}
         WHERE DATE(a.created_at) = CURDATE() AND a.status = 'Approved') as present_today,
        (SELECT COALESCE(SUM(
          COALESCE(ess.basic_salary, 0) + COALESCE(ess.hra, 0) + COALESCE(ess.special_allowances, 0) + COALESCE(ess.bonus, 0)
        ), 0) 
         FROM employee_salary_structure ess
         JOIN hrms_users u ON ess.employee_id = u.employee_id
         ${employeeFilterClause}) as monthly_payroll,
        (SELECT COUNT(*) FROM leaves l 
         JOIN leave_recipients lr ON l.id = lr.leave_id 
         ${pendingLeavesClause}) as pending_leaves
    `;
    const fullStatsParams = [...statsParams, ...pendingLeavesParams];
    console.log('Executing statsQuery:', statsQuery, 'with params:', fullStatsParams); // Debug log
    const [stats] = await queryAsync(statsQuery, fullStatsParams);
    console.log('Stats results:', stats); // Debug log

    dashboardData.stats = [
      { title: 'Total Employees', value: stats.total_employees.toString(), change: '0%', icon: 'Users' },
      { title: 'Present Today', value: stats.present_today.toString(), change: '0%', icon: 'Clock' },
      { title: 'Monthly Payroll', value: formatCurrency(stats.monthly_payroll || 0), change: '0%', icon: 'CreditCard' },
      { title: 'Pending Leaves', value: stats.pending_leaves.toString(), change: '0%', icon: 'Calendar' },
    ];

    // === Recent Activities ===
    let activitiesQuery, activitiesParams;
    if (isOrgWide) {
      activitiesQuery = `
        SELECT 'Attendance' as type, u.full_name as name, a.created_at as time, 'Clock' as icon
        FROM attendance a
        JOIN hrms_users u ON a.employee_id = u.employee_id
        WHERE a.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        UNION
        SELECT 'Leave Applied' as type, u.full_name as name, l.created_at as time, 'Calendar' as icon
        FROM leaves l
        JOIN hrms_users u ON l.employee_id = u.employee_id
        WHERE l.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        ORDER BY time DESC LIMIT 5
      `;
      activitiesParams = [];
    } else {
      activitiesQuery = `
        SELECT 'Attendance' as type, u.full_name as name, a.created_at as time, 'Clock' as icon
        FROM attendance a
        JOIN hrms_users u ON a.employee_id = u.employee_id
        WHERE a.recipient = ? AND a.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        UNION
        SELECT 'Leave Applied' as type, u.full_name as name, l.created_at as time, 'Calendar' as icon
        FROM leaves l
        JOIN hrms_users u ON l.employee_id = u.employee_id
        JOIN leave_recipients lr ON l.id = lr.leave_id
        WHERE lr.recipient_id = ? AND l.created_at >= DATE_SUB(NOW(), INTERVAL 1 WEEK)
        ORDER BY time DESC LIMIT 5
      `;
      activitiesParams = [userId, userId];
    }
    console.log('Executing activitiesQuery:', activitiesQuery, 'with params:', activitiesParams);
    const activities = await queryAsync(activitiesQuery, activitiesParams);
    dashboardData.recentActivities = activities.map((a) => ({
      type: a.type,
      name: a.name,
      time: a.time.toISOString(), // ISO for reliable frontend parsing
      icon: a.icon,
    }));

    // === Attendance Rate (Performance Metric) ===
    let attendanceRateQuery = `
      SELECT COALESCE(AVG(CASE WHEN a.status = 'Approved' THEN 1 ELSE 0 END) * 100, 0) as rate
      FROM attendance a
      JOIN hrms_users u ON a.employee_id = u.employee_id
      ${attendanceRateFilterClause ? `${attendanceRateFilterClause}` : 'WHERE u.role IN (\'dept_head\', \'manager\', \'employee\')'}
      ${start_date && end_date ? ' AND a.created_at BETWEEN ? AND ?' : ''}
    `;
    let attendanceRateParams = start_date && end_date ? [start_date, end_date] : [];
    if (role === 'dept_head') {
      attendanceRateParams = [departmentName, ...(start_date && end_date ? [start_date, end_date] : [])];
    }
    const [attendanceRate] = await queryAsync(attendanceRateQuery, attendanceRateParams);
    const attendanceRateValue = Number(attendanceRate?.rate) || 0;

    dashboardData.performanceMetrics = [
      { 
        title: 'Attendance Rate', 
        value: `${attendanceRateValue.toFixed(0)}%`, 
        description: 'This month' 
      },
    ];

    // === Leave Balances ===
    let leaveBalancesQuery, leaveBalancesParams;
    if (isOrgWide) {
      leaveBalancesQuery = `
        SELECT leave_type, SUM(balance) as balance 
        FROM leave_balances 
        WHERE year = ? 
        GROUP BY leave_type
      `;
      leaveBalancesParams = [new Date().getFullYear()];
    } else {
      leaveBalancesQuery = `
        SELECT leave_type, balance 
        FROM leave_balances 
        WHERE employee_id = ? AND year = ?
      `;
      leaveBalancesParams = [userId, new Date().getFullYear()];
    }
    const leaveBalancesRaw = await queryAsync(leaveBalancesQuery, leaveBalancesParams);
    dashboardData.leaveBalances = leaveBalancesRaw.reduce((acc, b) => ({
      ...acc,
      [b.leave_type]: b.balance,
    }), {});

    // If you want to include leave balances in performanceMetrics too (optional):
    // dashboardData.performanceMetrics = [
    //   ...dashboardData.performanceMetrics,
    //   ...leaveBalancesRaw.map(b => ({
    //     title: `${b.leave_type.charAt(0).toUpperCase() + b.leave_type.slice(1)} Leave Balance`,
    //     value: `${b.balance} days`,
    //     description: `Available for ${new Date().getFullYear()}`,
    //   }))
    // ];

    res.json(dashboardData);
  } catch (err) {
    console.error('DB error in getDashboardData:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: 'Database error', details: err.sqlMessage || err.message });
  }
};

module.exports = { getDashboardData };