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

  console.log(`🚀 Storage: Saving file locally to ${subfolder}/${filename}...`);
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
