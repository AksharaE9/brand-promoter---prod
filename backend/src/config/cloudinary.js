'use strict';
/**
 * cloudinary.js — STUB (Cloudinary has been fully removed)
 *
 * This stub exists only so that any legacy `require('../../config/cloudinary')`
 * calls don't crash the server. All new code uses dbStorage.js instead.
 *
 * The stub object mimics the cloudinary v2 SDK shape so that legacy
 * candidate resume download code (which still has a conditional
 * `if (storageKey.includes("res.cloudinary.com"))` guard) can still import
 * `cloudinary.utils.private_download_url` for the rare case of very old records
 * that still have Cloudinary URLs as their storageKey.
 */

// If real Cloudinary credentials are present in the environment, use the real SDK.
// This allows old Cloudinary-URL records to still be served correctly.
if (
  process.env.CLOUDINARY_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  try {
    const cloudinarySDK = require('cloudinary').v2;
    cloudinarySDK.config({
      cloud_name:  process.env.CLOUDINARY_NAME,
      api_key:     process.env.CLOUDINARY_API_KEY,
      api_secret:  process.env.CLOUDINARY_API_SECRET,
      secure:      true,
    });
    module.exports = cloudinarySDK;
  } catch (_) {
    // cloudinary package not installed — fall through to stub
    module.exports = buildStub();
  }
} else {
  module.exports = buildStub();
}

function buildStub() {
  return {
    config:   () => {},
    uploader: {
      upload_stream: () => { throw new Error('Cloudinary not configured'); },
      destroy:       () => Promise.resolve(),
    },
    utils: {
      private_download_url: () => { throw new Error('Cloudinary not configured'); },
    },
    // Deprecated — no new code should call this
    uploadFileToCloudinary: async () => {
      throw new Error('uploadFileToCloudinary is deprecated — use dbStorage.js instead');
    },
  };
}

// Named export kept for any remaining import: const { uploadFileToCloudinary } = require(...)
module.exports.uploadFileToCloudinary = async function uploadFileToCloudinary() {
  throw new Error('uploadFileToCloudinary is deprecated — use dbStorage.js instead. See src/utils/dbStorage.js');
};
