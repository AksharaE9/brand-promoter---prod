const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// 1. Memory Storage (General Files: Resumes, Recordings, Excel)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

// 2. Memory Storage (Transient Files: Excel Bulk Uploads)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// 3. Direct Cloudinary Storage (Offer Letters / Feedback Files)
const offerLetterStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "ats-offer-letters",
    resource_type: "auto",
    public_id: (req, file) => `offer_${Date.now()}_${file.originalname.split('.')[0]}`,
  },
});

const offerLetterUpload = multer({ storage: offerLetterStorage });

module.exports = {
  upload,
  memoryUpload,
  offerLetterUpload,
};
