/**
 * config/firebase.js
 * Cleaned up Firebase connector: Firebase completely removed.
 * Only uploads to Cloudinary.
 */
const path = require("path");

/**
 * Upload binary buffers to storage (Cloudinary)
 */
async function uploadFileToFirebase(buffer, destination, contentType) {
  console.log(`🚀 Storage: Starting upload to ${destination} (${contentType})...`);
  
  // Try Cloudinary (Primary - High Reliability)
  console.log("🛡️ Storage: Attempting Cloudinary upload...");
  try {
    const cloudinary = require("./cloudinary");
    const result = await new Promise((resolve) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          resource_type: "auto",
          folder: "ats-resumes",
          public_id: path.basename(destination, path.extname(destination))
        },
        (error, result) => {
          if (error) {
            console.warn("❌ Storage: Cloudinary upload failed.");
            resolve(null);
          } else {
            console.log("✅ Storage: Cloudinary upload success:", result.secure_url);
            resolve(result.secure_url);
          }
        }
      );
      uploadStream.end(buffer);
    });
    if (result) return result;
  } catch (err) {
    console.warn("❌ Storage: Cloudinary module error:", err.message);
  }

  console.error("❌ Storage: Cloudinary upload failed.");
  return null;
}

module.exports = {
  db: {},
  rtdb: {},
  admin: null,
  uploadFileToFirebase,
  usingAdmin: false,
  FieldPath: {
    documentId: () => {
      throw new Error("Firestore FieldPath is deprecated and removed.");
    }
  }
};
