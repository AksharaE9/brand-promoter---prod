const express = require("express");
const prisma = require("../../config/db");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");
const xlsx = require("xlsx");
const PDFDocument = require("pdfkit");
const multer = require("multer");
const { MAX_UPLOAD_BYTES } = require("../../config/uploadLimits");

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

router.use(auth);

// --- Activity Helper ---
async function logActivity(productId, action, details, actorId) {
  await prisma.salesActivity.create({
    data: {
      productId,
      action,
      details,
      actorId
    }
  });
}

// --- Dashboard ---
router.get(
  "/dashboard",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const isSalesperson = req.user.role === "RECRUITER";
    const userId = req.user.id;

    const products = await prisma.product.findMany({
      where: isSalesperson ? { createdById: userId } : {}
    });

    const productIds = products.map(p => p.id);
    const tracking = await prisma.salesTracking.findMany({
      where: {
        productId: { in: productIds }
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString();

    const conversions = tracking.filter(t => t.status === "CONVERTED").length;
    const pendingFollowups = tracking.filter(t => 
      t.status !== "CONVERTED" && 
      t.status !== "REJECTED" && 
      t.followUpDate && t.followUpDate <= new Date().toISOString()
    ).length;

    const addedToday = products.filter(p => p.createdAt >= today).length;

    const statusCounts = {};
    tracking.forEach(t => {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    });
    const statusDistribution = Object.keys(statusCounts).map(status => ({
      status,
      _count: { _all: statusCounts[status] }
    }));

    const recentActivity = await prisma.salesActivity.findMany({
      where: {
        productId: { in: productIds }
      },
      orderBy: { createdAt: "desc" },
      limit: 10
    });

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

    const where = {};

    if (isSalesperson) {
      where.createdById = req.user.id;
    }

    if (category && category !== "All") {
      where.category = category;
    }

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }
    
    if (location && location !== "All") {
      where.location = { contains: location, mode: 'insensitive' };
    }

    let products = await prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" }
    });

    // Attach tracking info
    const tracking = await prisma.salesTracking.findMany({
      where: {
        productId: { in: products.map(p => p.id) }
      }
    });
    
    const trackingMap = {};
    tracking.forEach(t => {
      trackingMap[t.productId] = t;
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
      createdById: req.user.id
    };

    const product = await prisma.product.create({
      data: productData
    });

    await prisma.salesTracking.create({
      data: {
        productId: product.id,
        status: "LEAD"
      }
    });

    await logActivity(product.id, "PRODUCT_CREATED", `Product "${name}" created.`, req.user.id);

    await logAudit({
      actorUserId: req.user.id,
      action: "CREATE_PRODUCT",
      entityType: "PRODUCT",
      entityId: product.id,
      newData: product,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: product });
  }),
);

router.get(
  "/products/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const product = await prisma.product.findUnique({
      where: { id }
    });
    if (!product) throw new ApiError(404, "Product not found");

    const tracking = await prisma.salesTracking.findUnique({
      where: { productId: id }
    });
    product.tracking = tracking || { status: "LEAD" };

    const activities = await prisma.salesActivity.findMany({
      where: { productId: id },
      orderBy: { createdAt: "desc" },
      take: 50
    });
    product.activities = activities;

    res.json({ success: true, data: product });
  }),
);

router.patch(
  "/tracking/:productId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const { status, notes, followUpDate } = req.body;

    const tracking = await prisma.salesTracking.findUnique({
      where: { productId }
    });
    if (!tracking) throw new ApiError(404, "Tracking record not found");

    const oldStatus = tracking.status;

    const updateData = {
      status: status || oldStatus,
      notes: notes || "",
      followUpDate: followUpDate || null
    };

    const updated = await prisma.salesTracking.update({
      where: { productId },
      data: updateData
    });

    if (status && status !== oldStatus) {
      await logActivity(productId, "STATUS_UPDATED", `Status changed from ${oldStatus} to ${status}.`, req.user.id);
    }

    res.json({ success: true, data: updated });
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

    for (const row of rows) {
      try {
        const name = row.Name || row.name;
        const category = row.Category || row.category;

        if (!name || !category) {
          results.skipped++;
          continue;
        }

        const product = await prisma.product.create({
          data: {
            name: String(name),
            category: String(category),
            location: row.Location || row.location || null,
            description: row.Description || row.description || null,
            price: row.Price || row.price ? Number(row.Price || row.price) : null,
            tags: (row.Tags || row.tags || "").split(",").map(t => t.trim()).filter(Boolean),
            createdById: req.user.id
          }
        });

        await prisma.salesTracking.create({
          data: {
            productId: product.id,
            status: "LEAD"
          }
        });

        results.imported++;
      } catch (err) {
        results.errors.push({ row: row.Name || "Unknown", error: err.message });
        results.skipped++;
      }
    }

    res.json({ success: true, data: results });
  })
);

router.get(
  "/categories",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const categories = await prisma.product.findMany({
      select: { category: true },
      distinct: ['category']
    });
    const list = categories.map(c => c.category).filter(Boolean);
    res.json({ success: true, data: list });
  }),
);

module.exports = router;
