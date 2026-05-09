const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// 1. Cloudinary Storage (Persistent Files: Resumes, Recordings)
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: (req, file) => req.uploadFolder || "ats-misc",
    resource_type: "auto", 
    public_id: (req, file) => {
      const base = (file.originalname || "file").split(".")[0].replace(/[^a-zA-Z0-9-_]/g, "_");
      return `${Date.now()}-${base}`;
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
});

// 2. Memory Storage (Transient Files: Excel Bulk Uploads)
// We use memory storage for Excel because XLSX needs to read the buffer 
// and we avoid local filesystem path issues in Vercel.
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = {
  upload,
  memoryUpload,
};
