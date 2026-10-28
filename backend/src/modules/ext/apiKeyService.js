'use strict';

/**
 * backend/src/modules/ext/apiKeyService.js
 *
 * Core service for External API Key generation, verification, hashing,
 * rotation, revocation, caching, and usage aggregation.
 */

const crypto = require('crypto');
const prisma = require('../../config/db');
const { ApiError } = require('../../utils/errors');

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function randomBase62(len) {
  const bytes = crypto.randomBytes(len);
  let str = '';
  for (let i = 0; i < len; i++) {
    str += BASE62_CHARS[bytes[i] % 62];
  }
  return str;
}

function getPepper() {
  const pepper = process.env.API_KEY_PEPPER;
  if (!pepper || pepper.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[ExternalAPI] API_KEY_PEPPER environment variable (32+ chars) is required');
    }
    // Fallback for local tests if not set
    return 'default_ats_external_api_pepper_32chars_test_key_dev';
  }
  return pepper;
}

function hashApiKey(fullKey, pepper = getPepper()) {
  return crypto.createHash('sha256').update(pepper + fullKey).digest('hex');
}

// In-memory cache for validated keys (TTL <= 60 seconds)
const keyCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

// Throttled lastUsedAt updates (at most once every 60s per keyId)
const lastUsedThrottle = new Map();

// In-memory usage aggregation: key -> { apiKeyId, date, route, statusClass, count, latencies: [] }
const usageAggregation = new Map();

/**
 * Generate a new API Key: tos_<env>_<keyId8>_<secret32>
 */
async function generateApiKey({
  name,
  scopes = ['candidates:read', 'interviews:read', 'drives:read'],
  environment = 'live',
  expiresInDays = 90,
  expiresAt: explicitExpiresAt = null,
  allowedIps = null,
  rateLimitPerMinute = 60,
  createdById,
  orgId = 'defaultOrg',
  ip = null
}) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new ApiError(400, 'API key name is required', 'INVALID_PARAMETER');
  }

  const validEnvs = ['live', 'test'];
  const env = validEnvs.includes(environment) ? environment : 'live';

  const keyId8 = randomBase62(8);
  const secret32 = randomBase62(32);
  const prefix = `tos_${env}_${keyId8}`;
  const fullKey = `${prefix}_${secret32}`;

  const pepper = getPepper();
  const keyHash = hashApiKey(fullKey, pepper);

  let expiresAt = null;
  if (explicitExpiresAt) {
    expiresAt = new Date(explicitExpiresAt);
  } else if (expiresInDays !== null && expiresInDays !== undefined && !isNaN(expiresInDays)) {
    expiresAt = new Date(Date.now() + Number(expiresInDays) * 24 * 60 * 60 * 1000);
  }

  const apiKey = await prisma.apiKey.create({
    data: {
      name: name.trim(),
      prefix,
      keyHash,
      scopes: Array.isArray(scopes) ? scopes : [],
      environment: env,
      allowedIps: Array.isArray(allowedIps) && allowedIps.length > 0 ? allowedIps : null,
      rateLimitPerMinute: Number(rateLimitPerMinute) || 60,
      expiresAt,
      createdById,
      orgId,
    }
  });

  // Record Audit Event
  await prisma.apiKeyAuditEvent.create({
    data: {
      apiKeyId: apiKey.id,
      action: 'created',
      actorId: createdById,
      ip,
      metadata: {
        name: apiKey.name,
        prefix: apiKey.prefix,
        scopes: apiKey.scopes,
        environment: apiKey.environment,
        expiresAt: apiKey.expiresAt,
      }
    }
  }).catch(err => console.error('[ApiKeyAudit] Failed to log creation:', err.message));

  return {
    fullKey, // SHOWN ONCE ONLY
    apiKey: {
      id: apiKey.id,
      orgId: apiKey.orgId,
      name: apiKey.name,
      prefix: apiKey.prefix,
      scopes: apiKey.scopes,
      environment: apiKey.environment,
      allowedIps: apiKey.allowedIps,
      rateLimitPerMinute: apiKey.rateLimitPerMinute,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    }
  };
}

/**
 * Verify a full API key from request
 */
