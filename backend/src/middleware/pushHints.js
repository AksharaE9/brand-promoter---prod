'use strict';

const PUSH_HINTS = {
  '/api/dashboard/init': [
    '</api/candidates?limit=20>; rel=prefetch',
    '</api/jobs?limit=10>; rel=prefetch',
    '</api/notifications?limit=10>; rel=prefetch',
  ],
  '/api/candidates': [
    '</api/jobs?limit=50>; rel=prefetch',
  ],
};

function pushHints(req, res, next) {
  const hints = PUSH_HINTS[req.path];
  if (hints) {
    res.setHeader('Link', hints.join(', '));
  }
  next();
}

module.exports = pushHints;
