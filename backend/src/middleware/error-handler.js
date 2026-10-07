const { ApiError } = require("../utils/errors");

function notFound(req, res) {
  const requestId = req.id || req.headers['x-request-id'] || 'req_unknown';
  res.status(404).json({
    success: false,
    code: 'ROUTE_NOT_FOUND',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      requestId,
    },
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const requestId = req.id || req.headers['x-request-id'] || 'req_unknown';

  // Structured server-side error logging
  const logContext = {
    requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id || 'anonymous',
    userRole: req.user?.role || 'none',
    orgId: req.user?.organizationId || 'none',
    params: req.params,
    errorName: err.name,
    errorMessage: err.message,
    errorCode: err.code || null,
    statusCode: err.statusCode || 500,
    stack: err.stack,
  };
  console.error(`[ErrorHandler][${requestId}] Request failed:`, JSON.stringify(logContext, null, 2));

  if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
    const msg = 'File exceeds the allowed size limit. Please upload a smaller file.';
    return res.status(413).json({
      success: false,
      code: 'FILE_TOO_LARGE',
      message: msg,
      error: {
        code: 'FILE_TOO_LARGE',
        message: msg,
        requestId,
      },
    });
  }

  if (err instanceof ApiError) {
    const code = err.code || `HTTP_${err.statusCode}`;
    return res.status(err.statusCode).json({
      success: false,
      code,
      message: err.message,
      error: {
        code,
        message: err.message,
        requestId,
        details: err.details || undefined,
      },
    });
  }

  const statusCode = (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) ? err.statusCode : 500;
  const isProd = process.env.NODE_ENV === "production";
  
  // Specific machine-readable code & actionable message — NEVER bare string "Internal Server Error"
  const errorCode = err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : `HTTP_${statusCode}`);
  const clientMessage = isProd
    ? (statusCode >= 500
        ? `A server error occurred while processing your request (Reference: ${requestId}). Please try again or contact support.`
        : (err.message && !err.message.includes('password') && !err.message.includes('secret') && !err.message.includes('token')
            ? err.message
            : `A server error occurred while processing your request (Reference: ${requestId}).`))
    : (err.message || 'Request failed');

  return res.status(statusCode).json({
    success: false,
    code: errorCode,
    message: clientMessage,
    error: {
      code: errorCode,
      message: clientMessage,
      requestId,
    },
    stack: isProd ? undefined : err.stack,
  });
}

module.exports = {
  notFound,
  errorHandler,
};

