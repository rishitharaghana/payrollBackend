const cron = require('node-cron');
const pool = require('../config/db');
const util = require('util');
const queryAsync = util.promisify(pool.query).bind(pool);
const { allocateMonthlyLeaves } = require('../controllers/leaveController');
const { processSiteVisitPayroll } = require('../controllers/siteVisitController');

cron.schedule(
  '0 0 1 * *',
  async () => {
    console.log('Running monthly leave allocation...');
    try {
      await allocateMonthlyLeaves();
      console.log('Monthly leave allocation completed');
    } catch (err) {
      console.error('Leave allocation cron error:', err.message);
    }
  },
  {
    timezone: 'Asia/Kolkata',
  }
);

cron.schedule(
  '0 0 * * *',
  async () => {
    console.log('Processing site visit data for payroll...');
    try {
      await processSiteVisitPayroll();
      console.log('Site visit payroll processing completed');
    } catch (err) {
      console.error('Payroll cron error:', err.message);
    }
  },
  {
    timezone: 'Asia/Kolkata',
  }
);

cron.schedule('0 0 1 * *', async () => {
  console.log('Running monthly location logs cleanup...');
  try {
    await queryAsync(
      'DELETE FROM location_logs WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );
    console.log('Old location logs deleted successfully');
  } catch (err) {
    console.error('Cleanup cron error:', err.message);
  }
}, { timezone: 'Asia/Kolkata' });

cron.schedule('0 0 1 * *', async () => {
  console.log('Running monthly location logs cleanup...');
  try {
    
    const retentionYears = 7;
    await queryAsync(
      `DELETE FROM location_logs 
       WHERE timestamp < DATE_SUB(NOW(), INTERVAL 30 DAY)
       AND employee_id IN (SELECT employee_id FROM hrms_users WHERE status = 'active')
       OR timestamp < DATE_SUB(NOW(), INTERVAL ? YEAR)
       AND employee_id IN (SELECT employee_id FROM hrms_users WHERE status = 'inactive')`,
      [retentionYears]
    );
    await queryAsync(
      `INSERT INTO audit_log (action, details, performed_at) VALUES (?, ?, ?)`,
      ["CLEANUP_LOCATION_LOGS", "Deleted old location logs", new Date()]
    );
    console.log('Old location logs deleted successfully');
  } catch (err) {
    console.error('Cleanup cron error:', err.message);
  }
}, { timezone: 'Asia/Kolkata' });

console.log('Cron scheduler initialized');

module.exports = { startScheduler: () => {} };