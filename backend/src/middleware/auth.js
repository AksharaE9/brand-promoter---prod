const { db: firestore } = require("../config/firebase");
const { verifyAccessToken } = require("../utils/jwt");
const { ApiError } = require("../utils/errors");

async function auth(req, res, next) {
  let token = null;

  // 1. Try Authorization Header
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }

  // 2. Try Query Parameter (Support direct downloads)
  if (!token && req.query.token) {
    token = req.query.token;
    console.log(`[AUTH] Using query token for ${req.path}`);
  }

  if (!token) {
    console.log(`[AUTH] No token found for ${req.path}`);
    return next(new ApiError(401, "Authorization token is required"));
  }

  try {
    const payload = verifyAccessToken(token);
    
    // Check if session has been revoked/deleted
    if (payload.sessionId) {
      const sessionDoc = await firestore.collection("sessions").doc(payload.sessionId).get();
      if (!sessionDoc.exists) {
        return next(new ApiError(401, "Session has been revoked or expired"));
      }
      // Update last active
      firestore.collection("sessions").doc(payload.sessionId).update({
        lastActive: new Date().toISOString()
      }).catch(() => {});
    }

    const userDoc = await firestore.collection("users").doc(payload.userId).get();

    if (!userDoc.exists) {
      return next(new ApiError(401, "Invalid user"));
    }

    const user = { id: userDoc.id, ...userDoc.data(), sessionId: payload.sessionId || null };

    if (user.status !== "ACTIVE" || user.isDeleted === true) {
      return next(new ApiError(401, "Inactive or deleted user account"));
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(new ApiError(401, "Invalid or expired token"));
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new ApiError(401, "Unauthorized"));
    }

    if (!roles.includes(req.user.role)) {
      return next(new ApiError(403, "Forbidden: insufficient permissions"));
    }

    return next();
  };
}

module.exports = {
  auth,
  requireRoles,
};
