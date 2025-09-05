const pool = require("../config/db");
const util = require("util");

const queryAsync = util.promisify(pool.query).bind(pool);

const getCompanyDetails = async (req, res) => {
  try {
    const [company] = await queryAsync("SELECT name, pan, gstin, logo_url AS logo FROM company WHERE id = ?", [1]);
    if (!company) {
      return res.status(404).json({ error: "Company details not found" });
    }
    res.json({ data: company });
  } catch (err) {
    console.error("Error fetching company details:", err);
    res.status(500).json({ error: "Failed to fetch company details", details: err.message });
  }
};
module.exports = {getCompanyDetails}