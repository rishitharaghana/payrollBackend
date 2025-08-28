const pool = require('../config/db');
const util = require('util');
const PDFDocument = require('pdfkit');
const queryAsync = util.promisify(pool.query).bind(pool);

const createPersonalDetails = async (req, res) => {
  const userRole = req.user.role;
  const userId = String(req.user.id); // Convert to string
  const {
    employee_id,
    full_name,
    father_name,
    mother_name,
    phone,
    email,
    gender,
    present_address,
    previous_address,
    position_type,
    employer_id_name,
    position_title,
    employment_type,
    joining_date,
    contract_end_date,
  } = req.body;


  // Convert employee_id to string
  const employeeIdStr = String(employee_id);

  // Validate employee_id
  if (!employee_id || employeeIdStr === 'undefined' || !employeeIdStr.trim()) {
    return res.status(400).json({ error: 'employee_id is required and must be a non-empty string' });
  }

  // Allow super_admin, hr, or employee (if employee_id matches userId)
  if (!['super_admin', 'hr'].includes(userRole) && (userRole === 'employee' && userId !== employeeIdStr)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  // Validate string fields
  const stringFields = {
    employee_id: employeeIdStr,
    full_name,
    father_name,
    mother_name,
    phone,
    email,
    present_address,
  };
  for (const [key, value] of Object.entries(stringFields)) {
    if (!value || typeof value !== 'string' || !value.trim()) {
      return res.status(400).json({ error: `${key} is required and must be a non-empty string` });
    }
  }

  // Validate non-string fields
  if (!gender || !['male', 'female', 'other'].includes(gender)) {
    return res.status(400).json({ error: 'Gender is required and must be male, female, or other' });
  }
  if (!position_type || !['fresher', 'experienced'].includes(position_type)) {
    return res.status(400).json({ error: 'Position type is required and must be fresher or experienced' });
  }

  if (position_type === 'experienced') {
    if (!employer_id_name || !position_title || !employment_type || !joining_date) {
      return res.status(400).json({ error: 'All experienced fields are required' });
    }
    if (!['full-time', 'part-time', 'internship', 'contract'].includes(employment_type)) {
      return res.status(400).json({ error: 'Invalid employment type' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joining_date)) {
      return res.status(400).json({ error: 'Invalid joining date format. Use YYYY-MM-DD' });
    }
    if (contract_end_date && !/^\d{4}-\d{2}-\d{2}$/.test(contract_end_date)) {
      return res.status(400).json({ error: 'Invalid contract end date format. Use YYYY-MM-DD' });
    }
  }

  try {
    const [existingEmployee] = await queryAsync(
      `SELECT employee_id FROM (
        SELECT employee_id FROM employees WHERE employee_id = ?
        UNION
        SELECT employee_id FROM hrs WHERE employee_id = ?
        UNION
        SELECT employee_id FROM dept_heads WHERE employee_id = ?
        UNION
        SELECT employee_id FROM hrms_users WHERE employee_id = ?
      ) AS all_users`,
      [employeeIdStr, employeeIdStr, employeeIdStr, employeeIdStr]
    );
    if (!existingEmployee) {
      return res.status(404).json({ error: 'Employee ID not found in user records' });
    }

    const [existingPersonalDetails] = await queryAsync(
      'SELECT * FROM personal_details WHERE employee_id = ?',
      [employeeIdStr]
    );
    if (existingPersonalDetails) {
      return res.status(400).json({ error: 'Personal details already exist for this employee' });
    }

    const result = await queryAsync(
      `INSERT INTO personal_details 
      (employee_id, full_name, father_name, mother_name, phone, email, gender, present_address, previous_address, 
       position_type, employer_id_name, position_title, employment_type, joining_date, contract_end_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employeeIdStr,
        full_name.trim(),
        father_name.trim(),
        mother_name.trim(),
        phone.trim(),
        email.trim(),
        gender,
        present_address.trim(),
        previous_address?.trim() || null,
        position_type,
        employer_id_name?.trim() || null,
        position_title?.trim() || null,
        employment_type || null,
        joining_date || null,
        contract_end_date || null,
        req.user.username || req.user.email || req.user.mobile,
      ]
    );
    res.status(201).json({
      message: 'Personal details created successfully',
      data: { id: result.insertId, employee_id: employeeIdStr, created_by: req.user.username || req.user.email || req.user.mobile },
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
const createEducationDetails = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const {
    employee_id,
    tenth_class_name,
    tenth_class_marks,
    intermediate_name,
    intermediate_marks,
    graduation_name,
    graduation_marks,
    postgraduation_name,
    postgraduation_marks,
  } = req.body;

  if (!['super_admin', 'hr'].includes(userRole) && (userRole === 'employee' && userId !== employee_id)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  const requiredFields = { employee_id };
  for (const [key, value] of Object.entries(requiredFields)) {
    if (!value?.trim()) {
      return res.status(400).json({ error: `${key} is required` });
    }
  }

  const numericFields = {
    tenth_class_marks,
    intermediate_marks,
    graduation_marks,
    postgraduation_marks,
  };
  for (const [key, value] of Object.entries(numericFields)) {
    if (value && (isNaN(value) || Number(value) < 0 || Number(value) > 100)) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }

  try {
    const [employee] = await queryAsync('SELECT * FROM personal_details WHERE employee_id = ?', [
      employee_id,
    ]);
    if (!employee) {
      return res.status(404).json({ error: 'Personal details not found for this employee' });
    }

    const [existingEducationDetails] = await queryAsync(
      'SELECT * FROM education_details WHERE employee_id = ?',
      [employee_id]
    );
    if (existingEducationDetails) {
      return res.status(400).json({ error: 'Education details already exist for this employee' });
    }

    const result = await queryAsync(
      `INSERT INTO education_details 
      (employee_id, tenth_class_name, tenth_class_marks, intermediate_name, intermediate_marks, 
       graduation_name, graduation_marks, postgraduation_name, postgraduation_marks, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id.trim(),
        tenth_class_name?.trim() || null,
        tenth_class_marks || null,
        intermediate_name?.trim() || null,
        intermediate_marks || null,
        graduation_name?.trim() || null,
        graduation_marks || null,
        postgraduation_name?.trim() || null,
        postgraduation_marks || null,
        req.user.username,
      ]
    );
    res.status(201).json({
      message: 'Education details created successfully',
      data: { id: result.insertId, employee_id, created_by: req.user.username },
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
const createDocuments = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const { employee_id } = req.body;

  if (!['super_admin', 'hr'].includes(userRole) && (userRole === 'employee' && userId !== employee_id)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  if (!employee_id?.trim()) {
    return res.status(400).json({ error: 'employee_id is required' });
  }

  try {
    const [employee] = await queryAsync('SELECT * FROM personal_details WHERE employee_id = ?', [
      employee_id,
    ]);
    if (!employee) {
      return res.status(404).json({ error: 'Personal details not found for this employee' });
    }

    const [existingDocuments] = await queryAsync(
      'SELECT * FROM documents WHERE employee_id = ?',
      [employee_id]
    );
    if (existingDocuments) {
      return res.status(400).json({ error: 'Documents already uploaded for this employee' });
    }

    const files = req.files;
    const result = await queryAsync(
      `INSERT INTO documents 
      (employee_id, tenth_class_doc_path, intermediate_doc_path, graduation_doc_path, 
       postgraduation_doc_path, aadhar_doc_path, pan_doc_path, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id.trim(),
        files.tenth_class_doc ? files.tenth_class_doc[0].path : null,
        files.intermediate_doc ? files.intermediate_doc[0].path : null,
        files.graduation_doc ? files.graduation_doc[0].path : null,
        files.postgraduation_doc ? files.postgraduation_doc[0].path : null,
        files.aadhar_doc ? files.aadhar_doc[0].path : null,
        files.pan_doc ? files.pan_doc[0].path : null,
        req.user.username,
      ]
    );
    res.status(201).json({
      message: 'Documents uploaded successfully',
      data: {
        id: result.insertId,
        employee_id,
        files: Object.keys(files).reduce((acc, key) => {
          acc[key] = files[key][0].path;
          return acc;
        }, {}),
        created_by: req.user.username,
      },
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
const createBankDetails = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const { employee_id, bank_account_number, ifsc_number } = req.body;

  if (!['super_admin', 'hr'].includes(userRole) && (userRole === 'employee' && userId !== employee_id)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  const requiredFields = { employee_id, bank_account_number, ifsc_number };
  for (const [key, value] of Object.entries(requiredFields)) {
    if (!value?.trim()) {
      return res.status(400).json({ error: `${key} is required` });
    }
  }

  try {
    const [employee] = await queryAsync('SELECT * FROM personal_details WHERE employee_id = ?', [
      employee_id,
    ]);
    if (!employee) {
      return res.status(404).json({ error: 'Personal details not found for this employee' });
    }

    const [existingBankDetails] = await queryAsync(
      'SELECT * FROM bank_details WHERE employee_id = ?',
      [employee_id]
    );
    if (existingBankDetails) {
      return res.status(400).json({ error: 'Bank details already exist for this employee' });
    }

    const result = await queryAsync(
      `INSERT INTO bank_details 
      (employee_id, bank_account_number, ifsc_number, created_by)
      VALUES (?, ?, ?, ?)`,
      [
        employee_id.trim(),
        bank_account_number.trim(),
        ifsc_number.trim(),
        req.user.username,
      ]
    );
    res.status(201).json({
      message: 'Bank details created successfully',
      data: { id: result.insertId, employee_id, created_by: req.user.username },
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
const previewEmployeeDetails = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const { employee_id } = req.params;

  if (!['super_admin', 'hr'].includes(userRole) && (userRole === 'employee' && userId !== employee_id)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  try {
    const [personalDetails] = await queryAsync(
      'SELECT * FROM personal_details WHERE employee_id = ?',
      [employee_id]
    );
    if (!personalDetails) {
      return res.status(404).json({ error: 'Personal details not found for this employee' });
    }

    const [educationDetails] = await queryAsync(
      'SELECT * FROM education_details WHERE employee_id = ?',
      [employee_id]
    );
    const [documents] = await queryAsync('SELECT * FROM documents WHERE employee_id = ?', [
      employee_id,
    ]);
    const [bankDetails] = await queryAsync('SELECT * FROM bank_details WHERE employee_id = ?', [
      employee_id,
    ]);

    res.json({
      message: 'Employee details fetched successfully',
      data: {
        personal_details: personalDetails || {},
        education_details: educationDetails || {},
        documents: documents || {},
        bank_details: bankDetails || {},
      },
    });
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
};
const downloadEmployeeDetailsPDF = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.id;
  const { employee_id } = req.params;

  if (!['super_admin', 'hr'].includes(userRole) && (userRole === 'employee' && userId !== employee_id)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }

  try {
    const [personalDetails] = await queryAsync(
      'SELECT * FROM personal_details WHERE employee_id = ?',
      [employee_id]
    );
    if (!personalDetails) {
      return res.status(404).json({ error: 'Personal details not found for this employee' });
    }

    const [educationDetails] = await queryAsync(
      'SELECT * FROM education_details WHERE employee_id = ?',
      [employee_id]
    );
    const [documents] = await queryAsync('SELECT * FROM documents WHERE employee_id = ?', [
      employee_id,
    ]);
    const [bankDetails] = await queryAsync('SELECT * FROM bank_details WHERE employee_id = ?', [
      employee_id,
    ]);

    const doc = new PDFDocument({ margin: 50 });
    const fileName = `Employee_Details_${employee_id}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    doc.pipe(res);

    doc.fontSize(20).font('Helvetica-Bold').text(`Employee Details - ${employee_id}`, 50, 50, {
      align: 'center',
    });
    doc.moveDown(2).lineTo(50, doc.y).lineTo(550, doc.y).stroke();

    doc.moveDown(2).fontSize(14).font('Helvetica-Bold').text('Personal Details');
    doc.moveDown(0.5).fontSize(12).font('Helvetica');
    const personal = personalDetails || {};
    doc.text(`Full Name: ${personal.full_name || 'N/A'}`);
    doc.text(`Father's Name: ${personal.father_name || 'N/A'}`);
    doc.text(`Mother's Name: ${personal.mother_name || 'N/A'}`);
    doc.text(`Phone: ${personal.phone || 'N/A'}`);
    doc.text(`Email: ${personal.email || 'N/A'}`);
    doc.text(`Gender: ${personal.gender || 'N/A'}`);
    doc.text(`Present Address: ${personal.present_address || 'N/A'}`);
    doc.text(`Previous Address: ${personal.previous_address || 'N/A'}`);
    doc.text(`Position Type: ${personal.position_type || 'N/A'}`);
    if (personal.position_type === 'experienced') {
      doc.text(`Employer ID/Name: ${personal.employer_id_name || 'N/A'}`);
      doc.text(`Position Title: ${personal.position_title || 'N/A'}`);
      doc.text(`Employment Type: ${personal.employment_type || 'N/A'}`);
      doc.text(`Joining Date: ${personal.joining_date || 'N/A'}`);
      doc.text(`Contract End Date: ${personal.contract_end_date || 'N/A'}`);
    }

    doc.moveDown(2).fontSize(14).font('Helvetica-Bold').text('Education Details');
    doc.moveDown(0.5).fontSize(12).font('Helvetica');
    const education = educationDetails || {};
    doc.text(`10th Class Name: ${education.tenth_class_name || 'N/A'}`);
    doc.text(
      `10th Class Marks: ${education.tenth_class_marks ? `${education.tenth_class_marks}%` : 'N/A'}`
    );
    doc.text(`Intermediate Name: ${education.intermediate_name || 'N/A'}`);
    doc.text(
      `Intermediate Marks: ${
        education.intermediate_marks ? `${education.intermediate_marks}%` : 'N/A'
      }`
    );
    doc.text(`Graduation Name: ${education.graduation_name || 'N/A'}`);
    doc.text(
      `Graduation Marks: ${education.graduation_marks ? `${education.graduation_marks}%` : 'N/A'}`
    );
    doc.text(`Postgraduation Name: ${education.postgraduation_name || 'N/A'}`);
    doc.text(
      `Postgraduation Marks: ${
        education.postgraduation_marks ? `${education.postgraduation_marks}%` : 'N/A'
      }`
    );

    doc.moveDown(2).fontSize(14).font('Helvetica-Bold').text('Documents');
    doc.moveDown(0.5).fontSize(12).font('Helvetica');
    const docs = documents || {};
    doc.text(`10th Class Document: ${docs.tenth_class_doc_path ? 'Uploaded' : 'N/A'}`);
    doc.text(`Intermediate Document: ${docs.intermediate_doc_path ? 'Uploaded' : 'N/A'}`);
    doc.text(`Graduation Document: ${docs.graduation_doc_path ? 'Uploaded' : 'N/A'}`);
    doc.text(`Postgraduation Document: ${docs.postgraduation_doc_path ? 'Uploaded' : 'N/A'}`);
    doc.text(`Aadhar Document: ${docs.aadhar_doc_path ? 'Uploaded' : 'N/A'}`);
    doc.text(`PAN Document: ${docs.pan_doc_path ? 'Uploaded' : 'N/A'}`);

    doc.moveDown(2).fontSize(14).font('Helvetica-Bold').text('Bank Details');
    doc.moveDown(0.5).fontSize(12).font('Helvetica');
    const bank = bankDetails || {};
    doc.text(`Bank Account Number: ${bank.bank_account_number || 'N/A'}`);
    doc.text(`IFSC Number: ${bank.ifsc_number || 'N/A'}`);

    doc.moveDown(2).fontSize(10).font('Helvetica-Oblique').text(`Generated by: ${req.user.username}`);
    doc.end();
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

module.exports = {
  createPersonalDetails,
  createEducationDetails,
  createDocuments,
  createBankDetails,
  previewEmployeeDetails,
  downloadEmployeeDetailsPDF,
};