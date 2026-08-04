const path = require("path");
const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const fs = require("fs");

// Support folder fallback (e.g. ats-resumes)
async function uploadFileToCloudinary(buffer, destination, arg3, arg4) {
  let subfolder = "";
  let filename = "";

  // Resolve subfolder and filename dynamically based on argument types
  if (typeof arg3 === 'string' && !arg3.includes('/')) {
    // e.g. uploadFileToCloudinary(buffer, folder, fileName, mimetype)
    subfolder = destination;
    filename = arg3;
  } else {
    // e.g. uploadFileToCloudinary(buffer, destination, mimetype)
    const parsed = path.parse(destination);
    subfolder = parsed.dir;
    filename = parsed.base;
  }

  // Sanitize filename
  filename = path.basename(filename);

  // If Cloudinary credentials are fully configured, attempt to upload there first
  if (process.env.CLOUDINARY_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    console.log(`🚀 Storage: Starting upload to Cloudinary in folder ${subfolder}...`);
    try {
      const baseName = path.basename(filename, path.extname(filename));
      const sanitizedPublicId = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');

      const result = await new Promise((resolve) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            resource_type: "auto",
            folder: subfolder || "ats-resumes",
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

      if (result) return result;
    } catch (err) {
      console.warn("❌ Storage: Cloudinary upload exception:", err.message);
    }
  }

  // Fallback to local storage (e.g., during tests or if Cloudinary is unavailable)
  console.log(`🚀 Storage: Saving file locally to ${subfolder}/${filename} as fallback...`);
  try {
    const uploadsDir = path.join(__dirname, "..", "..", "uploads");
    const targetDir = path.join(uploadsDir, subfolder);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const finalPath = path.join(targetDir, filename);
    fs.writeFileSync(finalPath, buffer);

    // Return the relative URL served by express static
    const fileUrl = `/uploads/${subfolder}/${filename}`.replace(/\/+/g, '/');
    console.log("✅ Storage: Local save success:", fileUrl);
    return fileUrl;
  } catch (err) {
    console.warn("❌ Storage: Local save failed:", err.message);
    return null;
  }
}

module.exports = cloudinary;
module.exports.uploadFileToCloudinary = uploadFileToCloudinary;
