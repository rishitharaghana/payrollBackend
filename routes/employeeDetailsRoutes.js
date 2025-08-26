const express = require('express');
const { authenticateToken } = require('../middleware/authenticate');
const { createPersonalDetails, createBankDetails, createDocuments, createEducationDetails, previewEmployeeDetails, downloadEmployeeDetailsPDF } = require('../controllers/employeeDetailsController');
const router =  express.Router();

router.post('/employee-details/personal-details', authenticateToken,createPersonalDetails );
router.post('/employee-details/bank-details', authenticateToken, createBankDetails);
router.post('/employee-details/documents', authenticateToken, createDocuments);
router.post('/employee-details/education-detais', authenticateToken, createEducationDetails);
router.get('/employee-details/preview', authenticateToken, previewEmployeeDetails);
router.get('/employee-details/download/:id', authenticateToken, downloadEmployeeDetailsPDF);

module.exports= router;