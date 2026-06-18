'use strict';
/**
 * /api/companies
 * ──────────────────────────────────────────────────────────────────────────
 * Provides a fast, cached lookup of company names for the candidate combobox.
 *
 * Companies are NOT stored in a separate DB table — they live in the
 * Organization.preferences JSON field as an array of strings under the key
 * "companies". This avoids a new Prisma migration while giving identical
 * frontend UX.
 *
 * On every candidate create/update that sends a new company name the backend
 * upserts that name into the org preferences array so future dropdowns show it.
 * ──────────────────────────────────────────────────────────────────────────
 */
const express = require('express');
const router  = express.Router();
const prisma  = require('../../config/db');
const { auth, requireRoles } = require('../../middleware/auth');
const { asyncHandler, ApiError } = require('../../utils/errors');
const { getCached, deleteCache } = require('../../utils/cache');

router.use(auth);

// ── Helpers ────────────────────────────────────────────────────────────────

const DEFAULT_COMPANIES = ['Akshara Enterprises', 'Vruksha Organics'];

/**
 * Read the companies list from org preferences.
 * Falls back to the two known defaults if the org has no preferences yet.
 */
async function getCompaniesForOrg(orgId) {
  const cacheKey = `companies:list:${orgId}`;

  return getCached(cacheKey, async () => {
    // Try to fetch from the organization record
    let org = null;
    try {
      org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { preferences: true }
      });
    } catch (_) { /* org may not exist yet */ }

    let companies = DEFAULT_COMPANIES;
    if (org?.preferences) {
      const prefs = typeof org.preferences === 'string'
        ? JSON.parse(org.preferences)
        : org.preferences;
      if (Array.isArray(prefs.companies) && prefs.companies.length > 0) {
        // Merge stored list with defaults, deduplicate, sort
        const merged = new Set([...DEFAULT_COMPANIES, ...prefs.companies]);
        companies = [...merged].sort((a, b) => a.localeCompare(b));
      }
    }

    // Return as id+name objects so the frontend can use the same shape
    return companies.map((name, idx) => ({ id: String(idx + 1), name }));
  }, 300_000); // 5-minute cache
}

/**
 * Upsert a company name into the org preferences array.
 * Fire-and-forget safe — called from within setImmediate.
 */
async function upsertCompanyForOrg(orgId, name) {
  if (!name || !name.trim()) return;
  const trimmed = name.trim();

  try {
    // Read current prefs
    let org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { preferences: true }
    });
    let prefs = {};
    if (org?.preferences) {
      prefs = typeof org.preferences === 'string'
        ? JSON.parse(org.preferences)
        : { ...org.preferences };
    }

    const current = Array.isArray(prefs.companies) ? prefs.companies : [...DEFAULT_COMPANIES];
    if (current.includes(trimmed)) return; // already exists

    prefs.companies = [...new Set([...current, trimmed])].sort((a, b) => a.localeCompare(b));

    if (org) {
      await prisma.organization.update({
        where: { id: orgId },
        data: { preferences: prefs }
      });
    } else {
      await prisma.organization.create({
        data: { id: orgId, name: 'My Organization', preferences: prefs }
      });
    }

    // Invalidate cache so next GET returns fresh list
    await deleteCache(`companies:list:${orgId}`);
  } catch (err) {
    console.error('[Companies] upsertCompanyForOrg failed:', err.message);
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────

/**
 * GET /api/companies
 * Returns all companies for the requesting org, cached 5 minutes.
 * Used by the frontend combobox on every form open.
 */
router.get(
  '/',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const t0 = Date.now();
    const orgId = req.user.organizationId || 'defaultOrg';
    const companies = await getCompaniesForOrg(orgId);

    res.set('X-Response-Time', `${Date.now() - t0}ms`);
    res.json({ success: true, data: companies });
  })
);

/**
 * POST /api/companies
 * Explicitly add a new company name (called when user types a brand-new name
 * and clicks "+ Add as new company" in the combobox, separate from candidate creation).
 * The response immediately returns the updated list so the dropdown refreshes.
 */
router.post(
  '/',
  requireRoles('SUPER_ADMIN', 'RECRUITER', 'INTERVIEWER'),
  asyncHandler(async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) throw new ApiError(400, 'Company name is required');

    const orgId = req.user.organizationId || 'defaultOrg';
    await upsertCompanyForOrg(orgId, name.trim());

    // Return the freshly updated list so the frontend can update the dropdown immediately
    const companies = await getCompaniesForOrg(orgId);
    res.status(201).json({ success: true, data: companies });
  })
);

module.exports = router;
module.exports.upsertCompanyForOrg = upsertCompanyForOrg;
module.exports.getCompaniesForOrg  = getCompaniesForOrg;
