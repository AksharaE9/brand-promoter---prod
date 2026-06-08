'use strict';
const { db: firestore } = require("../config/firebase");
const { verifyAccessToken } = require("../utils/jwt");
const { ApiError } = require("../utils/errors");
const redis = require("../utils/redisClient");

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
    
    // Try user cache before hitting Firestore
    const userCacheKey = `auth:user:${payload.userId}:${payload.sessionId || 'nosession'}`;
    let cachedUser = null;
    try {
      cachedUser = await redis.get(userCacheKey);
    } catch (redisErr) {
      console.warn('[AuthCache] Failed to get user from Redis cache, falling back to Firestore:', redisErr.message);
    }

    if (cachedUser) {
      const user = JSON.parse(cachedUser);
      if (user.status !== "ACTIVE" || user.isDeleted === true) {
        return next(new ApiError(401, "Inactive or deleted user account"));
      }
      req.user = user;
      // Update session last active asynchronously
      if (payload.sessionId) {
        firestore.collection("sessions").doc(payload.sessionId).update({
          lastActive: new Date().toISOString()
        }).catch(() => {});
      }
      return next();
    }

    // Cache miss — fetch from Firestore
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

    // Cache for 2 minutes — fast path for subsequent requests
    try {
      await redis.setex(userCacheKey, USER_CACHE_TTL, JSON.stringify(user));
    } catch (redisErr) {
      console.warn('[AuthCache] Failed to cache user in Redis:', redisErr.message);
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
    let cursor = '0';
    const pattern = `auth:user:${userId}:*`;
    const toDelete = [];
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', '100');
      cursor = next;
      if (keys.length) toDelete.push(...keys);
    } while (cursor !== '0');

    if (toDelete.length > 0) {
      await redis.del(...toDelete);
    }
  } catch { /* ignore */ }
}

module.exports = {
  auth,
  requireRoles,
  invalidateUserCache,
};
