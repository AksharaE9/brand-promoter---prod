const express = require('express');
const router = express.Router();
const { db: firestore } = require('../../config/firebase');
const { auth, requireRoles } = require('../../middleware/auth');

// GET /audit-logs
router.get('/', auth, requireRoles('SUPER_ADMIN'), async (req, res) => {
  try {
    const { limit = 50, offset = 0, entityType, action, actorUserId } = req.query;

    let query = firestore.collection("auditLogs");

    if (entityType) query = query.where("entityType", "==", entityType);
    if (action) query = query.where("action", "==", action);
    if (actorUserId) query = query.where("actorUserId", "==", actorUserId);

    // Fetch without orderBy to avoid composite index requirement — sort in memory
    const snapshot = await query.limit(parseInt(limit) + parseInt(offset)).get();
    let all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Sort by createdAt descending in memory
    all.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Paginate in memory
    const logs = all.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    const total = snapshot.size;

    // Resolve actor names and entity names — isolated so failures don't break the response
    try {
      // 1. Resolve actorUserId → actor name/email
      const uniqueActorIds = [...new Set(logs.map(l => l.actorUserId).filter(Boolean))];
      const actorMap = {};
      if (uniqueActorIds.length > 0) {
        const chunks = [];
        for (let i = 0; i < uniqueActorIds.length; i += 30) chunks.push(uniqueActorIds.slice(i, i + 30));
        await Promise.all(chunks.map(async chunk => {
          const snap = await firestore.collection('users')
            .where(firestore.FieldPath.documentId(), 'in', chunk).get();
          snap.forEach(d => {
            const u = d.data();
            actorMap[d.id] = { fullName: u.fullName || u.name || 'Unknown', email: u.email || '', role: u.role || '' };
          });
        }));
      }

      // 2. Resolve entityId → readable name
      const entityGroups = {};
      logs.forEach(log => {
        if (!log.entityId) return;
        const type = log.entityType || 'UNKNOWN';
        if (!entityGroups[type]) entityGroups[type] = new Set();
        entityGroups[type].add(log.entityId);
      });

      const entityNameMap = {};
      const collectionForType = { CANDIDATE: 'candidates', USER: 'users', INTERVIEW: 'interviews', APPLICATION: 'applications' };

      await Promise.all(Object.entries(entityGroups).map(async ([type, idSet]) => {
        const collectionName = collectionForType[type];
        if (!collectionName) return;
        const ids = [...idSet];
        const chunks = [];
        for (let i = 0; i < ids.length; i += 30) chunks.push(ids.slice(i, i + 30));
        await Promise.all(chunks.map(async chunk => {
          const snap = await firestore.collection(collectionName)
            .where(firestore.FieldPath.documentId(), 'in', chunk).get();
          snap.forEach(d => {
            const data = d.data();
            entityNameMap[d.id] = data.fullName || data.name || data.title || d.id;
          });
        }));
      }));

      logs.forEach(log => {
        log.actor = actorMap[log.actorUserId] || { fullName: log.actorUserId || 'System', email: '', role: '' };
        log.entityName = log.entityId ? (entityNameMap[log.entityId] || log.entityId) : null;
      });
    } catch (enrichErr) {
      // Name resolution failed — still return raw logs
      console.warn('[Audit] Name resolution failed:', enrichErr.message);
      logs.forEach(log => {
        log.actor = log.actor || { fullName: log.actorUserId || 'System', email: '', role: '' };
        log.entityName = log.entityName || log.entityId || null;
      });
    }

    res.json({
      success: true,
      data: logs,
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) }
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
