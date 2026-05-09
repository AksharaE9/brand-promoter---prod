const express = require("express");
const { db: firestore } = require("../../config/firebase");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const xlsx = require("xlsx");
const PDFDocument = require("pdfkit");
const multer = require("multer");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(auth);

// --- Activity Helper ---
async function logActivity(productId, action, details, actorId) {
  await firestore.collection("sales_activities").add({
    productId,
    action,
    details,
    actorId,
    createdAt: new Date().toISOString()
  });
}

// --- Dashboard ---
router.get(
  "/dashboard",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const isSalesperson = req.user.role === "RECRUITER";
    const userId = req.user.id;

    const productsSnap = await firestore.collection("products").get();
    let products = productsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (isSalesperson) {
      products = products.filter(p => p.createdById === userId);
    }

    const trackingSnap = await firestore.collection("sales_tracking").get();
    let tracking = trackingSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (isSalesperson) {
      const productIds = products.map(p => p.id);
      tracking = tracking.filter(t => productIds.includes(t.productId));
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    const conversions = tracking.filter(t => t.status === "CONVERTED").length;
    const pendingFollowups = tracking.filter(t => 
      t.status !== "CONVERTED" && 
      t.status !== "REJECTED" && 
      t.followUpDate && t.followUpDate <= new Date().toISOString()
    ).length;

    const addedToday = products.filter(p => p.createdAt >= todayStr).length;

    const statusCounts = {};
    tracking.forEach(t => {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    });
    const statusDistribution = Object.keys(statusCounts).map(status => ({
      status,
      _count: { _all: statusCounts[status] }
    }));

    const activitySnap = await firestore.collection("sales_activities")
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();
    const recentActivity = activitySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const totalTracked = tracking.length;
    const conversionRate = totalTracked > 0 ? ((conversions / totalTracked) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        totalProducts: products.length,
        conversions,
        conversionRate,
        pendingFollowups,
        addedToday,
        statusDistribution,
        recentActivity,
        upcomingFollowups: [], // Simplified for now
        priorityLeads: [], // Simplified for now
      },
    });
  }),
);

// --- Products ---
router.get(
  "/products",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { search, category, location, status } = req.query;
    const isSalesperson = req.user.role === "RECRUITER";

    let query = firestore.collection("products");

    if (isSalesperson) {
      query = query.where("createdById", "==", req.user.id);
    }

    if (category && category !== "All") {
      query = query.where("category", "==", category);
    }

    const snapshot = await query.orderBy("createdAt", "desc").get();
    let products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Filter by search and location in-memory for complexity
    if (search) {
      products = products.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    }
    if (location && location !== "All") {
      products = products.filter(p => p.location && p.location.toLowerCase().includes(location.toLowerCase()));
    }

    // Attach tracking info
    const trackingSnap = await firestore.collection("sales_tracking").get();
    const trackingMap = {};
    trackingSnap.docs.forEach(doc => {
      const data = doc.data();
      trackingMap[data.productId] = { id: doc.id, ...data };
    });

    products = products.map(p => ({
      ...p,
      tracking: trackingMap[p.id] || { status: "LEAD" }
    }));

    if (status && status !== "All") {
      products = products.filter(p => p.tracking.status === status);
    }

    res.json({ success: true, data: products });
  }),
);

router.post(
  "/products",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { name, category, location, description, price, tags, coordinatorId } = req.body;

    if (!name || !category) {
      throw new ApiError(400, "Product name and category are required");
    }

    const productData = {
      name,
      category,
      location,
      description,
      price: price ? Number.parseFloat(price) : null,
      tags: tags || [],
      coordinatorId,
      createdById: req.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const docRef = await firestore.collection("products").add(productData);

    await firestore.collection("sales_tracking").add({
      productId: docRef.id,
      status: "LEAD",
      createdAt: new Date().toISOString()
    });

    await logActivity(docRef.id, "PRODUCT_CREATED", `Product "${name}" created.`, req.user.id);

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_PRODUCT",
      entityType: "PRODUCT",
      entityId: docRef.id,
      newData: productData,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: { id: docRef.id, ...productData } });
  }),
);

router.get(
  "/products/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const doc = await firestore.collection("products").doc(id).get();
    if (!doc.exists) throw new ApiError(404, "Product not found");

    const product = { id: doc.id, ...doc.data() };

    const trackingSnap = await firestore.collection("sales_tracking").where("productId", "==", id).get();
    product.tracking = trackingSnap.empty ? { status: "LEAD" } : { id: trackingSnap.docs[0].id, ...trackingSnap.docs[0].data() };

    const activitiesSnap = await firestore.collection("sales_activities")
      .where("productId", "==", id)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();
    product.activities = activitiesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    res.json({ success: true, data: product });
  }),
);

router.patch(
  "/tracking/:productId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { status, notes, followUpDate } = req.body;

    const trackingSnap = await firestore.collection("sales_tracking").where("productId", "==", productId).get();
    if (trackingSnap.empty) throw new ApiError(404, "Tracking record not found");

    const trackingRef = trackingSnap.docs[0].ref;
    const oldStatus = trackingSnap.docs[0].data().status;

    const updateData = {
      status: status || oldStatus,
      notes: notes || "",
      followUpDate: followUpDate || null,
      updatedAt: new Date().toISOString()
    };

    await trackingRef.update(updateData);

    if (status && status !== oldStatus) {
      await logActivity(productId, "STATUS_UPDATED", `Status changed from ${oldStatus} to ${status}.`, req.user.id);
    }

    res.json({ success: true, data: { id: trackingRef.id, ...updateData } });
  }),
);

router.post(
  "/import/products",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new ApiError(400, "No file uploaded");

    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
    const results = { imported: 0, skipped: 0, errors: [] };

    const batch = firestore.batch();

    for (const row of rows) {
      try {
        const name = row.Name || row.name;
        const category = row.Category || row.category;

        if (!name || !category) {
          results.skipped++;
          continue;
        }

        const productRef = firestore.collection("products").doc();
        const productData = {
          name: String(name),
          category: String(category),
          location: row.Location || row.location || null,
          description: row.Description || row.description || null,
          price: row.Price || row.price ? Number(row.Price || row.price) : null,
          tags: (row.Tags || row.tags || "").split(",").map(t => t.trim()).filter(Boolean),
          createdById: req.user.id,
          createdAt: new Date().toISOString()
        };

        batch.set(productRef, productData);

        const trackingRef = firestore.collection("sales_tracking").doc();
        batch.set(trackingRef, {
          productId: productRef.id,
          status: "LEAD",
          createdAt: new Date().toISOString()
        });

        results.imported++;
      } catch (err) {
        results.errors.push({ row: row.Name || "Unknown", error: err.message });
        results.skipped++;
      }
    }

    await batch.commit();
    res.json({ success: true, data: results });
  })
);

router.get(
  "/categories",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const snapshot = await firestore.collection("products").select("category").get();
    const categories = [...new Set(snapshot.docs.map(doc => doc.data().category))];
    res.json({ success: true, data: categories });
  }),
);

module.exports = router;
