const pool = require("../config/db");
const util = require("util");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");

const queryAsync = util.promisify(pool.query).bind(pool);

const cardStyles = ["modern", "classic", "minimal", "corporate"];

// Use consistent uploadDir (relative to backend)
const uploadDir = path.join(__dirname, "../Uploads");
const cardDir = path.join(uploadDir, "cards");
if (!fs.existsSync(cardDir)) {
  console.log(`Creating card directory: ${cardDir}`);
  fs.mkdirSync(cardDir, { recursive: true });
}

// Access assets in backend/Uploads/
const assetPath = uploadDir; // Assets are in Uploads/
const backgroundImages = {
  modern: {
    front: path.join(assetPath, "ModernTempFront.png"),
    back: path.join(assetPath, "ModernTempBack.png"),
  },
  classic: {
    front: path.join(assetPath, "ClassicTempFront.png"),
    back: path.join(assetPath, "ClassicTempBack.png"),
  },
  minimal: {
    front: path.join(assetPath, "MinimalTempFront.png"),
    back: path.join(assetPath, "MinimalTempBack.png"),
  },
  corporate: {
    front: path.join(assetPath, "CorporateTempFront.png"),
    back: path.join(assetPath, "CorporateTempBack.png"),
  },
};
const companyLogoPath = path.join(assetPath, "CompanyLogo.png");

