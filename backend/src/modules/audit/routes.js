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

    // Optionally fetch actor details for each log if needed, 
    // but in a high-perf system we might denormalize actor name into the log itself.
    // For now, let's keep it simple.

    res.json({
      success: true,
      data: logs,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
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
