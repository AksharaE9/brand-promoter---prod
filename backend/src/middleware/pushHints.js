'use strict';

const PUSH_HINTS = {};

function pushHints(req, res, next) {
  const hints = PUSH_HINTS[req.path];
  if (hints) {
    res.setHeader('Link', hints.join(', '));
  }
  next();
}

module.exports = pushHints;
