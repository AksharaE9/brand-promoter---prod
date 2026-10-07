const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret_in_env";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1d";

function signAccessToken(payload, options = {}) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN, ...options });
}

function verifyAccessToken(token, options = {}) {
  // Allow 60s clock skew tolerance by default to handle UTC/IST and client-server drift
  return jwt.verify(token, JWT_SECRET, { clockTolerance: 60, ...options });
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
};

