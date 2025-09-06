// const util = require('util');
// const pool = require('../config/db');
// const { getLeaveBalances: getCoreLeaveBalances, getLeaves } = require('./leaveController');

// const queryAsync = util.promisify(pool.query).bind(pool);

// const getLeaveBalances = async (req, res) => {
//   const { employeeId } = req.query;
//   const { role, employee_id } = req.user;

//   try {
//     if (role === 'employee' && employeeId !== employee_id) {
//       return res.status(403).json({ error: 'Access denied: You can only view your own leave balances' });
//     }

//     // Reuse leaveController's getLeaveBalances
//     const leaveBalances = await getCoreLeaveBalances({ user: { employee_id: employeeId } });
    
//     // Format for dashboard UI
//     const formattedBalances = leaveBalances.data.map((leave) => ({
//       type: leave.leave_type,
//       remaining: leave.balance,
//       total: leave.leave_type === 'vacation' ? 20 : leave.leave_type === 'sick' ? 10 : leave.leave_type === 'casual' ? 5 : leave.leave_type === 'maternity' ? 90 : 15,
//       icon: ['vacation', 'maternity'].includes(leave.leave_type) ? 'Calendar' : leave.leave_type === 'sick' ? 'FileText' : 'Users',
//       color: `bg-gradient-to-r from-teal-${leave.leave_type === 'vacation' ? '500' : leave.leave_type === 'sick' ? '600' : leave.leave_type === 'casual' ? '700' : '400'} to-slate-${leave.leave_type === 'vacation' ? '600' : leave.leave_type === 'sick' ? '700' : leave.leave_type === 'casual' ? '800' : '500'}`,
//       bgColor: 'bg-white/90 backdrop-blur-sm',
//       textColor: 'text-teal-800',
//     }));

//     res.json({
//       message: 'Leave balances fetched successfully',
//       data: formattedBalances,
//     });
//   } catch (error) {
//     console.error('Error fetching leave balances:', error.message);
//     res.status(500).json({ error: 'Failed to fetch leave balances', details: error.message });
//   }
// };

// const getLeaveRequests = async (req, res) => {
//   const { employeeId, fromDate, toDate } = req.query;
//   const { role, employee_id } = req.user;

//   try {
//     if (role === 'employee' && employeeId !== employee_id) {
//       return res.status(403).json({ error: 'Access denied: You can only view your own leave requests' });
//     }

//     // Reuse leaveController's getLeaves
//     const leaveRequests = await getLeaves({ user: { employee_id: employeeId } });

//     // Filter by date range if provided
//     let filteredRequests = leaveRequests;
//     if (fromDate && toDate) {
//       filteredRequests = leaveRequests.filter(
//         (req) => new Date(req.start_date) >= new Date(fromDate) && new Date(req.end_date) <= new Date(toDate)
//       );
//     }

//     // Format for dashboard UI
//     const formattedRequests = filteredRequests.map((req) => ({
//       id: req.id,
//       type: req.leave_type,
//       from: req.start_date,
//       to: req.end_date,
//       days: req.total_days,
//       status: req.status,
//       details: req.reason || 'No details provided',
//     }));

//     res.json({
//       message: 'Leave requests fetched successfully',
//       data: formattedRequests,
//     });
//   } catch (error) {
//     console.error('Error fetching leave requests:', error.message);
//     res.status(500).json({ error: 'Failed to fetch leave requests', details: error.message });
//   }
// };

// const getAttendance = async (req, res) => {
//   const { employeeId, date } = req.query;
//   const { role, employee_id } = req.user;

//   try {
//     if (role === 'employee' && employeeId !== employee_id) {
//       return res.status(403).json({ error: 'Access denied: You can only view your own attendance' });
//     }

//     // Fetch today's attendance
//     const today = date || new Date().toISOString().split('T')[0];
//     const [todayAttendance] = await queryAsync(
//       'SELECT status, updated_at FROM attendance WHERE employee_id = ? AND date = ?',
//       [employeeId, today]
//     );

//     // Fetch recent attendance (last 7 days)
//     const recentAttendance = await queryAsync(
//       'SELECT date, status, time_in, time_out FROM attendance WHERE employee_id = ? AND date >= DATE_SUB(?, INTERVAL 7 DAY) ORDER BY date DESC LIMIT 5',
//       [employeeId, today]
//     );

//     res.json({
//       message: 'Attendance fetched successfully',
//       data: {
//         today: {
//           today: todayAttendance?.status || 'N/A',
//           lastUpdated: todayAttendance?.updated_at
//             ? new Intl.DateTimeFormat('en-US', {
//                 dateStyle: 'short',
//                 timeStyle: 'short',
//                 timeZone: 'Asia/Kolkata',
//               }).format(new Date(todayAttendance.updated_at))
//             : 'N/A',
//         },
//         recent: recentAttendance.map((record) => ({
//           date: record.date,
//           status: record.status,
//           timeIn: record.time_in
//             ? new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(
//                 new Date(`1970-01-01T${record.time_in}`)
//               )
//             : '-',
//           timeOut: record.time_out
//             ? new Intl.DateTimeFormat('en-US', { timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(
//                 new Date(`1970-01-01T${record.time_out}`)
//               )
//             : '-',
//         })),
//       },
//     });
//   } catch (error) {
//     console.error('Error fetching attendance:', error.message);
//     res.status(500).json({ error: 'Failed to fetch attendance', details: error.message });
//   }
// };

// module.exports = { getLeaveBalances, getLeaveRequests, getAttendance }; 