async function verifyApiKey(rawKey, clientIp = null) {
  if (!rawKey || typeof rawKey !== 'string') {
    throw new ApiError(401, 'API key is missing', 'API_KEY_MISSING');
  }

  const trimmed = rawKey.trim();
  const parts = trimmed.split('_');

  // Expected format: tos_<env>_<keyId8>_<secret32>
  if (parts.length < 4 || parts[0] !== 'tos') {
    throw new ApiError(401, 'Invalid API key format', 'API_KEY_INVALID');
  }

  const env = parts[1];
  const keyId8 = parts[2];
  const prefix = `tos_${env}_${keyId8}`;

  // Check in-memory key cache first
  const now = Date.now();
  let keyRecord = null;
  const cached = keyCache.get(prefix);

  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    keyRecord = cached.keyRecord;
  } else {
    keyRecord = await prisma.apiKey.findUnique({
      where: { prefix }
    });
    if (keyRecord) {
      keyCache.set(prefix, { keyRecord, cachedAt: now });
    }
  }

  if (!keyRecord) {
    throw new ApiError(401, 'Invalid API key', 'API_KEY_INVALID');
  }

  // Cryptographic constant-time hash comparison
  const pepper = getPepper();
  const computedHashHex = hashApiKey(trimmed, pepper);

  const hashBufA = Buffer.from(computedHashHex, 'hex');
  const hashBufB = Buffer.from(keyRecord.keyHash, 'hex');

  if (hashBufA.length !== hashBufB.length || !crypto.timingSafeEqual(hashBufA, hashBufB)) {
    throw new ApiError(401, 'Invalid API key', 'API_KEY_INVALID');
  }

  // Check revocation
  if (keyRecord.revokedAt) {
    throw new ApiError(401, `API key was revoked: ${keyRecord.revokeReason || 'Revoked by administrator'}`, 'API_KEY_REVOKED');
  }

  // Check expiration
  if (keyRecord.expiresAt && new Date(keyRecord.expiresAt) < new Date()) {
    throw new ApiError(401, 'API key has expired', 'API_KEY_EXPIRED');
  }

  // Check IP allowlist (if configured)
  if (Array.isArray(keyRecord.allowedIps) && keyRecord.allowedIps.length > 0 && clientIp) {
    const isAllowed = keyRecord.allowedIps.some(ipPattern => {
      if (ipPattern === clientIp) return true;
      // Handle simple wildcard e.g. 192.168.1.*
      if (ipPattern.endsWith('*')) {
        return clientIp.startsWith(ipPattern.slice(0, -1));
      }
      return false;
    });
    if (!isAllowed) {
      throw new ApiError(403, `Client IP ${clientIp} is not authorized for this API key`, 'API_KEY_IP_NOT_ALLOWED');
    }
  }

  // Update lastUsedAt in background (throttled to at most once per 60 seconds)
  const lastActive = lastUsedThrottle.get(keyRecord.id);
  if (!lastActive || now - lastActive > 60 * 1000) {
    lastUsedThrottle.set(keyRecord.id, now);
    prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: {
        lastUsedAt: new Date(),
        lastUsedIp: clientIp || null,
      }
    }).catch(err => console.warn('[ApiKey] Failed to update lastUsedAt:', err.message));
  }

  const scopes = Array.isArray(keyRecord.scopes) ? keyRecord.scopes : [];

  return {
    keyId: keyRecord.id,
    orgId: keyRecord.orgId || 'defaultOrg',
    name: keyRecord.name,
    prefix: keyRecord.prefix,
    scopes,
    environment: keyRecord.environment,
    rateLimitPerMinute: keyRecord.rateLimitPerMinute || 60,
  };
}

/**
 * Revoke an API Key
 */
async function revokeApiKey(keyId, revokedById, reason = 'Revoked by admin', ip = null) {
  const existing = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!existing) throw new ApiError(404, 'API key not found', 'NOT_FOUND');

  const updated = await prisma.apiKey.update({
    where: { id: keyId },
    data: {
      revokedAt: new Date(),
      revokedById,
      revokeReason: reason,
    }
  });

  // Evict from cache immediately
  keyCache.delete(existing.prefix);

  await prisma.apiKeyAuditEvent.create({
    data: {
      apiKeyId: keyId,
      action: 'revoked',
      actorId: revokedById,
      ip,
      metadata: { reason }
    }
  }).catch(() => {});

  return updated;
}

/**
 * Rotate an API Key (creates new key, sets grace period on old key)
 */
async function rotateApiKey(keyId, actorId, { gracePeriodHours = 24 } = {}, ip = null) {
  const oldKey = await prisma.apiKey.findUnique({ where: { id: keyId } });
  if (!oldKey) throw new ApiError(404, 'API key not found', 'NOT_FOUND');
  if (oldKey.revokedAt) throw new ApiError(400, 'Cannot rotate a revoked API key', 'INVALID_OPERATION');

  // Set old key expiry to grace period
  const graceExpiry = new Date(Date.now() + (gracePeriodHours * 60 * 60 * 1000));
  await prisma.apiKey.update({
    where: { id: keyId },
    data: {
      expiresAt: graceExpiry,
    }
  });
  keyCache.delete(oldKey.prefix);

  // Generate replacement key with identical settings
  const result = await generateApiKey({
    name: `${oldKey.name} (Rotated)`,
    scopes: oldKey.scopes,
    environment: oldKey.environment,
    expiresInDays: 90,
    allowedIps: oldKey.allowedIps,
    rateLimitPerMinute: oldKey.rateLimitPerMinute,
    createdById: actorId,
    orgId: oldKey.orgId,
    ip
  });

  await prisma.apiKeyAuditEvent.create({
    data: {
      apiKeyId: oldKey.id,
      action: 'rotated',
      actorId,
      ip,
      metadata: {
        newKeyId: result.apiKey.id,
        newPrefix: result.apiKey.prefix,
        graceExpiry
      }
    }
  }).catch(() => {});

  return {
    newKey: result,
    oldKeyGraceExpiry: graceExpiry,
  };
}

