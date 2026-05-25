const express = require("express");
const { upload } = require("../../middleware/upload");
const { uploadFileToFirebase } = require("../../config/firebase");
const { auth } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { db: firestore } = require("../../config/firebase");

const router = express.Router();
router.use(auth);

router.post("/profile-photo", upload.single("file"), asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, "No file uploaded");
  
  const dest = `profile-photos/${Date.now()}_${req.file.originalname}`;
  const storageKey = await uploadFileToFirebase(req.file.buffer, dest, req.file.mimetype);
  if (!storageKey) throw new ApiError(500, "Failed to upload profile photo");
  
  const fileMeta = {
    storageKey,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
    uploadedById: req.user.id,
    createdAt: new Date().toISOString()
  };
  const fileRef = await firestore.collection("fileMetas").add(fileMeta);
  
  res.json({ success: true, url: storageKey, fileId: fileRef.id });
}));

module.exports = router;
