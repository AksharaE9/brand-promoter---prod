const express = require("express");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");

const router = express.Router();
router.use(auth);

const DEFAULT_ORG_ID = "defaultOrg";

// Organization settings are stored in Redis as JSON since they're a small blob
// This avoids needing an Organization table in SQL while retaining fast reads.

const ORG_CACHE_PREFIX = "org:settings:";
const ORG_CACHE_TTL = 3600; // 1 hour

const DEFAULT_ORG = {
  name: "My Organization",
  contactInfo: {
    primaryEmail: null, secondaryEmail: null, primaryPhone: null,
    secondaryPhone: null, address: null, city: null, state: null,
    country: null, pincode: null, website: null,
  },
  branding: { logoKey: null, primaryColor: "#3B82F6", companyTagline: null },
  preferences: { timezone: "Asia/Kolkata", dateFormat: "DD/MM/YYYY", currency: "INR", language: "en" },
};

async function getOrCreateOrg(orgId) {
  let org = await prisma.organization.findUnique({
    where: { id: orgId }
  });
  if (!org) {
    org = await prisma.organization.create({
      data: {
        id: orgId,
        name: DEFAULT_ORG.name,
        contactInfo: DEFAULT_ORG.contactInfo,
        branding: DEFAULT_ORG.branding,
        preferences: DEFAULT_ORG.preferences,
      }
    });
  }
  return org;
}

async function saveOrg(orgId, data) {
  const saved = await prisma.organization.upsert({
    where: { id: orgId },
    update: {
      name: data.name,
      contactInfo: data.contactInfo,
      branding: data.branding,
      preferences: data.preferences,
    },
    create: {
      id: orgId,
      name: data.name,
      contactInfo: data.contactInfo,
      branding: data.branding,
      preferences: data.preferences,
    }
  });
  return saved;
}

// GET /settings/profile
router.get("/profile", asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: {
      id: true, fullName: true, email: true, phone: true,
      role: true, status: true, organizationId: true,
      userType: true, department: true, designation: true,
      profilePhotoUrl: true, createdAt: true, updatedAt: true,
    },
  });
  if (!user) throw new ApiError(404, "User not found");
  res.json({ success: true, data: user });
}));

// PUT /settings/profile
router.put("/profile", asyncHandler(async (req, res) => {
  const { fullName, workPhone, bio, profilePhoto } = req.body;

  if (!fullName || fullName.trim().length === 0) throw new ApiError(400, "Full Name is required");
  if (fullName.trim().length > 100) throw new ApiError(400, "Full Name cannot exceed 100 characters");
  if (workPhone && !/^\d{10}$/.test(workPhone)) throw new ApiError(400, "Work Phone must be 10 digits");

  const before = await prisma.user.findUnique({ where: { id: req.user.id } });

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data: {
      fullName: fullName.trim(),
      phone: workPhone ? workPhone.trim() : null,
    },
    select: {
      id: true, fullName: true, email: true, phone: true,
      role: true, status: true, organizationId: true,
      profilePhotoUrl: true, createdAt: true, updatedAt: true,
    },
  });

  logAudit({
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "USER_PROFILE_UPDATED",
    entityType: "USER",
    entityId: req.user.id,
    oldData: { fullName: before?.fullName, phone: before?.phone },
    newData: { fullName: updated.fullName, phone: updated.phone },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const inv = require("../../utils/cacheInvalidation");
  await inv.user(orgId, req.user.id);

  const sse = require("../../utils/sse");
  sse.sendToUser(req.user.id, "PROFILE_UPDATED", { userId: req.user.id });

  res.json({ success: true, data: updated });
}));

// GET /settings/organization (SUPER_ADMIN)
router.get("/organization", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const org = await getOrCreateOrg(orgId);
  res.json({ success: true, data: org });
}));

