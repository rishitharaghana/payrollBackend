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
    `SELECT employee_id FROM (
      SELECT employee_id FROM employees WHERE employee_id LIKE ?
      UNION
      SELECT employee_id FROM hrs WHERE employee_id LIKE ?
      UNION
      SELECT employee_id FROM dept_heads WHERE employee_id LIKE ?
      UNION
      SELECT employee_id FROM managers WHERE employee_id LIKE ?
      UNION
      SELECT employee_id FROM hrms_users WHERE employee_id LIKE ?
    ) AS all_employees ORDER BY CAST(SUBSTRING(employee_id, LENGTH(?) + 1) AS UNSIGNED) DESC LIMIT 1`,
    [
      `${prefix}%`,
      `${prefix}%`,
      `${prefix}%`,
      `${prefix}%`,
      `${prefix}%`,
      prefix,
    ]
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
      return res
        .status(400)
        .json({ error: `File upload error: ${err.message}` });
    }

    console.log("Request body:", req.body); // Debug log
    console.log("Request files:", req.files); // Debug log

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
      password = "defaultPass123",
    } = req.body;
    const photo = req.files?.["photo"]?.[0];

    if (!photo) {
      console.error("No photo uploaded");
      return res.status(400).json({ error: "Photo is required" });
    }

    if (!["super_admin", "hr"].includes(userRole)) {
      return res
        .status(403)
        .json({ error: "Access denied: Insufficient permissions" });
    }
    if (userRole === "hr" && role === "hr") {
      return res.status(403).json({ error: "HR cannot create HR accounts" });
    }

    if (!name?.trim() || !email?.trim() || !mobile?.trim()) {
      return res
        .status(400)
        .json({ error: "Name, email, and mobile are required" });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (emergency_phone && emergency_phone.trim() === mobile.trim()) {
      return res
        .status(400)
        .json({
          error: "Mobile and emergency contact numbers cannot be the same",
        });
    }

    const validBloodGroups = [
      "A+ve",
      "A-ve",
      "B+ve",
      "B-ve",
      "AB+ve",
      "AB-ve",
      "O+ve",
      "O-ve",
    ];
    if (blood_group && !validBloodGroups.includes(blood_group)) {
      return res.status(400).json({ error: "Invalid blood group" });
    }

    const table =
      role === "hr"
        ? "hrs"
        : role === "dept_head"
        ? "dept_heads"
        : role === "manager"
        ? "managers"
        : "employees";

    if (["dept_head", "employee", "manager"].includes(role)) {
      if (!department_name || !designation_name) {
        return res
          .status(400)
          .json({ error: "Department and designation are required" });
      }
      const [designation] = await queryAsync(
        "SELECT * FROM designations WHERE department_name = ? AND designation_name = ?",
        [department_name, designation_name]
      );
      if (!designation) {
        return res
          .status(400)
          .json({ error: "Invalid department or designation" });
      }
    }

    if (["employee", "hr", "dept_head", "manager"].includes(role)) {
      if (
        isNaN(basic_salary) ||
        basic_salary < 0 ||
        isNaN(allowances) ||
        allowances < 0
      ) {
        return res
          .status(400)
          .json({ error: "Valid basic salary and allowances are required" });
      }
    }

    try {
      const [existingMobile] = await queryAsync(
        `SELECT mobile FROM (
          SELECT mobile FROM employees WHERE TRIM(mobile) = ?
          UNION
          SELECT mobile FROM hrs WHERE TRIM(mobile) = ?
          UNION
          SELECT mobile FROM dept_heads WHERE TRIM(mobile) = ?
          UNION
          SELECT mobile FROM managers WHERE TRIM(mobile) = ?
          UNION
          SELECT mobile FROM hrms_users WHERE TRIM(mobile) = ?
        ) AS all_users`,
        [
          mobile.trim(),
          mobile.trim(),
          mobile.trim(),
          mobile.trim(),
          mobile.trim(),
        ]
      );
      if (existingMobile) {
        return res.status(400).json({ error: "Mobile number already in use" });
      }

      const [existingEmail] = await queryAsync(
        `SELECT email FROM ${table} WHERE TRIM(LOWER(email)) = ?`,
        [email.trim().toLowerCase()]
      );
      if (existingEmail) {
        return res.status(400).json({ error: "Email already in use" });
      }

      const employeeId = await generateEmployeeId();
      const hashedPassword = await bcrypt.hash(password, 10);
      const baseUrl =
        process.env.UPLOADS_BASE_URL || "http://localhost:3007/uploads/";
      const photo_url = photo ? `${baseUrl}${path.basename(photo.path)}` : null;

      console.log("Generated photo_url:", photo_url);

      let query, values;
      if (role === "hr") {
        query = `INSERT INTO hrs (employee_id, full_name, email, mobile, password, is_temporary_password, basic_salary, allowances, bonuses, blood_group, photo_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        values = [
          employeeId,
          name,
          email,
          mobile,
          hashedPassword,
          true,
          basic_salary || 0,
          allowances || 0,
          bonuses || 0,
          blood_group || null,
          photo_url,
        ];
      } else if (role === "dept_head") {
        query = `INSERT INTO dept_heads (employee_id, full_name, email, mobile, password, department_name, designation_name, is_temporary_password, basic_salary, allowances, bonuses, blood_group, photo_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        values = [
          employeeId,
          name,
          email,
          mobile,
          hashedPassword,
          department_name,
          designation_name,
          true,
          basic_salary || 0,
          allowances || 0,
          bonuses || 0,
          blood_group || null,
          photo_url,
        ];
      } else if (role === "manager") {
        query = `INSERT INTO managers (employee_id, full_name, email, mobile, password, department_name, designation_name, is_temporary_password, basic_salary, allowances, bonuses, blood_group, photo_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        values = [
          employeeId,
          name,
          email,
          mobile,
          hashedPassword,
          department_name,
          designation_name,
          true,
          basic_salary || 0,
          allowances || 0,
          bonuses || 0,
          blood_group || null,
          photo_url,
        ];
      } else {
        query = `INSERT INTO employees (employee_id, full_name, email, mobile, emergency_phone, address, password, department_name, designation_name, employment_type, basic_salary, allowances, bonuses, join_date, is_temporary_password, blood_group, photo_url)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        values = [
          employeeId,
          name,
          email,
          mobile,
          emergency_phone || null,
          address || null,
          hashedPassword,
          department_name,
          designation_name,
          employment_type,
          basic_salary || 0,
          allowances || 0,
          bonuses || 0,
          join_date,
          true,
          blood_group || null,
          photo_url,
        ];
      }

      const result = await queryAsync(query, values);
      console.log("Database insert result:", result); // Debug log
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
          blood_group,
          photo_url,
          ...(role === "dept_head" || role === "manager"
            ? { department_name, designation_name }
            : {}),
          ...(role === "employee"
            ? { department_name, designation_name, employment_type, join_date }
            : {}),
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
      return res
        .status(400)
        .json({ error: "File upload error: " + err.message });
    }

    const userRole = req.user.role;
    const { id } = req.params;
    const { name, email, mobile, emergency_phone, address, role, blood_group } =
      req.body;
    const photo = req.files?.["photo"]?.[0];

    if (!["super_admin", "hr"].includes(userRole) && userRole !== role) {
      return res
        .status(403)
        .json({
          error:
            "Access denied: Insufficient permissions to update this record",
        });
    }
    if (userRole === "hr" && role === "hr") {
      return res.status(403).json({ error: "HR cannot update HR accounts" });
    }

    if (!name?.trim() || !email?.trim() || !mobile?.trim() || !role) {
      return res
        .status(400)
        .json({
          error: "Name, email, mobile, and role are required for update",
        });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    if (emergency_phone && emergency_phone.trim() === mobile.trim()) {
      return res
        .status(400)
        .json({
          error: "Mobile and emergency contact numbers cannot be the same",
        });
    }

    const validBloodGroups = [
      "A+ve",
      "A-ve",
      "B+ve",
      "B-ve",
      "AB+ve",
      "AB-ve",
      "O+ve",
      "O-ve",
    ];
    if (blood_group && !validBloodGroups.includes(blood_group)) {
      return res.status(400).json({ error: "Invalid blood group" });
    }

    const table =
      role === "hr"
        ? "hrs"
        : role === "dept_head"
        ? "dept_heads"
        : role === "manager"
        ? "managers"
        : "employees";

    try {
      const [existingRecord] = await queryAsync(
        `SELECT * FROM ${table} WHERE id = ?`,
        [id]
      );
      if (!existingRecord) {
        return res.status(404).json({ error: `${role} record not found` });
      }

      const [emailCheck] = await queryAsync(
        `SELECT * FROM ${table} WHERE email = ? AND id != ?`,
        [email, id]
      );
      if (emailCheck) {
        return res
          .status(400)
          .json({ error: "Email is already in use by another record" });
      }

      const [mobileCheck] = await queryAsync(
        `SELECT mobile FROM (
          SELECT mobile FROM employees WHERE TRIM(mobile) = ? AND id != ?
          UNION
          SELECT mobile FROM hrs WHERE TRIM(mobile) = ? AND id != ?
          UNION
          SELECT mobile FROM dept_heads WHERE TRIM(mobile) = ? AND id != ?
          UNION
          SELECT mobile FROM managers WHERE TRIM(mobile) = ? AND id != ?
          UNION
          SELECT mobile FROM hrms_users WHERE TRIM(mobile) = ? AND id != ?
        ) AS all_users`,
        [
          mobile.trim(),
          id,
          mobile.trim(),
          id,
          mobile.trim(),
          id,
          mobile.trim(),
          id,
          mobile.trim(),
          id,
        ]
      );
      if (mobileCheck) {
        return res.status(400).json({ error: "Mobile number already in use" });
      }

      const baseUrl = "http://locahhost:3007/uploads/";
      const photo_url = photo
        ? `${baseUrl}${path.basename(photo.path)}`
        : req.body.photo === "null"
        ? null
        : existingRecord.photo_url;

      const query = `UPDATE ${table} SET full_name = ?, email = ?, mobile = ?, emergency_phone = ?, address = ?, blood_group = ?, photo_url = ? WHERE id = ?`;
      const values = [
        name,
        email,
        mobile,
        emergency_phone || null,
        address || null,
        blood_group || null,
        photo_url,
        id,
      ];

      const result = await queryAsync(query, values);
      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ error: `${role} record not found for update` });
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
          photo_url,
        },
      });
    } catch (err) {
      console.error("DB error:", err.message, err.sqlMessage, err.code);
      res.status(500).json({ error: "Database error during update" });
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
    password = "defaultPass123",
  } = req.body;

  if (!["super_admin", "hr"].includes(userRole) && employeeId !== userId) {
    return res
      .status(403)
      .json({
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
    return res
      .status(400)
      .json({
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
    const [employee] = await queryAsync(
      `SELECT employee_id, full_name, email, mobile FROM employees WHERE employee_id = ?`,
      [employeeId]
    );
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    if (
      userRole === "employee" &&
      (fullName !== employee.full_name ||
        email !== employee.email ||
        phone !== employee.mobile)
    ) {
      return res
        .status(400)
        .json({
          error: "Full name, email, and phone must match your employee record",
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
      `SELECT mobile FROM (
        SELECT mobile FROM employees WHERE TRIM(mobile) = ? AND employee_id != ?
        UNION
        SELECT mobile FROM hrs WHERE TRIM(mobile) = ? AND employee_id != ?
        UNION
        SELECT mobile FROM dept_heads WHERE TRIM(mobile) = ? AND employee_id != ?
        UNION
        SELECT mobile FROM managers WHERE TRIM(mobile) = ? AND employee_id != ?
        UNION
        SELECT mobile FROM hrms_users WHERE TRIM(mobile) = ? AND employee_id != ?
      ) AS all_users`,
      [
        phone.trim(),
        employeeId,
        phone.trim(),
        employeeId,
        phone.trim(),
        employeeId,
        phone.trim(),
        employeeId,
        phone.trim(),
        employeeId,
      ]
    );
    if (existingMobile) {
      return res.status(400).json({ error: "Phone number already in use" });
    }

    const [existingEmail] = await queryAsync(
      `SELECT email FROM (
        SELECT email FROM employees WHERE TRIM(LOWER(email)) = ? AND employee_id != ?
        UNION
        SELECT email FROM hrs WHERE TRIM(LOWER(email)) = ? AND employee_id != ?
        UNION
        SELECT email FROM dept_heads WHERE TRIM(LOWER(email)) = ? AND employee_id != ?
        UNION
        SELECT email FROM managers WHERE TRIM(LOWER(email)) = ? AND employee_id != ?
        UNION
        SELECT email FROM hrms_users WHERE TRIM(LOWER(email)) = ? AND employee_id != ?
      ) AS all_users`,
      [
        email.trim().toLowerCase(),
        employeeId,
        email.trim().toLowerCase(),
        employeeId,
        email.trim().toLowerCase(),
        employeeId,
        email.trim().toLowerCase(),
        employeeId,
        email.trim().toLowerCase(),
        employeeId,
      ]
    );
    if (existingEmail) {
      return res.status(400).json({ error: "Email already in use" });
    }

    let finalEmployeeId = employeeId;
    if (["super_admin", "hr"].includes(userRole)) {
      const [existingEmployee] = await queryAsync(
        `SELECT employee_id FROM employees WHERE employee_id = ?`,
        [employeeId]
      );
      if (!existingEmployee) {
        const hashedPassword = await bcrypt.hash(password, 10);
        const employeeQuery = `
          INSERT INTO employees (employee_id, full_name, email, mobile, password, role, is_temporary_password)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const employeeValues = [
          employeeId,
          fullName,
          email,
          phone,
          hashedPassword,
          "employee",
          true,
        ];
        await queryAsync(employeeQuery, employeeValues);
      }
    }

    const personalQuery = `
      INSERT INTO personal_details (
        employee_id, full_name, father_name, mother_name, phone, alternate_phone, email, gender,
        present_address, previous_address, position_type, employer_id_name, position_title,
        employment_type, joining_date, contract_end_date, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const personalValues = [
      finalEmployeeId,
      employee.full_name,
      fatherName || null,
      motherName || null,
      employee.mobile,
      alternatePhone || null,
      employee.email,
      gender,
      presentAddress || null,
      previousAddress || null,
      positionType || null,
      employerIdName || null,
      positionTitle || null,
      employmentType || null,
      joiningDate || null,
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
  if (userRole === "employee" && normalizedBodyId !== normalizedUserId) {
    return res
      .status(403)
      .json({
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
      `SELECT employee_id FROM employees WHERE UPPER(TRIM(employee_id)) = ?`,
      [normalizedBodyId]
    );
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
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

    if (userRole === "employee") {
      employeeId = userId;
    }
    if (!["super_admin", "hr", "employee"].includes(userRole)) {
      return res
        .status(403)
        .json({ error: "Access denied: Insufficient permissions" });
    }

    if (!employeeId || !documentType || !document) {
      return res
        .status(400)
        .json({ error: "Employee ID, document type, and file are required" });
    }

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
        `SELECT employee_id FROM employees WHERE employee_id = ?`,
        [employeeId]
      );
      if (!employee) {
        return res.status(404).json({ error: "Employee not found" });
      }

      const baseUrl = "http://localhost:3007/uploads/";
      const fileExtension = path.extname(document.originalname).toLowerCase();
      const fileType = fileExtension === ".pdf" ? "pdf" : "image";
      const filePath = `${baseUrl}${path.basename(document.path)}`;

      const query = `
        INSERT INTO documents (employee_id, document_type, file_path, file_type)
        VALUES (?, ?, ?, ?)
      `;
      const values = [employeeId, documentType, filePath, fileType];

      const result = await queryAsync(query, values);
      res.status(201).json({
        message: "Document uploaded successfully",
        data: {
          id: result.insertId,
          employee_id: employeeId,
          document_type: documentType,
          file_path: filePath,
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

  if (userRole === "employee" && employeeId !== userId) {
    return res
      .status(403)
      .json({ error: "Access denied: You can only add your own bank details" });
  }

  if (!employeeId || !bankAccountNumber || !ifscCode) {
    return res
      .status(400)
      .json({
        error: "Employee ID, bank account number, and IFSC code are required",
      });
  }

  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifscCode)) {
    return res.status(400).json({ error: "Invalid IFSC code format" });
  }

  try {
    const [employee] = await queryAsync(
      `SELECT employee_id, full_name FROM employees WHERE employee_id = ?`,
      [employeeId]
    );
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
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

    const baseUrl = "http://localhost:3007/uploads/";
    const deptHeads = await queryAsync(
      `SELECT id, employee_id, full_name, email, mobile, department_name, designation_name,blood_group, emergency_phone, 'dept_head' as role,
          photo_url FROM dept_heads`,
      [baseUrl]
    );
    const managers = await queryAsync(
      `SELECT id, employee_id, full_name, email, mobile, department_name, designation_name,blood_group,emergency_phone, 'manager' as role,
              photo_url
       FROM managers`,
      [baseUrl]
    );
    const employees = await queryAsync(
      `SELECT id, employee_id, full_name, email, mobile, department_name, designation_name,address, employment_type, basic_salary, allowances, join_date, blood_group, emergency_phone,'employee' as role,
               photo_url
       FROM employees`,
      [baseUrl]
    );

    const allEmployees = [...deptHeads, ...managers, ...employees];
    res.json({ message: "Employees fetched successfully", data: allEmployees });
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
    const baseUrl = "http://localhost:3007/uploads/";
    const tables = ["employees", "hrs", "dept_heads", "managers"];
    let employee = null;

    for (const table of tables) {
      const [result] = await queryAsync(
        `SELECT id, employee_id, full_name, email, mobile, department_name, designation_name, employment_type, basic_salary, allowances, join_date, blood_group, 
                CASE WHEN photo_url IS NOT NULL THEN CONCAT(?, photo_url) ELSE NULL END as photo_url,
                ? as role
         FROM ${table} WHERE id = ?`,
        [baseUrl, table, id]
      );
      if (result) {
        employee = result;
        break;
      }
    }

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
  const { role } = req.body;

  if (!["super_admin", "hr"].includes(userRole)) {
    return res
      .status(403)
      .json({
        error: "Access denied: Insufficient permissions to delete this record",
      });
  }
  if (userRole === "hr" && role === "hr") {
    return res.status(403).json({ error: "HR cannot delete HR accounts" });
  }

  if (!role) {
    return res.status(400).json({ error: "Role is required for deletion" });
  }

  const table =
    role === "hr"
      ? "hrs"
      : role === "dept_head"
      ? "dept_heads"
      : role === "manager"
      ? "managers"
      : "employees";

  try {
    const [existingRecord] = await queryAsync(
      `SELECT photo_url FROM ${table} WHERE id = ?`,
      [id]
    );
    if (!existingRecord) {
      return res
        .status(404)
        .json({ error: `${role} record not found for deletion` });
    }

    if (role === "employee") {
      const payrollCheck = await queryAsync(
        "SELECT * FROM payroll WHERE employee_id = (SELECT employee_id FROM employees WHERE id = ?)",
        [id]
      );
      if (payrollCheck.length > 0) {
        return res
          .status(400)
          .json({
            error:
              "Cannot delete employee with existing payroll records. Archive or resolve dependencies first.",
          });
      }
    }

    const result = await queryAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ error: `${role} record not found for deletion` });
    }

    res.json({ message: `${role} deleted successfully`, role, id });
  } catch (err) {
    console.error("DB error:", err.message, err.sqlMessage, err.code);
    res.status(500).json({ error: "Database error during deletion" });
  }
};

const getCurrentUserProfile = async (req, res) => {
  const userRole = req.user.role;
  const userId = req.user.employee_id;

  try {
    let query, table;
    const baseUrl = "http://localhost:3007/uploads/";
    if (userRole === "super_admin") {
      table = "hrms_users";
      query = `SELECT employee_id, full_name, email, mobile,emergency_phone,designation_name,
                      CASE WHEN photo_url IS NOT NULL THEN CONCAT(?, photo_url) ELSE NULL END as photo_url
               FROM hrms_users WHERE employee_id = ?`;
    } else if (userRole === "hr") {
      table = "hrs";
      query = `SELECT employee_id, full_name, email, mobile,emergency_phone,department_name,designation_name,
                      CASE WHEN photo_url IS NOT NULL THEN CONCAT(?, photo_url) ELSE NULL END as photo_url
               FROM hrs WHERE employee_id = ?`;
    } else if (userRole === "dept_head") {
      table = "dept_heads";
      query = `SELECT employee_id, full_name, email, mobile, blood_group,emergency_phone,department_name,designation_name,
                      CASE WHEN photo_url IS NOT NULL THEN CONCAT(?, photo_url) ELSE NULL END as photo_url
               FROM dept_heads WHERE employee_id = ?`;
    } else if (userRole === "manager") {
      table = "managers";
      query = `SELECT employee_id, full_name, email, mobile, blood_group,emergency_phone,department_name,designation_name,
                      CASE WHEN photo_url IS NOT NULL THEN CONCAT(?, photo_url) ELSE NULL END as photo_url
               FROM managers WHERE employee_id = ?`;
    } else if (userRole === "employee") {
      table = "employees";
      query = `SELECT employee_id, full_name, email, mobile, blood_group, emergency_phone,department_name,designation_name,
                      CASE WHEN photo_url IS NOT NULL THEN CONCAT(?, photo_url) ELSE NULL END as photo_url
               FROM employees WHERE employee_id = ?`;
    } else {
      return res.status(403).json({ error: "Invalid user role" });
    }

    const [user] = await queryAsync(query, [baseUrl, userId]);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      message: "User profile fetched successfully",
      data: {
        employee_id: user.employee_id,
        fullName: user.full_name,
        email: user.email,
        mobile: user.mobile,
        emergency_phone:user.emergency_phone,
        designation_name:user.designation_name,
        blood_group: user.blood_group,
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

  if (!["super_admin", "hr", "employee"].includes(userRole)) {
    return res
      .status(403)
      .json({ error: "Access denied: Insufficient permissions" });
  }

  try {
    const [personalDetails] = await queryAsync(
      `SELECT employee_id FROM personal_details WHERE employee_id = ?`,
      [userId]
    );
    const [educationDetails] = await queryAsync(
      `SELECT employee_id FROM education_details WHERE employee_id = ?`,
      [userId]
    );
    const [bankDetails] = await queryAsync(
      `SELECT employee_id FROM bank_details WHERE employee_id = ?`,
      [userId]
    );
    const [documents] = await queryAsync(
      `SELECT employee_id FROM documents WHERE employee_id = ?`,
      [userId]
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

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  try {
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

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  try {
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

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  try {
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

  if (!["super_admin", "hr"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }

  try {
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