// Helper function to generate a PDF for a single employee card
const generateCardPDF = async (employee, style, side = "both") => {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: [252, 144] }); // 3.5in x 2in at 72dpi
    const outputPath = path.join(cardDir, `${employee.employee_id}_${style}_${Date.now()}.pdf`);
    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);

    const companyName = "Meet Owner";
    const employeeName = employee.full_name || "Employee Name";
    const employeeDesignation = employee.designation_name || "Designation";
    const employeePhone = employee.mobile || "-";
    const employeeEmail = employee.email || "-";
    const employeeAddress = employee.address || "-";
    const employeeWebsite = employee.website || "meetowner.in";

    const templates = {
      modern: {
        front: (doc) => {
          try {
            doc.image(backgroundImages.modern.front, 0, 0, { width: 252, height: 144 });
            doc.image(companyLogoPath, 94.5, 48, { width: 63, height: 63 }); // Centered: (252-63)/2 = 94.5
          } catch (err) {
            console.error("Error adding modern front images:", err.message);
          }
        },
        back: (doc) => {
          try {
            doc.image(backgroundImages.modern.back, 0, 0, { width: 252, height: 144 });
            doc
              .fillColor("#1e293b")
              .font("Helvetica-Bold")
              .fontSize(12)
              .text(employeeName, 20, 20, { align: "right" })
              .font("Helvetica")
              .fontSize(10)
              .fillColor("#0f766e")
              .text(employeeDesignation, 20, 35, { align: "right" })
              .fontSize(8)
              .fillColor("#1e293b")
              .text(`Phone: ${employeePhone}`, 20, 50)
              .text(`Email: ${employeeEmail}`, 20, 60)
              .text(`Address: ${employeeAddress}`, 20, 70)
              .text(`Website: ${employeeWebsite}`, 20, 80);
          } catch (err) {
            console.error("Error adding modern back images:", err.message);
          }
        },
      },
      classic: {
        front: (doc) => {
          try {
            doc.image(backgroundImages.classic.front, 0, 0, { width: 252, height: 144 });
            doc.image(companyLogoPath, 94.5, 48, { width: 63, height: 63 });
          } catch (err) {
            console.error("Error adding classic front images:", err.message);
          }
        },
        back: (doc) => {
          try {
            doc.image(backgroundImages.classic.back, 0, 0, { width: 252, height: 144 });
            doc
              .fillColor("#1e293b")
              .font("Helvetica-Bold")
              .fontSize(12)
              .text(employeeName, 20, 20, { align: "left" })
              .font("Helvetica")
              .fontSize(10)
              .fillColor("#0f766e")
              .text(employeeDesignation, 20, 35, { align: "left" })
              .fontSize(8)
              .fillColor("#1e293b")
              .text(`Phone: ${employeePhone}`, 20, 50)
              .text(`Email: ${employeeEmail}`, 20, 60)
              .text(`Address: ${employeeAddress}`, 20, 70)
              .text(`Website: ${employeeWebsite}`, 20, 80);
          } catch (err) {
            console.error("Error adding classic back images:", err.message);
          }
        },
      },
      minimal: {
        front: (doc) => {
          try {
            doc.image(backgroundImages.minimal.front, 0, 0, { width: 252, height: 144 });
            doc.image(companyLogoPath, 94.5, 48, { width: 63, height: 63 });
          } catch (err) {
            console.error("Error adding minimal front images:", err.message);
          }
        },
        back: (doc) => {
          try {
            doc.image(backgroundImages.minimal.back, 0, 0, { width: 252, height: 144 });
            doc
              .fillColor("#ffffff")
              .font("Helvetica-Bold")
              .fontSize(12)
              .text(employeeName, 20, 20, { align: "right" })
              .font("Helvetica")
              .fontSize(10)
              .text(employeeDesignation, 20, 35, { align: "right" })
              .fontSize(8)
              .text(`Phone: ${employeePhone}`, 20, 50)
              .text(`Email: ${employeeEmail}`, 20, 60)
              .text(`Address: ${employeeAddress}`, 20, 70)
              .text(`Website: ${employeeWebsite}`, 20, 80);
          } catch (err) {
            console.error("Error adding minimal back images:", err.message);
          }
        },
      },
      corporate: {
        front: (doc) => {
          try {
            doc.image(backgroundImages.corporate.front, 0, 0, { width: 252, height: 144 });
            doc.image(companyLogoPath, 94.5, 48, { width: 63, height: 63 });
          } catch (err) {
            console.error("Error adding corporate front images:", err.message);
          }
        },
        back: (doc) => {
          try {
            doc.image(backgroundImages.corporate.back, 0, 0, { width: 252, height: 144 });
            doc
              .fillColor("#1e293b")
              .font("Helvetica-Bold")
              .fontSize(12)
              .text(employeeName, 36, 20, { align: "right" })
              .font("Helvetica")
              .fontSize(10)
              .fillColor("#0f766e")
              .text(employeeDesignation, 36, 35, { align: "right" })
              .fontSize(8)
              .fillColor("#1e293b")
              .text(`Phone: ${employeePhone}`, 36, 50)
              .text(`Email: ${employeeEmail}`, 36, 60)
              .text(`Address: ${employeeAddress}`, 36, 70)
              .text(`Website: ${employeeWebsite}`, 36, 80);
          } catch (err) {
            console.error("Error adding corporate back images:", err.message);
          }
        },
      },
    };

    const template = templates[style] || templates.modern;

    if (side === "front" || side === "both") {
      template.front(doc);
    }
    if (side === "back" || side === "both") {
      if (side === "both") doc.addPage();
      template.back(doc);
    }

    doc.end();
    writeStream.on("finish", () => resolve(outputPath));
    writeStream.on("error", (err) => reject(err));
  });
};

const downloadSingleCard = async (req, res) => {
  const { employeeId, style } = req.params;
  const userRole = req.user.role;
  const userId = req.user.employee_id;

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
    const [employee] = await queryAsync(
      `SELECT employee_id, full_name, email, mobile, department_name, designation_name, address, 
              CASE WHEN photo_url IS NOT NULL THEN CONCAT(?, photo_url) ELSE NULL END as photo_url,
              'meetowner.in' as website
       FROM hrms_users 
       WHERE employee_id = ?`,
      [
        process.env.UPLOADS_BASE_URL || "http://localhost:3007/uploads/",
        employeeId,
      ]
    );

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const pdfPath = await generateCardPDF(employee, style);
    const fileName = `${employee.employee_id}_${style}_card.pdf`;

    res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);
    res.setHeader("Content-Type", "application/pdf");
    fs.createReadStream(pdfPath).pipe(res);

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