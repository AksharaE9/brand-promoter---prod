const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

const upload = (req, res, next) => {
  return multerInstance(req, res, next);
};
upload.single = (...args) => multerInstance.single(...args);
upload.array = (...args) => multerInstance.array(...args);
upload.fields = (...args) => multerInstance.fields(...args);
upload.none = (...args) => multerInstance.none(...args);
upload.any = (...args) => multerInstance.any(...args);

// 2. Memory Storage (Transient Files: Excel Bulk Uploads)
const memoryUploadInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const memoryUpload = (req, res, next) => {
  return memoryUploadInstance(req, res, next);
};
memoryUpload.single = (...args) => memoryUploadInstance.single(...args);
memoryUpload.array = (...args) => memoryUploadInstance.array(...args);
memoryUpload.fields = (...args) => memoryUploadInstance.fields(...args);
memoryUpload.none = (...args) => memoryUploadInstance.none(...args);
memoryUpload.any = (...args) => memoryUploadInstance.any(...args);

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
