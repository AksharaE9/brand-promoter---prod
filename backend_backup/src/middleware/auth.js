const prisma = require("../config/prisma");
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
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!user || user.status !== "ACTIVE") {
      return next(new ApiError(401, "Invalid or inactive user"));
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
