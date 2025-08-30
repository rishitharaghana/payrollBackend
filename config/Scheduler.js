
const cron = require("node-cron");
const { allocateMonthlyLeaves } = require("../controllers/leaveController");

cron.schedule(
  "0 0 1 * *",
  async () => {
    console.log("Running monthly leave allocation...");
    await allocateMonthlyLeaves();
  },
  {
    timezone: "Asia/Kolkata",
  }
);

console.log("Cron scheduler initialized");

module.exports = { startScheduler: () => {} };