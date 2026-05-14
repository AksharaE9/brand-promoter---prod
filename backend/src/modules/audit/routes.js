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

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    const snapshot = await query
      .orderBy("createdAt", "desc")
      .offset(parseInt(offset))
      .limit(parseInt(limit))
      .get();

    const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Resolve actorUserId → { fullName, email, role } for all logs
    const uniqueActorIds = [...new Set(logs.map(l => l.actorUserId).filter(Boolean))];
    const actorMap = {};
    if (uniqueActorIds.length > 0) {
      // Firestore `in` supports max 30 per query
      const chunks = [];
      for (let i = 0; i < uniqueActorIds.length; i += 30) chunks.push(uniqueActorIds.slice(i, i + 30));
      await Promise.all(chunks.map(async chunk => {
        const snap = await firestore.collection('users')
          .where(firestore.FieldPath.documentId(), 'in', chunk)
          .get();
        snap.forEach(d => {
          const u = d.data();
          actorMap[d.id] = { fullName: u.fullName || u.name || 'Unknown', email: u.email || '', role: u.role || '' };
        });
      }));
    }

    logs.forEach(log => {
      log.actor = actorMap[log.actorUserId] || { fullName: 'System', email: '', role: '' };
    });

    res.json({
      success: true,
      data: logs,
      pagination: { total, limit: parseInt(limit), offset: parseInt(offset) }
    });
  } catch (error) {
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
