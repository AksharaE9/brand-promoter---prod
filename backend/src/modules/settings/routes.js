const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");

const router = express.Router();
router.use(auth);

const DEFAULT_ORG_ID = "defaultOrg";

// Helper to initialize organization if not exists
async function getOrCreateOrg(orgId) {
  const orgRef = firestore.collection("organizations").doc(orgId);
  const doc = await orgRef.get();
  if (doc.exists) {
    return doc.data();
  }

  const defaultOrg = {
    name: "My Organization",
    contactInfo: {
      primaryEmail: null,
      secondaryEmail: null,
      primaryPhone: null,
      secondaryPhone: null,
      address: null,
      city: null,
      state: null,
      country: null,
      pincode: null,
      website: null
    },
    branding: {
      logoKey: null,
      primaryColor: '#3B82F6',
      companyTagline: null
    },
    preferences: {
      timezone: 'Asia/Kolkata',
      dateFormat: 'DD/MM/YYYY',
      currency: 'INR',
      language: 'en'
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  await orgRef.set(defaultOrg);
  return defaultOrg;
}

// GET /profile
router.get("/profile", asyncHandler(async (req, res) => {
  const userDoc = await firestore.collection("users").doc(req.user.id).get();
  if (!userDoc.exists) throw new ApiError(404, "User not found");
  const userData = userDoc.data();
  delete userData.passwordHash;
  delete userData.password;
  res.json({ success: true, data: { id: userDoc.id, ...userData } });
}));

// PUT /profile
router.put("/profile", asyncHandler(async (req, res) => {
  const { fullName, workPhone, bio, profilePhoto } = req.body;

  if (!fullName || fullName.trim().length === 0) {
    throw new ApiError(400, "Full Name is required");
  }
  if (fullName.trim().length > 100) {
    throw new ApiError(400, "Full Name cannot exceed 100 characters");
  }
  if (workPhone && !/^\d{10}$/.test(workPhone)) {
    throw new ApiError(400, "Work Phone must be a 10-digit number");
  }

  const updatePayload = {
    fullName: fullName.trim(),
    phone: workPhone ? workPhone.trim() : null, // sync phone
    workPhone: workPhone ? workPhone.trim() : null,
    bio: bio ? bio.trim().slice(0, 500) : null,
    profilePhotoFileId: profilePhoto || null,
    updatedAt: new Date().toISOString()
  };

  const userRef = firestore.collection("users").doc(req.user.id);
  const oldDoc = await userRef.get();
  const before = oldDoc.data();

  await userRef.update(updatePayload);

  const updatedDoc = await userRef.get();
  const after = updatedDoc.data();
  delete after.passwordHash;
  delete after.password;

  const changedFields = ["fullName", "workPhone", "phone", "bio", "profilePhotoFileId"].filter(
    k => before[k] !== updatePayload[k === "profilePhotoFileId" ? "profilePhotoFileId" : k]
  );

  await logAudit({
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "USER_PROFILE_UPDATED",
    entityType: "USER",
    entityId: req.user.id,
    entityName: req.user.fullName,
    metadata: {
      before: { fullName: before.fullName, phone: before.phone, bio: before.bio, profilePhotoFileId: before.profilePhotoFileId },
      after: { fullName: after.fullName, phone: after.phone, bio: after.bio, profilePhotoFileId: after.profilePhotoFileId },
      changedFields,
      entityName: req.user.fullName
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"]
  });

  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const inv = require("../../utils/cacheInvalidation");
  await inv.user(orgId, req.user.id);

  const sse = require("../../utils/sse");
  sse.sendToUser(req.user.id, 'PROFILE_UPDATED', {
    userId: req.user.id,
    changes: changedFields,
  });

  res.json({ success: true, data: { id: req.user.id, ...after } });
}));

// GET /organization (SUPER_ADMIN only)
router.get("/organization", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const org = await getOrCreateOrg(orgId);
  res.json({ success: true, data: org });
}));

// PUT /organization (SUPER_ADMIN only)
router.put("/organization", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const { name, contactInfo = {}, branding = {}, preferences = {} } = req.body;

  if (!name || name.trim().length === 0) {
    throw new ApiError(400, "Organization name is required");
  }

  // Validate contact info emails
  if (contactInfo.primaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInfo.primaryEmail)) {
    throw new ApiError(400, "Invalid primary email format");
  }
  if (contactInfo.secondaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInfo.secondaryEmail)) {
    throw new ApiError(400, "Invalid secondary email format");
  }

  // Validate website URL
  if (contactInfo.website && !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(contactInfo.website)) {
    throw new ApiError(400, "Invalid website URL format");
  }

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
      website: contactInfo.website || null
    },
    branding: {
      logoKey: branding.logoKey || null,
      primaryColor: branding.primaryColor || '#3B82F6',
      companyTagline: branding.companyTagline || null
    },
    preferences: {
      timezone: preferences.timezone || 'Asia/Kolkata',
      dateFormat: preferences.dateFormat || 'DD/MM/YYYY',
      currency: preferences.currency || 'INR',
      language: preferences.language || 'en'
    },
    updatedAt: new Date().toISOString()
  };

  const orgRef = firestore.collection("organizations").doc(orgId);
  await orgRef.update(updatePayload);

  // Diff changed fields
  const changedFields = [];
  const before = {};
  const after = {};

  ["name", "contactInfo", "branding", "preferences"].forEach(field => {
    if (JSON.stringify(oldOrg[field]) !== JSON.stringify(updatePayload[field])) {
      changedFields.push(field);
      before[field] = oldOrg[field];
      after[field] = updatePayload[field];
    }
  });

  await logAudit({
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "ORG_SETTINGS_UPDATED",
    entityType: "ORGANIZATION",
    entityId: orgId,
    entityName: updatePayload.name,
    metadata: {
      before,
      after,
      changedFields,
      entityName: updatePayload.name
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"]
  });

  const inv = require("../../utils/cacheInvalidation");
  await inv.settings(orgId);

  const sse = require("../../utils/sse");
  sse.broadcastToOrg(orgId, 'ORG_SETTINGS_UPDATED', {
    changes: changedFields,
    updatedBy: req.user.id,
  });

  res.json({ success: true, data: updatePayload });
}));

