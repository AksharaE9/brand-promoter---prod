require('dotenv').config();
const jwt = require("jsonwebtoken");
const { ApiError } = require("../../src/utils/errors");
const { signAccessToken, verifyAccessToken } = require("../../src/utils/jwt");
const { auth, requireRoles } = require("../../src/middleware/auth");
const { errorHandler } = require("../../src/middleware/error-handler");

describe("Session Expiry & Error Classification Contract Tests", () => {
  const SECRET = process.env.JWT_SECRET || "change_this_secret_in_env";


  describe("1. JWT & Clock Skew Tolerance", () => {
    test("signs and verifies valid token", () => {
      const token = signAccessToken({ userId: "user-123", role: "RECRUITER" });
      const decoded = verifyAccessToken(token);
      expect(decoded.userId).toBe("user-123");
      expect(decoded.role).toBe("RECRUITER");
    });

    test("verifies token within 60-second clock skew tolerance", () => {
      // Create token with iat slightly in the future (within 60s clock skew tolerance)
      const nowSec = Math.floor(Date.now() / 1000);
      const futureToken = jwt.sign(
        { userId: "user-456", role: "SUPER_ADMIN", iat: nowSec + 20, exp: nowSec + 3600 },
        SECRET
      );
      const decoded = verifyAccessToken(futureToken);
      expect(decoded.userId).toBe("user-456");
    });
  });

  describe("2. Auth Middleware Error Taxonomy", () => {
    test("missing token returns 401 AUTH_TOKEN_MISSING", async () => {
      const req = { headers: {}, originalUrl: "/api/interviews" };
      const res = {};
      let caughtError = null;
      const next = (err) => { caughtError = err; };

      await auth(req, res, next);
      expect(caughtError).toBeInstanceOf(ApiError);
      expect(caughtError.statusCode).toBe(401);
      expect(caughtError.code).toBe("AUTH_TOKEN_MISSING");
    });

    test("expired token returns 401 AUTH_TOKEN_EXPIRED", async () => {
      // Token expired past the 60s clock tolerance window (e.g. 120s ago)
      const nowSec = Math.floor(Date.now() / 1000);
      const expiredToken = jwt.sign(
        { userId: "user-exp", role: "RECRUITER", iat: nowSec - 3600, exp: nowSec - 120 },
        SECRET
      );

      const req = {
        headers: { authorization: `Bearer ${expiredToken}` },
        originalUrl: "/api/interviews"
      };
      const res = {};
      let caughtError = null;
      const next = (err) => { caughtError = err; };

      await auth(req, res, next);
      expect(caughtError).toBeInstanceOf(ApiError);
      expect(caughtError.statusCode).toBe(401);
      expect(caughtError.code).toBe("AUTH_TOKEN_EXPIRED");
      expect(caughtError.message).toContain("session has expired");
    });



    test("tampered/invalid token returns 401 AUTH_TOKEN_INVALID", async () => {
      const req = {
        headers: { authorization: "Bearer invalid.signature.token" },
        originalUrl: "/api/interviews"
      };
      const res = {};
      let caughtError = null;
      const next = (err) => { caughtError = err; };

      await auth(req, res, next);
      expect(caughtError).toBeInstanceOf(ApiError);
      expect(caughtError.statusCode).toBe(401);
      expect(caughtError.code).toBe("AUTH_TOKEN_INVALID");
    });

    test("insufficient permission in requireRoles returns 403 AUTH_INSUFFICIENT_PERMISSION (never 401)", () => {
      const req = {
        user: { id: "u1", role: "INTERVIEWER" }
      };
      const res = {};
      let caughtError = null;
      const next = (err) => { caughtError = err; };

      const guard = requireRoles("SUPER_ADMIN", "RECRUITER");
      guard(req, res, next);

      expect(caughtError).toBeInstanceOf(ApiError);
      expect(caughtError.statusCode).toBe(403);
      expect(caughtError.code).toBe("AUTH_INSUFFICIENT_PERMISSION");
    });
  });

  describe("3. Error Handler Contract & Request ID Tracking", () => {
    test("ApiError formats with code, message, and requestId", () => {
      const err = new ApiError(401, "Your session has expired. Please sign in again.", "AUTH_TOKEN_EXPIRED");
      const req = {
        id: "req_test_123",
        headers: {},
        method: "GET",
        originalUrl: "/api/interviews"
      };
      let statusSent = null;
      let jsonSent = null;
      const res = {
        headersSent: false,
        status: (s) => { statusSent = s; return res; },
        json: (j) => { jsonSent = j; return res; }
      };
      const next = jest.fn();

      errorHandler(err, req, res, next);

      expect(statusSent).toBe(401);
      expect(jsonSent.success).toBe(false);
      expect(jsonSent.code).toBe("AUTH_TOKEN_EXPIRED");
      expect(jsonSent.error.code).toBe("AUTH_TOKEN_EXPIRED");
      expect(jsonSent.error.requestId).toBe("req_test_123");
      expect(jsonSent.error.message).toContain("session has expired");
    });

    test("500 errors include requestId reference and never bare string 'Internal Server Error'", () => {
      const err = new Error("Database timeout connection failure");
      const req = {
        id: "req_srv_999",
        headers: {},
        method: "POST",
        originalUrl: "/api/interviews/123/follow-up"
      };
      let statusSent = null;
      let jsonSent = null;
      const res = {
        headersSent: false,
        status: (s) => { statusSent = s; return res; },
        json: (j) => { jsonSent = j; return res; }
      };
      const next = jest.fn();

      errorHandler(err, req, res, next);

      expect(statusSent).toBe(500);
      expect(jsonSent.success).toBe(false);
      expect(jsonSent.code).toBe("INTERNAL_SERVER_ERROR");
      expect(jsonSent.error.requestId).toBe("req_srv_999");
      // Must not be the bare string "Internal Server Error"
      expect(jsonSent.message).not.toBe("Internal Server Error");
      expect(jsonSent.error.message).not.toBe("Internal Server Error");
    });
  });
});
