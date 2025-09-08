const multer = require("multer");
const path = require("path");
const fs = require("fs");

const createStorage = (uploadDir) => {
  const fullUploadDir = path.resolve(__dirname, uploadDir);
  console.log("Resolved upload directory:", fullUploadDir); // Debug log
  if (!fs.existsSync(fullUploadDir)) {
    console.log(`Creating upload directory: ${fullUploadDir}`);
    fs.mkdirSync(fullUploadDir, { recursive: true });
  }
  return multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, fullUploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const filename = `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`;
      console.log(`Saving file as: ${filename}`);
      cb(null, filename);
    },
  });
};

const createFileFilter = (allowedTypes) => {
  return (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes[file.fieldname] && allowedTypes[file.fieldname].includes(ext)) {
      console.log(`File ${file.originalname} accepted (type: ${ext})`); // Debug log
      cb(null, true);
    } else {
      console.error(`File ${file.originalname} rejected. Allowed types: ${allowedTypes[file.fieldname]?.join(", ") || "none"}`);
      cb(new Error(`Invalid file type for ${file.fieldname}. Allowed types: ${allowedTypes[file.fieldname]?.join(", ") || "none"}`), false);
    }
  };
};

const createMulterInstance = (uploadDir, allowedTypes = {}, limits = { fileSize: 5 * 1024 * 1024 }) => {
  const storage = createStorage(uploadDir);
  const fileFilter = createFileFilter(allowedTypes);

  return multer({
    storage,
    fileFilter,
    limits,
  });
};

module.exports = { createMulterInstance };