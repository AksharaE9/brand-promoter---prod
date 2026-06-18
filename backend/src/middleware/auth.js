'use strict';
const prisma = require("../config/db");
const { verifyAccessToken } = require("../utils/jwt");
const { ApiError } = require("../utils/errors");
const l1 = require("../utils/l1Cache");

const USER_CACHE_TTL = 120; // 2 minutes

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
  }

  if (!token) {
    return next(new ApiError(401, "Authorization token is required"));
  }

  try {
    const payload = verifyAccessToken(token);

    // Support both current format (userId) and legacy format (id)
    const resolvedUserId = payload.userId || payload.id;
    if (!resolvedUserId) {
      return next(new ApiError(401, 'Invalid token: missing user identity'));
    }

    // Try user cache before hitting DB
    const userCacheKey = `auth:user:${resolvedUserId}:${payload.sessionId || 'nosession'}`;
    const cachedUser = l1.get(userCacheKey);

    if (cachedUser) {
      const user = cachedUser;
      if (user.status !== "ACTIVE" || user.isDeleted === true) {
        return next(new ApiError(401, "Inactive or deleted user account"));
      }
      req.user = user;
      // Update session last active asynchronously
      if (payload.sessionId) {
        prisma.session.update({
          where: { id: payload.sessionId },
          data: { lastActive: new Date() },
        }).catch(() => {});
      }
      return next();
    }

    // Cache miss — fetch from DB
    if (payload.sessionId) {
      const session = await prisma.session.findUnique({
        where: { id: payload.sessionId },
      });
      if (!session) {
        return next(new ApiError(401, "Session has been revoked or expired"));
      }
      // Update last active
      prisma.session.update({
        where: { id: payload.sessionId },
        data: { lastActive: new Date() },
      }).catch(() => {});
    }

    const userRecord = await prisma.user.findUnique({
      where: { id: resolvedUserId },
    });

    if (!userRecord) {
      return next(new ApiError(401, "Invalid user"));
    }

    const user = { ...userRecord, sessionId: payload.sessionId || null };

    if (user.status !== "ACTIVE" || user.isDeleted === true) {
      return next(new ApiError(401, "Inactive or deleted user account"));
    }

    // Cache for 2 minutes
    const userCacheWriteKey = `auth:user:${resolvedUserId}:${payload.sessionId || 'nosession'}`;
    try {
      l1.set(userCacheWriteKey, user, USER_CACHE_TTL * 1000);
    } catch (l1Err) {
      console.warn('[AuthCache] Failed to cache user in L1 cache:', l1Err.message);
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

async function invalidateUserCache(userId) {
  try {
    l1.deletePattern(`auth:user:${userId}:`);
  } catch { /* ignore */ }
}

module.exports = {
  auth,
  requireRoles,
  invalidateUserCache,
};

