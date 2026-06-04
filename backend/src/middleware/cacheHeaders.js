'use strict';

// Apply to routes where browser caching is safe
function cacheControl(maxAge = 0, isPublic = false) {
  return (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (maxAge > 0) {
      res.setHeader(
        'Cache-Control',
        `${isPublic ? 'public' : 'private'}, max-age=${maxAge}, stale-while-revalidate=${Math.floor(maxAge / 2)}`
      );
    } else {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
    }
    next();
  };
}

module.exports = cacheControl;