// GET /contact (All Roles)
router.get("/contact", asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const org = await getOrCreateOrg(orgId);
  res.json({ success: true, data: org.contactInfo || {} });
}));

// PUT /contact (SUPER_ADMIN only)
router.put("/contact", requireRoles("SUPER_ADMIN"), asyncHandler(async (req, res) => {
  const orgId = req.user.organizationId || DEFAULT_ORG_ID;
  const contactInfo = req.body;

  // Validate contact info emails
  if (contactInfo.primaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInfo.primaryEmail)) {
    throw new ApiError(400, "Invalid primary email format");
  }
  if (contactInfo.secondaryEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInfo.secondaryEmail)) {
    throw new ApiError(400, "Invalid secondary email format");
  }

  // Validate website URL
  if (contactInfo.website && !/^https?:\/\/[^\s$.?#].[^\s]*$/.test(contactInfo.website)) {
    throw new ApiError(400, "Invalid website URL format");
  }

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
    website: contactInfo.website || null
  };

  const orgRef = firestore.collection("organizations").doc(orgId);
  await orgRef.update({
    contactInfo: updatedContact,
    updatedAt: new Date().toISOString()
  });

  await logAudit({
    actorUserId: req.user.id,
    actorName: req.user.fullName,
    action: "ORG_CONTACT_UPDATED",
    entityType: "ORGANIZATION",
    entityId: orgId,
    entityName: oldOrg.name,
    metadata: {
      before: { contactInfo: oldOrg.contactInfo },
      after: { contactInfo: updatedContact },
      changedFields: ["contactInfo"],
      entityName: oldOrg.name
    },
    ipAddress: req.ip,
    userAgent: req.headers["user-agent"]
  });

  const inv = require("../../utils/cacheInvalidation");
  await inv.settings(orgId);

  const sse = require("../../utils/sse");
  sse.broadcastToOrg(orgId, 'ORG_CONTACT_UPDATED', {
    updatedBy: req.user.id,
  });

  res.json({ success: true, data: updatedContact });
}));

module.exports = router;
