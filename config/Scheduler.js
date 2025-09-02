const cron = require('node-cron');
const pool = require('../config/db');
const util = require('util');
const queryAsync = util.promisify(pool.query).bind(pool);
const { allocateMonthlyLeaves } = require('../controllers/leaveController');
const { processSiteVisitPayroll } = require('../controllers/siteVisitController');

// Monthly leave allocation at midnight on the 1st of each month
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

// Daily payroll processing for site visits at midnight
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

console.log('Cron scheduler initialized');

module.exports = { startScheduler: () => {} };