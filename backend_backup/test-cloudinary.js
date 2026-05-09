require("dotenv").config();
const cloudinary = require("./src/config/cloudinary");

async function testCloudinary() {
  console.log("Testing Cloudinary connectivity...");
  console.log("Config: ", {
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_API_KEY ? "PRESENT" : "MISSING",
    api_secret: process.env.CLOUDINARY_API_SECRET ? "PRESENT" : "MISSING",
  });
  try {
    const result = await cloudinary.api.ping();
    console.log("Cloudinary Ping Result:", result);
    if (result.status === "ok") {
      console.log("✅ Cloudinary is correctly configured!");
    }
  } catch (error) {
    console.error("❌ Cloudinary connection failed!");
    console.error(error);
    process.exit(1);
  }
}

testCloudinary();
