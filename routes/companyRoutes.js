const express = require("express");
const { authenticateToken } = require("../middleware/authenticate");
const { getCompanyDetails } = require("../controllers/companyController");
const router = express.Router();


router.get("/company", authenticateToken, getCompanyDetails);

module.exports = router;