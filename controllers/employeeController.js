const pool = require("../config/db");
const util = require("util");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const { createMulterInstance } = require("../middleware/upload");

const queryAsync = util.promisify(pool.query).bind(pool);

const uploadDir = path.join(__dirname, "../Uploads");
if (!fs.existsSync(uploadDir)) {
  console.log(`Creating upload directory: ${uploadDir}`);
  fs.mkdirSync(uploadDir, { recursive: true });
}

const allowedTypes = {
  photo: [".jpg", ".jpeg", ".png"],
  document: [".jpg", ".jpeg", ".png", ".pdf"],
};
const upload = createMulterInstance(uploadDir, allowedTypes, {
  fileSize: 5 * 1024 * 1024,
});

const generateEmployeeId = async () => {
  const prefix = "MO-EMP-";
  const [lastEmployee] = await queryAsync(
    `SELECT employee_id FROM hrms_users WHERE employee_id LIKE ? 
     ORDER BY CAST(SUBSTRING(employee_id, LENGTH(?) + 1) AS UNSIGNED) DESC LIMIT 1`,
    [`${prefix}%`, prefix]
  );
  return lastEmployee
    ? `${prefix}${String(
        parseInt(lastEmployee.employee_id.replace(prefix, "")) + 1
      ).padStart(3, "0")}`
    : `${prefix}001`;
};