// PUT /settings/organization (SUPER_ADMIN)
router.put("/organization", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const { name, contactInfo = {}, branding = {}, preferences = {} } = req.body;

  if (!name || name.trim().length === 0) throw new ApiError(400, "Organization name is required");

  if (contactInfo.primaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInfo.primaryEmail))
    throw new ApiError(400, "Invalid primary email format");
  if (contactInfo.website && !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(contactInfo.website))
    throw new ApiError(400, "Invalid website URL format");

  const oldOrg = await getOrCreateOrg(orgId);
  const updatePayload = {
    name: name.trim(),
    contactInfo: {
      primaryEmail: contactInfo.primaryEmail || null,
      secondaryEmail: contactInfo.secondaryEmail || null,
      primaryPhone: contactInfo.primaryPhone || null,
      secondaryPhone: contactInfo.secondaryPhone || null,
      address: contactInfo.address || null,
      city: contactInfo.city || null,
      state: contactInfo.state || null,
      country: contactInfo.country || null,
      pincode: contactInfo.pincode || null,
      website: contactInfo.website || null,
    },
    branding: {
      logoKey: branding.logoKey || null,
      primaryColor: branding.primaryColor || "#3B82F6",
      companyTagline: branding.companyTagline || null,
    },
    preferences: {
      timezone: preferences.timezone || "Asia/Kolkata",
      dateFormat: preferences.dateFormat || "DD/MM/YYYY",
      currency: preferences.currency || "INR",
      language: preferences.language || "en",
    },
  };

  const saved = await saveOrg(orgId, { ...oldOrg, ...updatePayload });

  const changedFields = ["name", "contactInfo", "branding", "preferences"].filter(
    f => JSON.stringify(oldOrg[f]) !== JSON.stringify(updatePayload[f])
  );

  logAudit({
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "ORG_SETTINGS_UPDATED",
    entityType: "ORGANIZATION",
    entityId: orgId,
    oldData: { name: oldOrg.name },
    newData: { name: updatePayload.name },
    metadata: { changedFields, entityName: updatePayload.name },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  const inv = require("../../utils/cacheInvalidation");
  await inv.settings(orgId);

  const sse = require("../../utils/sse");
  sse.broadcastToOrg(orgId, "ORG_SETTINGS_UPDATED", { changes: changedFields, updatedBy: req.user.id });

  res.json({ success: true, data: saved });
}));

// GET /settings/contact
router.get("/contact", asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const org = await getOrCreateOrg(orgId);
  res.json({ success: true, data: org.contactInfo || {} });
}));

// PUT /settings/contact (SUPER_ADMIN)
router.put("/contact", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const contactInfo = req.body;

  if (contactInfo.primaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInfo.primaryEmail))
    throw new ApiError(400, "Invalid primary email format");
  if (contactInfo.website && !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(contactInfo.website))
    throw new ApiError(400, "Invalid website URL format");

  const oldOrg = await getOrCreateOrg(orgId);
  const updatedContact = {
    primaryEmail: contactInfo.primaryEmail || null,
    secondaryEmail: contactInfo.secondaryEmail || null,
    primaryPhone: contactInfo.primaryPhone || null,
    secondaryPhone: contactInfo.secondaryPhone || null,
    address: contactInfo.address || null,
    city: contactInfo.city || null,
    state: contactInfo.state || null,
    country: contactInfo.country || null,
    pincode: contactInfo.pincode || null,
    website: contactInfo.website || null,
  };

  await saveOrg(orgId, { ...oldOrg, contactInfo: updatedContact });

  logAudit({
    actorUserId: req.user.id,
    action: "ORG_CONTACT_UPDATED",
    entityType: "ORGANIZATION",
    entityId: orgId,
    oldData: { contactInfo: oldOrg.contactInfo },
    newData: { contactInfo: updatedContact },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"],
  });

  const inv = require("../../utils/cacheInvalidation");
  await inv.settings(orgId);

  const sse = require("../../utils/sse");
  sse.broadcastToOrg(orgId, "ORG_CONTACT_UPDATED", { updatedBy: req.user.id });

  res.json({ success: true, data: updatedContact });
}));

module.exports = router;
