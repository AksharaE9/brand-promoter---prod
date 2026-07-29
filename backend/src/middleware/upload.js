const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const { MAX_UPLOAD_BYTES } = require("../config/uploadLimits");

const multerInstance = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
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
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

const memoryUpload = (req, res, next) => {
  return memoryUploadInstance(req, res, next);
};
memoryUpload.single = (...args) => memoryUploadInstance.single(...args);
memoryUpload.array = (...args) => memoryUploadInstance.array(...args);
memoryUpload.fields = (...args) => memoryUploadInstance.fields(...args);
memoryUpload.none = (...args) => memoryUploadInstance.none(...args);
memoryUpload.any = (...args) => memoryUploadInstance.any(...args);

// 3. Local Disk Storage (Offer Letters / Feedback Files)
// Custom storage engine to set req.file.path to /uploads/ats-offer-letters/...
function LocalStorage(opts) {
  this.dest = opts.dest || 'uploads';
  this.folder = opts.folder || '';
}

LocalStorage.prototype._handleFile = function _handleFile(req, file, cb) {
  const uploadsDir = path.join(__dirname, '..', '..', this.dest);
  const targetFolder = path.join(uploadsDir, this.folder);
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  const ext = path.extname(file.originalname);
  const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_]/g, '_');
  const filename = `offer_${Date.now()}_${baseName}${ext}`;
  const finalPath = path.join(targetFolder, filename);

  const outStream = fs.createWriteStream(finalPath);
  file.stream.pipe(outStream);

  outStream.on('error', cb);
  outStream.on('finish', () => {
    const relativeUrl = `/uploads/${this.folder}/${filename}`.replace(/\/+/g, '/');
    cb(null, {
      destination: targetFolder,
      filename: filename,
      path: relativeUrl, // sets req.file.path
      size: outStream.bytesWritten
    });
  });
};

LocalStorage.prototype._removeFile = function _removeFile(req, file, cb) {
  const filePath = path.join(file.destination, file.filename);
  fs.unlink(filePath, cb);
};

const offerLetterStorage = new LocalStorage({
  dest: 'uploads',
  folder: 'ats-offer-letters'
});

const offerLetterUpload = multer({
  storage: offerLetterStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

module.exports = {
  upload,
  memoryUpload,
  offerLetterUpload,
};
