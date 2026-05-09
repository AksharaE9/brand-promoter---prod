const express = require('express');
const router = express.Router();
const { db: firestore } = require('../../config/firebase');
const { auth } = require('../../middleware/auth');
const { asyncHandler, ApiError } = require('../../utils/errors');

router.use(auth);

const { addClient, removeClient } = require('../../utils/sse');

// GET /notifications/stream
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const userId = req.user.id;
  addClient(userId, res);

  // Send initial ping
  res.write('data: {"type": "ping"}\n\n');

  req.on('close', () => {
    removeClient(userId, res);
  });
});

// GET /notifications
router.get('/', asyncHandler(async (req, res) => {
  const { unreadOnly } = req.query;
  let query = firestore.collection("notifications").where("userId", "==", req.user.id);
  
  if (unreadOnly === 'true') {
    query = query.where("isRead", "==", false);
  }

  const snapshot = await query.orderBy("createdAt", "desc").limit(20).get();
  const notifications = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  res.json({ success: true, data: notifications });
}));

// PATCH /notifications/:id/read
router.patch('/:id/read', asyncHandler(async (req, res) => {
  const docRef = firestore.collection("notifications").doc(req.params.id);
  const doc = await docRef.get();

  if (!doc.exists || doc.data().userId !== req.user.id) {
    throw new ApiError(404, "Notification not found");
  }

  await docRef.update({ isRead: true });
  res.json({ success: true, data: { id: doc.id, ...doc.data(), isRead: true } });
}));

// PATCH /notifications/read-all
router.patch('/read-all', asyncHandler(async (req, res) => {
  const snapshot = await firestore.collection("notifications")
    .where("userId", "==", req.user.id)
    .where("isRead", "==", false)
    .get();

  const batch = firestore.batch();
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, { isRead: true });
  });

  await batch.commit();
  res.json({ success: true, message: 'All notifications marked as read' });
}));

// Preferences
router.get('/preferences', asyncHandler(async (req, res) => {
  const snapshot = await firestore.collection("notificationPreferences")
    .where("userId", "==", req.user.id)
    .get();
  
  const preferences = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  res.json({ success: true, data: preferences });
}));

router.patch('/preferences', asyncHandler(async (req, res) => {
  const { type, inApp, email } = req.body;
  const prefRef = firestore.collection("notificationPreferences").doc(`${req.user.id}_${type}`);
  
  const prefData = { userId: req.user.id, type, inApp, email, updatedAt: new Date().toISOString() };
  await prefRef.set(prefData, { merge: true });

  res.json({ success: true, data: prefData });
}));

module.exports = router;