/**
 * Record usage in-memory and aggregate for periodic flushing
 */
function recordUsage(apiKeyId, route, statusCode, latencyMs) {
  if (!apiKeyId) return;

  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const statusClass = statusCode >= 500 ? '5xx' : statusCode >= 400 ? '4xx' : '2xx';
  const aggKey = `${apiKeyId}:${dateStr}:${route}:${statusClass}`;

  let agg = usageAggregation.get(aggKey);
  if (!agg) {
    agg = {
      apiKeyId,
      date: dateStr,
      route,
      statusClass,
      count: 0,
      latencies: [],
    };
    usageAggregation.set(aggKey, agg);
  }

  agg.count++;
  if (agg.latencies.length < 200) {
    agg.latencies.push(latencyMs);
  }
}

/**
 * Flush aggregated usage to database every minute
 */
async function flushUsageAggregation() {
  if (usageAggregation.size === 0) return;

  const snapshot = Array.from(usageAggregation.values());
  usageAggregation.clear();

  for (const item of snapshot) {
    try {
      let p95 = 0;
      if (item.latencies.length > 0) {
        item.latencies.sort((a, b) => a - b);
        const p95Idx = Math.floor(item.latencies.length * 0.95);
        p95 = item.latencies[p95Idx] || item.latencies[item.latencies.length - 1];
      }

      await prisma.apiKeyUsageDaily.upsert({
        where: {
          apiKeyId_date_route_statusClass: {
            apiKeyId: item.apiKeyId,
            date: item.date,
            route: item.route,
            statusClass: item.statusClass,
          }
        },
        create: {
          apiKeyId: item.apiKeyId,
          date: item.date,
          route: item.route,
          statusClass: item.statusClass,
          count: item.count,
          p95LatencyMs: p95,
        },
        update: {
          count: { increment: item.count },
          p95LatencyMs: p95,
        }
      });
    } catch (err) {
      console.warn('[ApiKeyUsage] Failed to flush item:', err.message);
    }
  }
}

// Background flush interval (every 60 seconds)
const flushInterval = setInterval(flushUsageAggregation, 60 * 1000);
if (flushInterval.unref) flushInterval.unref();

/**
 * Signed Resume URL Token Generator & Verifier
 */
function generateSignedResumeToken(fileMetaId, candidateId, expiryMinutes = 15) {
  const pepper = getPepper();
  const expiresAt = Date.now() + (expiryMinutes * 60 * 1000);
  const payload = `${fileMetaId}:${candidateId}:${expiresAt}`;
  const sig = crypto.createHmac('sha256', pepper).update(payload).digest('hex');
  return Buffer.from(`${payload}:${sig}`).toString('base64url');
}

function verifySignedResumeToken(token) {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const [fileMetaId, candidateId, expiresAtStr, sig] = raw.split(':');
    if (!fileMetaId || !expiresAtStr || !sig) {
      throw new ApiError(401, 'Invalid resume download token', 'INVALID_TOKEN');
    }

    const expiresAt = parseInt(expiresAtStr, 10);
    if (Date.now() > expiresAt) {
      throw new ApiError(401, 'Resume download link has expired. Please request a fresh link.', 'LINK_EXPIRED');
    }

    const pepper = getPepper();
    const payload = `${fileMetaId}:${candidateId}:${expiresAtStr}`;
    const expectedSig = crypto.createHmac('sha256', pepper).update(payload).digest('hex');

    const bufA = Buffer.from(sig, 'hex');
    const bufB = Buffer.from(expectedSig, 'hex');

    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      throw new ApiError(401, 'Invalid resume download signature', 'INVALID_SIGNATURE');
    }

    return { fileMetaId, candidateId };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(401, 'Malformed resume download token', 'INVALID_TOKEN');
  }
}

module.exports = {
  generateApiKey,
  verifyApiKey,
  revokeApiKey,
  rotateApiKey,
  recordUsage,
  flushUsageAggregation,
  generateSignedResumeToken,
  verifySignedResumeToken,
  hashApiKey,
  getPepper,
  keyCache,
};
