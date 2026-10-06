const { ApiError } = require("../utils/errors");

function notFound(req, res) {
  res.status(404).json({
    success: false,
    code: 'ROUTE_NOT_FOUND',
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    error: `Route not found: ${req.method} ${req.originalUrl}`,
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  // Structured server-side error logging
  const logContext = {
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
  console.error('[ErrorHandler] Request failed:', JSON.stringify(logContext, null, 2));

  if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      code: 'FILE_TOO_LARGE',
      message: 'File exceeds the allowed size limit. Please upload a smaller file.',
      error: 'File exceeds the allowed size limit. Please upload a smaller file.',
    });
  }

  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      success: false,
      code: err.code || `HTTP_${err.statusCode}`,
      message: err.message,
      error: err.message,
    });
  }

  const statusCode = (typeof err.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 600) ? err.statusCode : 500;
  const isProd = process.env.NODE_ENV === "production";
  const clientMessage = isProd
    ? (err.message && !err.message.includes('password') && !err.message.includes('secret') && !err.message.includes('token')
        ? err.message
        : "An internal server error occurred while processing your request.")
    : err.message;

  return res.status(statusCode).json({
    success: false,
    code: err.code || 'INTERNAL_SERVER_ERROR',
    message: clientMessage,
    error: clientMessage,
    stack: isProd ? undefined : err.stack,
  });
}

module.exports = {
  notFound,
  errorHandler,
};
