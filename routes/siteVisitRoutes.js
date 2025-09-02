const express = require('express');
const { authenticateToken } = require('../middleware/authenticate');
const { startSiteVisit, endSiteVisit, fetchActiveSiteVisits, getSiteVisitHistory } = require('../controllers/siteVisitController');
const router = express.Router();

router.post('/employees/site-visit/start', authenticateToken, startSiteVisit);
router.post('/employees/site-visit/end', authenticateToken, endSiteVisit);
router.get('/employees/site-visit/active', authenticateToken, fetchActiveSiteVisits);
router.get('/employees/site-visit/history', authenticateToken, getSiteVisitHistory)

module.exports = router;
