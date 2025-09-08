const pool = require("../config/db");
const util = require("util");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
const queryAsync = util.promisify(pool.query).bind(pool);

// Supported card styles (matching frontend)
const cardStyles = ["modern", "classic", "minimal", "corporate"];

// Ensure the cards directory exists
const cardDir = path.join(__dirname, "../Uploads/cards");
if (!fs.existsSync(cardDir)) {
  fs.mkdirSync(cardDir, { recursive: true });
}

// Helper function to generate a PDF for a single employee
const generateCardPDF = async (employee, style, side = "both") => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [252, 144] }); // Standard business card size (3.5" x 2" at 72 DPI)
    const outputPath = path.join(
      __dirname,
      `../Uploads/cards/${employee.employee_id}_${style}_${Date.now()}.pdf`
    );
    const writeStream = fs.createWriteStream(outputPath);

    doc.pipe(writeStream);

    // Customize PDF based on style (simplified; adjust for actual templates)
    if (side === "front" || side === "both") {
      // Front side
      doc.fontSize(12).font("Helvetica-Bold").text(`${employee.full_name}`, 20, 20);
      doc.fontSize(10).font("Helvetica").text(`${employee.designation_name}`, 20, 40);
      doc.fontSize(8).text(`${employee.department_name}`, 20, 55);
      // Add company logo (example; replace with actual path)
      // doc.image("path/to/company-logo.png", 180, 20, { width: 50 });
      if (employee.photo_url) {
        try {
          doc.image(employee.photo_url, 20, 70, { width: 50, height: 50 });
        } catch (err) {
          console.error("Error adding photo to PDF:", err.message);
        }
      }
    }

    if (side === "back" || side === "both") {
      if (side === "both") doc.addPage();
      // Back side
      doc.fontSize(10).font("Helvetica").text(`Email: ${employee.email}`, 20, 20);
      doc.fontSize(10).text(`Mobile: ${employee.mobile}`, 20, 40);
      doc.fontSize(8).text("Company Name", 20, 60); // Replace with actual company name
      // Add QR code or other details (optional; requires additional logic)
    }

    doc.end();

    writeStream.on("finish", () => resolve(outputPath));
    writeStream.on("error", (err) => reject(err));
  });
};

// Download single employee card
const downloadSingleCard = async (req, res) => {
  const { employeeId, style } = req.params;
  const userRole = req.user.role;
  const userId = req.user.employee_id;

  // Validate role and permissions
  if (!["super_admin", "hr", "employee"].includes(userRole)) {
    return res.status(403).json({ error: "Access denied: Insufficient permissions" });
  }
  if (userRole === "employee" && employeeId !== userId) {
    return res.status(403).json({ error: "Access denied: You can only download your own card" });
  }
  if (!cardStyles.includes(style)) {
    return res.status(400).json({ error: "Invalid card style" });
  }

  try {
    // Fetch employee
    const [employee] = await queryAsync(
      `SELECT employee_id, full_name, email, mobile, department_name, designation_name, photo_url
       FROM (
         SELECT employee_id, full_name, email, mobile, department_name, designation_name, photo_url
         FROM employees WHERE employee_id = ?
         UNION
         SELECT employee_id, full_name, email, mobile, department_name, designation_name, photo_url
         FROM hrs WHERE employee_id = ?
         UNION
         SELECT employee_id, full_name, email, mobile, department_name, designation_name, photo_url
         FROM dept_heads WHERE employee_id = ?
         UNION
         SELECT employee_id, full_name, email, mobile, department_name, designation_name, photo_url
         FROM managers WHERE employee_id = ?
       ) AS all_users`,
      [employeeId, employeeId, employeeId, employeeId]
    );

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    // Generate PDF
    const pdfPath = await generateCardPDF(employee, style);
    const fileName = `${employee.employee_id}_${style}_card.pdf`;

    // Send file
    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.setHeader("Content-Type", "application/pdf");
    fs.createReadStream(pdfPath).pipe(res);

    // Cleanup file after sending
    setTimeout(() => {
      fs.unlink(pdfPath, (err) => {
        if (err) console.error("Error deleting temp file:", err);
      });
    }, 5000);
  } catch (err) {
    console.error("Error generating card:", err.message, err.stack);
    res.status(500).json({ error: "Failed to generate card" });
  }
};

module.exports = {
  downloadSingleCard,
};