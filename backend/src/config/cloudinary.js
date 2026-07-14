const path = require("path");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function uploadFileToCloudinary(buffer, destination, contentType) {
  console.log(`🚀 Storage: Starting upload to Cloudinary at ${destination} (${contentType})...`);
  try {
    const baseName = path.basename(destination, path.extname(destination));
    const sanitizedPublicId = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');

    const result = await new Promise((resolve) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          resource_type: "auto",
          folder: "ats-resumes",
          public_id: sanitizedPublicId
        },
        (error, result) => {
          if (error) {
            console.warn("❌ Storage: Cloudinary upload failed:", error.message);
            resolve(null);
          } else {
            console.log("✅ Storage: Cloudinary upload success:", result.secure_url);
            resolve(result.secure_url);
          }
        }
      );
      uploadStream.end(buffer);
    });
    return result;
  } catch (err) {
    console.warn("❌ Storage: Cloudinary module error:", err.message);
    return null;
  }
}

module.exports = cloudinary;
module.exports.uploadFileToCloudinary = uploadFileToCloudinary;
