const express = require("express");
const prisma = require("../../config/prisma");
const { auth, requireRoles } = require("../../middleware/auth");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { logAudit } = require("../../utils/audit");

const router = express.Router();

router.use(auth);

const isUUID = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

// --- Activity Helper ---
async function logActivity(tx, productId, action, details, actorId) {
  await tx.salesActivity.create({
    data: {
      productId,
      action,
      details,
      actorId,
    },
  });
}

// --- Dashboard ---
router.get(
  "/dashboard",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const isSalesperson = req.user.role === "RECRUITER";
    const userId = req.user.id;

    const where = isSalesperson ? { createdById: userId } : {};
    const trackingWhere = isSalesperson ? { product: { createdById: userId } } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [totalProducts, conversions, pendingFollowups, addedToday, statusDistribution, recentActivity, upcomingFollowups, priorityLeads] = await Promise.all([
      prisma.product.count({ where }),
      prisma.salesTracking.count({ where: { ...trackingWhere, status: "CONVERTED" } }),
      prisma.salesTracking.count({
        where: {
          ...trackingWhere,
          followUpDate: { lte: new Date() },
          status: { notIn: ["CONVERTED", "REJECTED"] },
        },
      }),
      prisma.product.count({
        where: { ...where, createdAt: { gte: today } },
      }),
      prisma.salesTracking.groupBy({
        by: ["status"],
        where: trackingWhere,
        _count: { _all: true },
      }),
      prisma.salesActivity.findMany({
        where: { product: where },
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          action: true,
          details: true,
          createdAt: true,
          productId: true,
        }
      }),
      prisma.product.findMany({
        where: {
          ...where,
          tracking: {
            followUpDate: { lte: new Date() },
            status: { notIn: ["CONVERTED", "REJECTED"] },
          }
        },
        include: { tracking: true },
        take: 5,
        orderBy: { tracking: { followUpDate: "asc" } }
      }),
      prisma.product.findMany({
        where: {
          ...where,
          tracking: {
            status: { in: ["NEGOTIATION", "INTERESTED"] }
          }
        },
        include: { tracking: true },
        take: 5,
        orderBy: { updatedAt: "desc" }
      })
    ]);

    const totalTracked = statusDistribution.reduce((acc, curr) => acc + curr._count._all, 0);
    const conversionRate = totalTracked > 0 ? ((conversions / totalTracked) * 100).toFixed(1) : 0;

    res.json({
      success: true,
      data: {
        totalProducts,
        conversions,
        conversionRate,
        pendingFollowups,
        addedToday,
        statusDistribution,
        recentActivity,
        upcomingFollowups,
        priorityLeads,
      },
    });
  }),
);

// --- Products ---
router.get(
  "/products",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { search, category, location, status, sort } = req.query;
    const isSalesperson = req.user.role === "RECRUITER";

    const where = {
      ...(isSalesperson ? { createdById: req.user.id } : {}),
      ...(category && category !== "All" ? { category } : {}),
      ...(location && location !== "All" ? { location: { contains: location, mode: "insensitive" } } : {}),
      ...(status && status !== "All" ? { tracking: { status } } : {}),
      ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
    };

    const products = await prisma.product.findMany({
      where,
      include: {
        createdBy: { select: { id: true, fullName: true, role: true } },
        coordinator: { select: { id: true, fullName: true } },
        tracking: true,
        candidateAssignments: {
          include: {
            candidate: { select: { id: true, fullName: true, email: true } }
          }
        },
        activities: { take: 5, orderBy: { createdAt: "desc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ success: true, data: products });
  }),
);

router.get(
  "/export/products",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const isSalesperson = req.user.role === "RECRUITER";
    const where = isSalesperson ? { createdById: req.user.id } : {};

    const products = await prisma.product.findMany({
      where,
      include: {
        tracking: true,
        createdBy: { select: { fullName: true } },
        coordinator: { select: { fullName: true } },
      },
    });

    let csv = "Name,Category,Price,Status,Coordinator,Created By,Created At\n";
    products.forEach((p) => {
      csv += `"${p.name}","${p.category}",${p.price || 0},"${p.tracking?.status || "LEAD"}","${p.coordinator?.fullName || "-"}","${p.createdBy?.fullName || "-"}","${p.createdAt.toISOString()}"\n`;
    });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=products_report.csv");
    res.status(200).send(csv);
  }),
);

router.get(
  "/categories",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const categories = await prisma.product.findMany({
      select: { category: true },
      distinct: ["category"],
    });
    res.json({ success: true, data: categories.map((c) => c.category) });
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

    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          name,
          category,
          location,
          description,
          price: price ? Number.parseFloat(price) : null,
          tags: tags || [],
          coordinatorId,
          createdById: req.user.id,
          tracking: {
            create: {
              status: "LEAD",
            },
          },
        },
        include: { tracking: true },
      });

      await logActivity(tx, p.id, "PRODUCT_CREATED", `Product "${name}" created.`, req.user.id);
      return p;
    });

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

