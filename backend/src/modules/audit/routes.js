const express = require('express');
const router = express.Router();
const { db: firestore } = require('../../config/firebase');
const { auth, requireRoles } = require('../../middleware/auth');

// GET /audit-logs — single query, names pre-denormalized at write time
router.get('/', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const { limit = 50, offset = 0, entityType, action, actorUserId } = req.query;

    let query = firestore.collection("auditLogs");
    if (entityType) query = query.where("entityType", "==", entityType);
    if (action) query = query.where("action", "==", action);
    if (actorUserId) query = query.where("actorUserId", "==", actorUserId);

    // Fetch without orderBy to avoid composite index issues — sort in memory
    const snapshot = await query.limit(parseInt(limit) + parseInt(offset)).get();
    let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort newest first
    logs.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Paginate in memory
    const page = logs.slice(parseInt(offset), parseInt(offset) + parseInt(limit));

    // Ensure actor/entityName fields exist (backward compat with old logs)
    page.forEach(log => {
      log.actor = { fullName: log.actorName || log.actorUserId || 'System', email: '' };
      log.entityName = log.entityName || log.entityId || null;
    });

    res.json({
      success: true,
      data: page,
      pagination: { total: logs.length, limit: parseInt(limit), offset: parseInt(offset) }
    });
  } catch (error) {
    console.error('[Audit] Query failed:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /audit-logs/:id
router.get('/:id', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const doc = await firestore.collection("auditLogs").doc(req.params.id).get();

    if (!doc.exists) {
      return res.status(404).json({ success: false, message: 'Log not found' });
    }

    res.json({ success: true, data: { id: doc.id, ...doc.data() } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