const createEmployee = async (req, res) => {
  upload.fields([{ name: "photo", maxCount: 1 }])(req, res, async (err) => {
    if (err) {
      console.error("Multer error:", err.message, err.code);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Photo size exceeds 5MB limit" });
      }
      if (err.message.includes("Invalid file type")) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }

    console.log("Request body:", req.body);
    console.log("Request files:", req.files);

    const userRole = req.user.role;
    const {
      name,
      email,
      mobile,
      emergency_phone,
      address,
      department_name,
      designation_name,
      employment_type,
      basic_salary,
      allowances,
      bonuses,
      join_date,
      role = "employee",
      blood_group,
      dob,
      gender,
      password = "defaultPass123",
    } = req.body;
    const photo = req.files?.["photo"]?.[0];

    if (!photo) {
      console.error("No photo uploaded");
      return res.status(400).json({ error: "Photo is required" });
    }

    // ✅ Role validation using ENUM values
    const validRoles = ["super_admin", "hr", "dept_head", "manager", "employee"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role specified" });
    }

    // ✅ Permission checks
    if (!["super_admin", "hr"].includes(userRole)) {
      return res.status(403).json({ error: "Access denied: Insufficient permissions" });
    }
    if (userRole === "hr" && (role === "super_admin" || role === "hr")) {
      return res.status(403).json({ error: "HR cannot create HR-level roles" });
    }

    if (!name?.trim() || !email?.trim() || !mobile?.trim()) {
      return res.status(400).json({ error: "Name, email, and mobile are required" });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (emergency_phone && emergency_phone.trim() === mobile.trim()) {
      return res.status(400).json({
        error: "Mobile and emergency contact numbers cannot be the same",
      });
    }
    if (dob && isNaN(Date.parse(dob))) {
      return res.status(400).json({ error: "Invalid date of birth" });
    }
    if (join_date && isNaN(Date.parse(join_date))) {
      return res.status(400).json({ error: "Invalid join date" });
    }
    if (["employee", "manager"].includes(role) && !join_date) {
      return res.status(400).json({ error: "Join date is required for this role" });
    }

    const validBloodGroups = ["A+ve", "A-ve", "B+ve", "B-ve", "AB+ve", "AB-ve", "O+ve", "O-ve"];
    if (blood_group && !validBloodGroups.includes(blood_group)) {
      return res.status(400).json({ error: "Invalid blood group" });
    }

    const validGenders = ["Male", "Female", "Others"];
    if (gender && !validGenders.includes(gender)) {
      return res.status(400).json({ error: "Invalid gender" });
    }

    if (["dept_head", "employee", "manager"].includes(role)) {
      if (!department_name || !designation_name) {
        return res.status(400).json({ error: "Department and designation are required" });
      }
      const [designation] = await queryAsync(
        "SELECT * FROM designations WHERE department_name = ? AND designation_name = ?",
        [department_name, designation_name]
      );
      if (!designation) {
        return res.status(400).json({ error: "Invalid department or designation" });
      }
    }

    if (["employee", "hr", "dept_head", "manager"].includes(role)) {
      if (isNaN(basic_salary) || basic_salary < 0 || isNaN(allowances) || allowances < 0) {
        return res.status(400).json({ error: "Valid basic salary and allowances are required" });
      }
    }

    try {
      const [existingMobile] = await queryAsync(
        `SELECT mobile FROM hrms_users WHERE TRIM(mobile) = ?`,
        [mobile.trim()]
      );
      if (existingMobile) {
        return res.status(400).json({ error: "Mobile number already in use" });
      }
      const [existingEmail] = await queryAsync(
        `SELECT email FROM hrms_users WHERE TRIM(LOWER(email)) = ?`,
        [email.trim().toLowerCase()]
      );
      if (existingEmail) {
        return res.status(400).json({ error: "Email already in use" });
      }

      const employeeId = await generateEmployeeId();
      const hashedPassword = await bcrypt.hash(password, 10);
const baseUrl = process.env.UPLOADS_BASE_URL || `${req.protocol}://${req.get("host")}/uploads/`;
const photo_url = photo ? `${baseUrl}${photo.filename}` : null;

      // Verify file exists
      if (photo && !fs.existsSync(photo.path)) {
        return res.status(500).json({ error: "Failed to save uploaded photo" });
      }
      const query = `INSERT INTO hrms_users (
        employee_id, full_name, email, mobile, emergency_phone, address, password, 
        department_name, designation_name, employment_type, basic_salary, allowances, 
        bonuses, join_date, is_temporary_password, blood_group, dob, gender, photo_url, role, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const values = [
        employeeId,
        name,
        email,
        mobile,
        emergency_phone || null,
        address || null,
        hashedPassword,
        department_name || null,
        designation_name || null,
        employment_type || null,
        basic_salary || 0,
        allowances || 0,
        bonuses || 0,
        join_date || null,
        true,
        blood_group || null,
        dob || null,
        gender || null,
        photo_url,
        role,
        'active',
      ];

      console.log("Insert query:", query);
      console.log("Insert values:", values);

      const result = await queryAsync(query, values);

      // Allocate leaves
      if (["employee", "hr", "dept_head", "manager"].includes(role)) {
        try {
          const { allocateMonthlyLeaves } = require("./leaveController");
          await allocateMonthlyLeaves({ user: req.user }); // Pass actual user context
          console.log(`Initial leave allocation completed for employee ${employeeId}`);
        } catch (err) {
          console.error(`Failed to allocate initial leave for employee ${employeeId}:`, err.message);
        }
      }

      // Fetch inserted record
      const [insertedRecord] = await queryAsync(
        `SELECT dob, join_date FROM hrms_users WHERE employee_id = ?`,
        [employeeId]
      );

      res.status(201).json({
        message: `${role} created successfully`,
        data: {
          id: result.insertId,
          employee_id: employeeId,
          name,
          email,
          mobile,
          role,
          is_temporary_password: true,
          basic_salary,
          allowances,
          bonuses,
          blood_group: blood_group || null,
          dob: insertedRecord?.dob || null,
          gender: gender || null,
          join_date: insertedRecord?.join_date || null,
          photo_url,
          ...(role === "dept_head" || role === "manager" || role === "employee"
            ? { department_name, designation_name }
            : {}),
          ...(role === "employee" ? { employment_type, join_date } : {}),
        },
      });
    } catch (err) {
      console.error("DB error:", err.message, err.sqlMessage, err.code);
      res.status(500).json({ error: `Database error: ${err.message}` });
    }
  });
};

const updateEmployee = async (req, res) => {
  upload.fields([{ name: "photo", maxCount: 1 }])(req, res, async (err) => {
    if (err) {
      console.error("Multer error:", err.message, err.code);
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ error: "Photo size exceeds 5MB limit" });
      }
      if (err.message.includes("Invalid file type")) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: `File upload error: ${err.message}` });
    }

    const userRole = req.user.role;
    const { id } = req.params;
    const {
      name,
      email,
      mobile,
      emergency_phone,
      address,
      role,
      blood_group,
      gender,
    } = req.body;
    const photo = req.files?.["photo"]?.[0];

    // Validate role exists
    const [roleExists] = await queryAsync(
      "SELECT role_id, isHRRole FROM roles WHERE role_id = ?",
      [role]
    );
    if (!roleExists) {
      return res.status(400).json({ error: "Invalid role specified" });
    }

    // Permission checks
    const [currentUserRole] = await queryAsync(
      "SELECT isHRRole FROM roles WHERE role_id = ?",
      [userRole]
    );
    if (!currentUserRole) {
      return res.status(403).json({ error: "Invalid user role" });
    }
    if (!["super_admin"].includes(userRole) && !currentUserRole.isHRRole && userRole !== role) {
      return res.status(403).json({
        error: "Access denied: Insufficient permissions to update this record",
      });
    }
    if (userRole === "hr" && roleExists.isHRRole) {
      return res.status(403).json({ error: "HR cannot update HR-level roles" });
    }

    // Input validations
    if (!name?.trim() || !email?.trim() || !mobile?.trim() || !role) {
      return res.status(400).json({
        error: "Name, email, mobile, and role are required for update",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    if (emergency_phone && emergency_phone.trim() === mobile.trim()) {
      return res.status(400).json({
        error: "Mobile and emergency contact numbers cannot be the same",
      });
    }

    const validBloodGroups = ["A+ve", "A-ve", "B+ve", "B-ve", "AB+ve", "AB-ve", "O+ve", "O-ve"];
    if (blood_group && !validBloodGroups.includes(blood_group)) {
      return res.status(400).json({ error: "Invalid blood group" });
    }

    const validGenders = ["Male", "Female", "Others"];
    if (gender && !validGenders.includes(gender)) {
      return res.status(400).json({ error: "Invalid gender" });
    }

    try {
      const [existingRecord] = await queryAsync(
        `SELECT * FROM hrms_users WHERE id = ?`,
        [id]
      );
      if (!existingRecord) {
        return res.status(404).json({ error: "Employee record not found" });
      }

      // Check if role is being changed
      if (existingRecord.role !== role) {
        if (!["super_admin"].includes(userRole)) {
          return res.status(403).json({ error: "Only super admins can change roles" });
        }
        if (userRole === "hr" && roleExists.isHRRole) {
          return res.status(403).json({ error: "HR cannot assign HR-level roles" });
        }
      }

      // Check for email and mobile conflicts
      const [emailCheck] = await queryAsync(
        `SELECT * FROM hrms_users WHERE email = ? AND id != ?`,
        [email, id]
      );
      if (emailCheck) {
        return res.status(400).json({ error: "Email is already in use by another record" });
      }
      const [mobileCheck] = await queryAsync(
        `SELECT mobile FROM hrms_users WHERE TRIM(mobile) = ? AND id != ?`,
        [mobile.trim(), id]
      );
      if (mobileCheck) {
        return res.status(400).json({ error: "Mobile number already in use" });
      }

      // Handle photo upload
      const baseUrl = process.env.UPLOADS_BASE_URL || "http://localhost:3007/uploads/";
      let photo_url = existingRecord.photo_url;
      if (photo) {
        if (!fs.existsSync(photo.path)) {
          return res.status(500).json({ error: "Failed to save uploaded photo" });
        }
        photo_url = `${baseUrl}${path.basename(photo.path)}`;
      } else if (req.body.photo === "null") {
        photo_url = null;
      }

      // Update employee
      const query = `UPDATE hrms_users SET 
        full_name = ?, email = ?, mobile = ?, emergency_phone = ?, address = ?, 
        blood_group = ?, gender = ?, photo_url = ?, role = ? 
        WHERE id = ?`;
      const values = [
        name,
        email,
        mobile,
        emergency_phone || null,
        address || null,
        blood_group || null,
        gender || null,
        photo_url,
        role,
        id,
      ];

      const result = await queryAsync(query, values);
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: "Employee record not found for update" });
      }

      res.json({
        message: `${role} updated successfully`,
        data: {
          id,
          role,
          name,
          email,
          mobile,
          emergency_phone,
          address,
          blood_group,
          gender,
          photo_url,
        },
      });
    } catch (err) {
      console.error("DB error:", err.message, err.sqlMessage, err.code);
      res.status(500).json({ error: `Database error: ${err.message}` });
    }
  });
};

const createEmployeePersonalDetails = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  const {
    employeeId = req.user.employee_id,
    fullName,
    email,
    phone,
    fatherName,
    motherName,
    gender,
    alternatePhone,
    presentAddress,
    previousAddress,
    positionType,
    employerIdName,
    positionTitle,
    employmentType,
    joiningDate,
    contractEndDate,
    pan_number,
    adhar_number,
    password = "defaultPass123",
  } = req.body;

  if (
    !["super_admin", "hr", "employee"].includes(userRole) ||
    (userRole !== "super_admin" && employeeId !== userId)
  ) {
    return res.status(403).json({
      error: "Access denied: You can only add your own personal details",
    });
  }

  if (
    !fullName?.trim() ||
    !email?.trim() ||
    !phone?.trim() ||
    !gender ||
    !employeeId
  ) {
    return res.status(400).json({
      error: "Full name, email, phone, gender, and employee ID are required",
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Invalid email format" });
  }

  if (!/^[0-9]{10}$/.test(phone)) {
    return res.status(400).json({ error: "Phone must be a 10-digit number" });
  }

  try {
    const [user] = await queryAsync(
      `SELECT employee_id, full_name, email, mobile FROM hrms_users WHERE employee_id = ? AND role IN ('hr', 'employee')`,
      [employeeId]
    );
    if (!user) {
      return res.status(404).json({ error: `${userRole} not found` });
    }

    if (
      userRole !== "super_admin" &&
      (fullName !== user.full_name ||
        email !== user.email ||
        phone !== user.mobile)
    ) {
      return res.status(400).json({
        error: `Full name, email, and phone must match your ${userRole} record`,
      });
    }

    const [existingDetails] = await queryAsync(
      `SELECT employee_id FROM personal_details WHERE employee_id = ?`,
      [employeeId]
    );
    if (existingDetails) {
      return res
        .status(400)
        .json({ error: "Personal details already exist for this employee" });
    }

    const [existingMobile] = await queryAsync(
      `SELECT mobile FROM hrms_users WHERE TRIM(mobile) = ? AND employee_id != ?`,
      [phone.trim(), employeeId]
    );
    if (existingMobile) {
      return res.status(400).json({ error: "Phone number already in use" });
    }

    const [existingEmail] = await queryAsync(
      `SELECT email FROM hrms_users WHERE TRIM(LOWER(email)) = ? AND employee_id != ?`,
      [email.trim().toLowerCase(), employeeId]
    );
    if (existingEmail) {
      return res.status(400).json({ error: "Email already in use" });
    }

    let finalEmployeeId = employeeId;
    if (userRole === "super_admin" && !user) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const employeeQuery = `
        INSERT INTO hrms_users (employee_id, full_name, email, mobile, password, role, is_temporary_password)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      const employeeValues = [
        employeeId,
        fullName,
        email,
        phone,
        hashedPassword,
        userRole === "hr" ? "hr" : "employee",
        true,
      ];
      await queryAsync(employeeQuery, employeeValues);
    }

    const personalQuery = `
      INSERT INTO personal_details (
        employee_id, full_name, father_name, mother_name, phone, alternate_phone, email, gender,
        present_address, previous_address, position_type, employer_id_name, position_title,
        employment_type, joining_date, pan_number, adhar_number, contract_end_date, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const personalValues = [
      finalEmployeeId,
      user.full_name,
      fatherName || null,
      motherName || null,
      user.mobile,
      alternatePhone || null,
      user.email,
      gender,
      presentAddress || null,
      previousAddress || null,
      positionType || null,
      employerIdName || null,
      positionTitle || null,
      employmentType || null,
      joiningDate || null,
      pan_number || null,
      adhar_number || null,
      contractEndDate || null,
      userId || null,
    ];

    const personalResult = await queryAsync(personalQuery, personalValues);

    res.status(201).json({
      message: "Personal details created successfully",
      data: { id: personalResult.insertId, employee_id: finalEmployeeId },
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const createEducationDetails = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  let {
    employeeId,
    tenthClassName,
    tenthClassMarks,
    intermediateName,
    intermediateMarks,
    graduationName,
    graduationMarks,
    postgraduationName,
    postgraduationMarks,
  } = req.body;

  if (!employeeId) {
    employeeId = userId;
  }

  const normalizedBodyId = employeeId?.trim().toUpperCase();
  const normalizedUserId = userId?.trim().toUpperCase();

  if (!["super_admin", "hr", "employee"].includes(userRole)) {
    return res
      .status(403)
      .json({ error: "Access denied: Insufficient permissions" });
  }
  if (userRole !== "super_admin" && normalizedBodyId !== normalizedUserId) {
    return res.status(403).json({
      error: "Access denied: You can only add your own education details",
    });
  }

  const numericFields = [
    { name: "tenthClassMarks", value: tenthClassMarks },
    { name: "intermediateMarks", value: intermediateMarks },
    { name: "graduationMarks", value: graduationMarks },
    { name: "postgraduationMarks", value: postgraduationMarks },
  ];
  for (const field of numericFields) {
    if (
      field.value &&
      (isNaN(field.value) ||
        Number(field.value) < 0 ||
        Number(field.value) > 100)
    ) {
      return res.status(400).json({
        error: `Invalid ${field.name} (must be a number between 0 and 100)`,
      });
    }
  }

  try {
    const [employee] = await queryAsync(
      `SELECT employee_id FROM hrms_users WHERE UPPER(TRIM(employee_id)) = ? AND role IN ('hr', 'employee')`,
      [normalizedBodyId]
    );
    if (!employee) {
      return res.status(404).json({ error: `${userRole} not found` });
    }

    const [existingDetails] = await queryAsync(
      `SELECT employee_id FROM education_details WHERE UPPER(TRIM(employee_id)) = ?`,
      [normalizedBodyId]
    );
    if (existingDetails) {
      return res
        .status(400)
        .json({ error: "Education details already exist for this employee" });
    }

    const query = `
      INSERT INTO education_details (
        employee_id, tenth_class_name, tenth_class_marks, intermediate_name,
        intermediate_marks, graduation_name, graduation_marks, postgraduation_name,
        postgraduation_marks, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const values = [
      normalizedBodyId,
      tenthClassName || null,
      tenthClassMarks || null,
      intermediateName || null,
      intermediateMarks || null,
      graduationName || null,
      graduationMarks || null,
      postgraduationName || null,
      postgraduationMarks || null,
      userId,
    ];

    const result = await queryAsync(query, values);

    res.status(201).json({
      message: "Education details created successfully",
      data: { id: result.insertId, employee_id: normalizedBodyId },
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const createDocuments = async (req, res) => {
  upload.fields([{ name: "document", maxCount: 1 }])(req, res, async (err) => {
    if (err) {
      return res
        .status(400)
        .json({ error: "File upload error: " + err.message });
    }

    const userRole = req.user.role;
    const userId = req.user.employee_id;
    let { employeeId, documentType } = req.body;
    const document = req.files?.["document"]?.[0];

    // Permission check
    if (!["super_admin", "hr", "employee"].includes(userRole)) {
      return res
        .status(403)
        .json({ error: "Access denied: Insufficient permissions" });
    }
    if (userRole !== "super_admin") {
      employeeId = userId;
    }

    // Validation
    if (!employeeId || !documentType || !document) {
      return res
        .status(400)
        .json({ error: "Employee ID, document type, and file are required" });
    }

    documentType = documentType.toLowerCase();

    const allowedTypes = [
      "tenth_class",
      "intermediate",
      "graduation",
      "postgraduation",
      "aadhar",
      "pan",
    ];
    if (!allowedTypes.includes(documentType)) {
      return res.status(400).json({ error: "Invalid document type" });
    }

    try {
      const [employee] = await queryAsync(
        `SELECT employee_id FROM hrms_users WHERE employee_id = ? AND role IN ('hr', 'employee')`,
        [employeeId]
      );
      if (!employee) {
        return res.status(404).json({ error: `${userRole} not found` });
      }

      // Save file to uploads
      const baseUrl = "http://localhost:3007/uploads/";
      const fileExtension = path.extname(document.originalname).toLowerCase();
      const timestamp = Date.now();
      const safeFileName = `${employeeId}_${documentType}_${timestamp}${fileExtension}`;
      const uploadDir = path.join(__dirname, "../Uploads");
      const finalPath = path.join(uploadDir, safeFileName);

      fs.renameSync(document.path, finalPath);

      const fileName = safeFileName;

      const columnMap = {
        tenth_class: "tenth_class_doc_path",
        intermediate: "intermediate_doc_path",
        graduation: "graduation_doc_path",
        postgraduation: "postgraduation_doc_path",
        aadhar: "aadhar_doc_path",
        pan: "pan_doc_path",
      };
      const columnName = columnMap[documentType];

      const createdBy = userId;

      const query = `
        INSERT INTO documents (employee_id, ${columnName}, document_type, created_by)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE ${columnName} = VALUES(${columnName})
      `;
      const values = [employeeId, fileName, documentType, createdBy];

      const result = await queryAsync(query, values);

      res.status(201).json({
        message: "Document uploaded successfully",
        data: {
          employee_id: employeeId,
          document_type: documentType,
          file_path: `${baseUrl}${fileName}`,
        },
      });
    } catch (err) {
      console.error("DB error:", err.message, err.sqlMessage, err.code);
      res.status(500).json({ error: `Database error: ${err.message}` });
    }
  });
};

const createBankDetails = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  const {
    employeeId = req.user.employee_id,
    bankAccountNumber,
    ifscCode,
  } = req.body;

  if (!["super_admin", "hr", "employee"].includes(userRole)) {
    return res
      .status(403)
      .json({ error: "Access denied: Insufficient permissions" });
  }

  if (userRole !== "super_admin" && employeeId !== userId) {
    return res
      .status(403)
      .json({ error: "Access denied: You can only add your own bank details" });
  }

  if (!employeeId || !bankAccountNumber || !ifscCode) {
    return res.status(400).json({
      error: "Employee ID, bank account number, and IFSC code are required",
    });
  }

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
    return res.status(400).json({ error: "Invalid IFSC code format" });
  }

  try {
    const [employee] = await queryAsync(
      `SELECT employee_id, full_name FROM hrms_users WHERE employee_id = ? AND role IN ('hr', 'employee')`,
      [employeeId]
    );
    if (!employee) {
      return res.status(404).json({ error: `${userRole} not found` });
    }

    const [existingBank] = await queryAsync(
      `SELECT employee_id FROM bank_details WHERE employee_id = ?`,
      [employeeId]
    );
    if (existingBank) {
      return res
        .status(400)
        .json({ error: "Bank details already exist for this employee" });
    }

    const insertQuery = `
      INSERT INTO bank_details (employee_id, bank_account_number, ifsc_number, created_by)
      VALUES (?, ?, ?, ?)
    `;
    const values = [employeeId, bankAccountNumber, ifscCode, userId];

    const result = await queryAsync(insertQuery, values);

    res.status(201).json({
      message: "Bank details created successfully",
      data: { id: result.insertId, employee_id: employeeId },
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: `Database error: ${err.message}` });
  }
};

const fetchEmployees = async (req, res) => {
  try {
    const userRole = req.user.role;
    if (!["super_admin", "hr"].includes(userRole)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const baseUrl =
      process.env.UPLOADS_BASE_URL || "http://localhost:3007/uploads/";
    const employees = await queryAsync(
      `SELECT id, employee_id, full_name, email, mobile, department_name, designation_name, address, employment_type, basic_salary, allowances, join_date, dob, blood_group, gender, emergency_phone, role,
              photo_url
       FROM hrms_users WHERE role IN ('dept_head', 'manager', 'employee')`,
      [baseUrl]
    );

    res.json({ message: "Employees fetched successfully", data: employees });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error" });
  }
};

const getEmployeeById = async (req, res) => {
  const userRole = req.user.role;
  const { id } = req.params;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res
      .status(403)
      .json({ error: "Access denied: Insufficient permissions" });
  }

  try {
    const baseUrl =
      process.env.UPLOADS_BASE_URL || "http://localhost:3007/uploads/";
    const [employee] = await queryAsync(
      `SELECT id, employee_id, full_name, email, mobile, department_name, designation_name, employment_type, basic_salary, allowances, join_date, blood_group, gender, dob,
              CASE WHEN photo_url IS NOT NULL THEN CONCAT(?, photo_url) ELSE NULL END as photo_url,
              role
       FROM hrms_users WHERE id = ?`,
      [baseUrl, id]
    );

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    res.json({ message: "Employee fetched successfully", data: employee });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error" });
  }
};

const deleteEmployee = async (req, res) => {
  const userRole = req.user.role;
  const { id } = req.params;
  const { role, exitType, reason, noticeStartDate, lastWorkingDate, restrictLeaves, exitChecklist } = req.body;

  if (!['super_admin', 'hr'].includes(userRole)) {
    return res.status(403).json({ error: 'Access denied: Insufficient permissions' });
  }
  if (userRole === 'hr' && role === 'hr') {
    return res.status(403).json({ error: 'HR cannot terminate HR accounts' });
  }
  if (!role || !exitType) {
    return res.status(400).json({ error: 'Role and exit type are required' });
  }
  if (exitType === 'resignation' && (!noticeStartDate || !lastWorkingDate)) {
    return res.status(400).json({ error: 'Notice start and last working dates are required for resignation' });
  }

  try {
    await queryAsync('START TRANSACTION');

    const [existingRecord] = await queryAsync(
      `SELECT employee_id, photo_url, join_date, status FROM hrms_users WHERE id = ? AND role = ?`,
      [id, role]
    );
    if (!existingRecord) {
      await queryAsync('ROLLBACK');
      return res.status(404).json({ error: `${role} record not found` });
    }
    if (existingRecord.status !== 'active') {
      await queryAsync('ROLLBACK');
      return res.status(400).json({ error: 'Only active employees can be terminated' });
    }

    // Check dependencies
    const relatedTables = [
      { table: 'payroll', column: 'employee_id' },
      { table: 'personal_details', column: 'employee_id' },
      { table: 'bank_details', column: 'employee_id' },
      { table: 'education_details', column: 'employee_id' },
      { table: 'documents', column: 'employee_id' },
    ];
    for (const { table, column } of relatedTables) {
      const [records] = await queryAsync(
        `SELECT ${column} FROM ${table} WHERE ${column} = ?`,
        [existingRecord.employee_id]
      );
      if (records) {
        await queryAsync('ROLLBACK');
        return res.status(400).json({
          error: `Cannot terminate employee with records in ${table}. Archive or resolve dependencies.`,
        });
      }
    }

    // Update status based on exit type
    const status = exitType === 'resignation' ? 'serving_notice' : exitType === 'absconding' ? 'absconded' : 'inactive';
    await queryAsync(
      `UPDATE hrms_users SET 
        status = ?, 
        exit_date = ?, 
        termination_reason = ?, 
        notice_start_date = ?, 
        last_working_date = ?, 
        restrict_leaves = ?,
        exit_checklist = ? 
        WHERE id = ? AND role = ?`,
      [
        status,
        exitType === 'resignation' ? null : new Date(),
        reason || null,
        noticeStartDate || null,
        lastWorkingDate || null,
        restrictLeaves || false,
        JSON.stringify(exitChecklist) || null,
        id,
        role,
      ]
    );

    // Log action
    await queryAsync(
      `INSERT INTO audit_logs (action, employee_id, performed_by, details, performed_at) VALUES (?, ?, ?, ?, ?)`,
      [`TERMINATE_EMPLOYEE_${exitType.toUpperCase()}`, existingRecord.employee_id, req.user.employee_id, reason || 'No reason provided', new Date()]
    );

    // Update leave restrictions
    if (restrictLeaves && exitType === 'resignation') {
      await queryAsync(
        `UPDATE leave_balances SET leave_application_allowed = false WHERE employee_id = ?`,
        [existingRecord.employee_id]
      );
    }

    await queryAsync('COMMIT');

    // Notify stakeholders
    const { sendNotification } = require('./notificationService');
    await sendNotification({
      to: 'it@company.com,finance@company.com',
      subject: `Employee ${exitType.charAt(0).toUpperCase() + exitType.slice(1)}`,
      message: `Employee ${existingRecord.employee_id} marked as ${status} by ${req.user.employee_id}. Reason: ${reason || 'None'}.`,
    });

    res.json({ message: `${role} marked as ${status} successfully`, status });
  } catch (err) {
    await queryAsync('ROLLBACK');
    console.error('DB error:', err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: 'Database error during operation' });
  }
};


const getCurrentUserProfile = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;

  try {
    const query = `
      SELECT employee_id, full_name, email, mobile, emergency_phone, department_name, designation_name, blood_group, gender, dob,
             photo_url
      FROM hrms_users 
      WHERE employee_id = ? AND role = ?
    `;

    const [user] = await queryAsync(query, [userId, userRole]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      message: "User profile fetched successfully",
      data: {
        employee_id: user.employee_id,
        full_name: user.full_name,
        email: user.email,
        mobile: user.mobile,
        emergency_phone: user.emergency_phone,
        designation_name: user.designation_name,
        department_name: user.department_name,
        blood_group: user.blood_group,
        gender: user.gender,
        dob: user.dob,
        photo_url: user.photo_url,
      },
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error" });
  }
};

const getEmployeeProgress = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;
  const employeeId = req.params.employeeId || userId;

  if (!["super_admin", "hr", "employee"].includes(userRole)) {
    return res
      .status(403)
      .json({ error: "Access denied: Insufficient permissions" });
  }

  if (userRole === "employee" && employeeId !== userId) {
    return res
      .status(403)
      .json({ error: "Access denied: You can only view your own progress" });
  }

  if (userRole === "hr" && employeeId !== userId) {
    const [hrCheck] = await queryAsync(
      `SELECT employee_id FROM hrms_users WHERE employee_id = ? AND role = 'hr'`,
      [employeeId]
    );
    if (hrCheck) {
      return res
        .status(403)
        .json({
          error: "Access denied: HR cannot view other HR users' progress",
        });
    }
  }

  try {
    const [user] = await queryAsync(
      `SELECT employee_id FROM hrms_users WHERE employee_id = ?`,
      [employeeId]
    );

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const [personalDetails] = await queryAsync(
      `SELECT employee_id FROM personal_details WHERE employee_id = ?`,
      [employeeId]
    );
    const [educationDetails] = await queryAsync(
      `SELECT employee_id FROM education_details WHERE employee_id = ?`,
      [employeeId]
    );
    const [bankDetails] = await queryAsync(
      `SELECT employee_id FROM bank_details WHERE employee_id = ?`,
      [employeeId]
    );
    const [documents] = await queryAsync(
      `SELECT employee_id FROM documents WHERE employee_id = ?`,
      [employeeId]
    );

    const progress = {
      personalDetails: !!personalDetails,
      educationDetails: !!educationDetails,
      bankDetails: !!bankDetails,
      documents: !!documents,
    };

    res.json({
      message: "Progress fetched successfully",
      data: progress,
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error" });
  }
};

const getEmployeePersonalDetails = async (req, res) => {
  const userRole = req.user.role;
  const { employeeId } = req.params;

  if (userRole !== "super_admin") {
    return res
      .status(403)
      .json({
        error: "Access denied: Only super_admins can view personal details",
      });
  }

  try {
    const [user] = await queryAsync(
      `SELECT employee_id FROM hrms_users WHERE employee_id = ?`,
      [employeeId]
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const [personalDetails] = await queryAsync(
      `SELECT employee_id, full_name, father_name, mother_name, phone, alternate_phone, email, gender,
              present_address, previous_address, position_type, employer_id_name, position_title,
              employment_type, joining_date, contract_end_date
       FROM personal_details WHERE employee_id = ?`,
      [employeeId]
    );

    if (!personalDetails) {
      return res.status(404).json({ error: "Personal details not found" });
    }

    res.json({
      message: "Personal details fetched successfully",
      data: personalDetails,
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error" });
  }
};

const getEmployeeEducationDetails = async (req, res) => {
  const userRole = req.user.role;
  const { employeeId } = req.params;

  if (userRole !== "super_admin") {
    return res
      .status(403)
      .json({
        error: "Access denied: Only super_admins can view education details",
      });
  }

  try {
    const [user] = await queryAsync(
      `SELECT employee_id FROM hrms_users WHERE employee_id = ?`,
      [employeeId]
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const [educationDetails] = await queryAsync(
      `SELECT employee_id, tenth_class_name, tenth_class_marks, intermediate_name,
              intermediate_marks, graduation_name, graduation_marks, postgraduation_name,
              postgraduation_marks
       FROM education_details WHERE employee_id = ?`,
      [employeeId]
    );

    if (!educationDetails) {
      return res.status(404).json({ error: "Education details not found" });
    }

    res.json({
      message: "Education details fetched successfully",
      data: educationDetails,
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error" });
  }
};

const getEmployeeDocuments = async (req, res) => {
  const userRole = req.user.role;
  const { employeeId } = req.params;

  if (userRole !== "super_admin") {
    return res
      .status(403)
      .json({ error: "Access denied: Only super_admins can view documents" });
  }

  try {
    const [user] = await queryAsync(
      `SELECT employee_id FROM hrms_users WHERE employee_id = ?`,
      [employeeId]
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const documents = await queryAsync(
      `SELECT id, employee_id, document_type, file_path, file_type
       FROM documents WHERE employee_id = ?`,
      [employeeId]
    );

    res.json({
      message: "Documents fetched successfully",
      data: documents,
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error" });
  }
};

const getEmployeeBankDetails = async (req, res) => {
  const userRole = req.user.role;
  const { employeeId } = req.params;

  if (userRole !== "super_admin") {
    return res
      .status(403)
      .json({
        error: "Access denied: Only super_admins can view bank details",
      });
  }

  try {
    const [user] = await queryAsync(
      `SELECT employee_id FROM hrms_users WHERE employee_id = ?`,
      [employeeId]
    );
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const [bankDetails] = await queryAsync(
      `SELECT employee_id, bank_account_number, ifsc_number
       FROM bank_details WHERE employee_id = ?`,
      [employeeId]
    );

    if (!bankDetails) {
      return res.status(404).json({ error: "Bank details not found" });
    }

    res.json({
      message: "Bank details fetched successfully",
      data: bankDetails,
    });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error" });
  }
};

module.exports = {
  createEmployee,
  createEmployeePersonalDetails,
  createEducationDetails,
  createDocuments,
  createBankDetails,
  updateEmployee,
  fetchEmployees,
  deleteEmployee,
  getCurrentUserProfile,
  getEmployeeProgress,
  getEmployeeById,
  getEmployeePersonalDetails,
  getEmployeeEducationDetails,
  getEmployeeDocuments,
  getEmployeeBankDetails,
};