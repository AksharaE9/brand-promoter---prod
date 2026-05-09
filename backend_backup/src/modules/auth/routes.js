const express = require("express");
const bcrypt = require("bcryptjs");
const prisma = require("../../config/prisma");
const { asyncHandler, ApiError } = require("../../utils/errors");
const { signAccessToken } = require("../../utils/jwt");
const { auth } = require("../../middleware/auth");

const router = express.Router();

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { firstName, lastName, fullName, email, phone = null, password, role = "RECRUITER" } = req.body;
    const allowedRoles = ["RECRUITER", "INTERVIEWER"];

    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedRole = String(role || "").trim().toUpperCase();
    const builtName = String(fullName || `${firstName || ""} ${lastName || ""}`).trim();

    if (!builtName || !normalizedEmail || !password) {
      throw new ApiError(400, "Name, email, and password are required");
    }
    if (!allowedRoles.includes(normalizedRole)) {
      throw new ApiError(400, "role must be RECRUITER or INTERVIEWER");
    }
    if (String(password).length < 8) {
      throw new ApiError(400, "Password must be at least 8 characters");
    }

    const existing = await prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) {
      throw new ApiError(409, "User with this email already exists");
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        fullName: builtName,
        email: normalizedEmail,
        phone: phone ? String(phone).trim() : null,
        passwordHash,
        role: normalizedRole,
        status: "PENDING",
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        profilePhotoFile: {
          select: {
            id: true,
            storageKey: true,
          },
        },
      },
    });

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      data: user,
    });
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new ApiError(400, "Email and password are required");
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      include: {
        profilePhotoFile: {
          select: {
            id: true,
            storageKey: true,
          },
        },
      },
    });

    if (!user) {
      throw new ApiError(401, "Invalid credentials");
    }

    if (user.status !== "ACTIVE") {
      throw new ApiError(403, "User is inactive");
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      throw new ApiError(401, "Invalid credentials");
    }

    const token = signAccessToken({
      userId: user.id,
      role: user.role,
    });

    return res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          role: user.role,
          profilePhotoUrl: user.profilePhotoFile?.storageKey || null,
        },
      },
    });
  }),
);

router.get(
  "/me",
  auth,
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: req.user,
    });
  }),
);

module.exports = router;