router.patch(
  "/products/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid product ID");

    const { name, category, location, description, price, tags, coordinatorId } = req.body;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Product not found");

    // Salespersons can only edit their own products
    if (req.user.role === "RECRUITER" && existing.createdById !== req.user.id) {
      throw new ApiError(403, "You can only edit your own products");
    }

    const product = await prisma.$transaction(async (tx) => {
      const p = await tx.product.update({
        where: { id },
        data: {
          name,
          category,
          location,
          description,
          price: price ? Number.parseFloat(price) : null,
          tags: tags || [],
          coordinatorId,
        },
        include: { tracking: true },
      });

      await logActivity(tx, id, "PRODUCT_UPDATED", `Product details updated.`, req.user.id);
      return p;
    });

    res.json({ success: true, data: product });
  }),
);

router.delete(
  "/products/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid product ID");

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, "Product not found");

    if (req.user.role === "RECRUITER" && existing.createdById !== req.user.id) {
      throw new ApiError(403, "You can only delete your own products");
    }

    await prisma.product.delete({ where: { id } });

    res.json({ success: true, message: "Product deleted successfully" });
  }),
);

router.get(
  "/products/:id",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!isUUID(id)) throw new ApiError(400, "Invalid product ID");

    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        tracking: true,
        activities: {
          orderBy: { createdAt: "desc" },
        },
        createdBy: { select: { id: true, fullName: true } },
        candidateAssignments: {
          include: {
            candidate: { select: { id: true, fullName: true, email: true } }
          }
        },
      },
    });

    if (!product) throw new ApiError(404, "Product not found");

    if (req.user.role === "RECRUITER" && product.createdById !== req.user.id) {
      throw new ApiError(403, "Access denied");
    }

    res.json({ success: true, data: product });
  }),
);

// --- Tracking ---
router.patch(
  "/tracking/:productId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    if (!isUUID(productId)) throw new ApiError(400, "Invalid product ID");

    const { status, notes, followUpDate } = req.body;

    const existingProduct = await prisma.product.findUnique({
      where: { id: productId },
      include: { tracking: true },
    });

    if (!existingProduct) throw new ApiError(404, "Product not found");

    if (req.user.role === "RECRUITER" && existingProduct.createdById !== req.user.id) {
      throw new ApiError(403, "You can only update tracking for your own products");
    }

    const updatedTracking = await prisma.$transaction(async (tx) => {
      const t = await tx.salesTracking.update({
        where: { productId },
        data: {
          status,
          notes,
          followUpDate: followUpDate ? new Date(followUpDate) : undefined,
        },
      });

      if (status && status !== existingProduct.tracking?.status) {
        await logActivity(tx, productId, "STATUS_UPDATED", `Status changed from ${existingProduct.tracking?.status} to ${status}.`, req.user.id);
      }
      if (notes && notes !== existingProduct.tracking?.notes) {
        await logActivity(tx, productId, "NOTE_ADDED", `Note added: ${notes.substring(0, 50)}${notes.length > 50 ? '...' : ''}`, req.user.id);
      }
      if (followUpDate) {
        await logActivity(tx, productId, "FOLLOWUP_SET", `Follow-up date set to ${new Date(followUpDate).toLocaleDateString()}.`, req.user.id);
      }

      return t;
    });

    res.json({ success: true, data: updatedTracking });
  }),
);

// --- Candidate Assignments ---

router.get(
  "/eligible-candidates",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    // Candidates who have "JOINED" (onboarding)
    const candidates = await prisma.candidate.findMany({
      where: {
        applications: {
          some: { status: "JOINED" }
        }
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        category: true
      }
    });
    res.json({ success: true, data: candidates });
  })
);

router.post(
  "/products/:id/assign-candidate",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id: productId } = req.params;
    const { candidateId } = req.body;

    const assignment = await prisma.productCandidateAssignment.create({
      data: {
        productId,
        candidateId
      },
      include: {
        candidate: { select: { fullName: true } }
      }
    });

    await logAudit({
      actorUserId: req.user.id,
      action: "ASSIGN_CANDIDATE_TO_PRODUCT",
      entityType: "PRODUCT",
      entityId: productId,
      newData: assignment,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({ success: true, data: assignment });
  })
);

router.delete(
  "/products/:id/assign-candidate/:candidateId",
  requireRoles("SUPER_ADMIN", "RECRUITER"),
  asyncHandler(async (req, res) => {
    const { id: productId, candidateId } = req.params;

    await prisma.productCandidateAssignment.delete({
      where: {
        productId_candidateId: {
          productId,
          candidateId
        }
      }
    });

    res.json({ success: true, message: "Assignment removed" });
  })
);

module.exports = router;
