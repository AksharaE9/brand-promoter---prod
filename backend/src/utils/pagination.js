// src/utils/pagination.js
'use strict';
const { db } = require('../config/firebase');

async function paginateFirestore({ query, limit, cursor }) {
  const lim = Math.min(50, Math.max(1, parseInt(limit) || 20));

  let q = query.limit(lim);

  if (cursor) {
    try {
      const cursorDoc = await db.doc(cursor).get();
      if (cursorDoc.exists) {
        q = q.startAfter(cursorDoc);
      }
    } catch {
      // Invalid cursor — start from beginning
    }
  }

  const snap = await q.get();
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const lastDoc   = snap.docs[snap.docs.length - 1];
  const nextCursor = data.length === lim ? lastDoc?.ref?.path : null;

  return { data, nextCursor, hasMore: data.length === lim };
}

module.exports = { paginateFirestore };
