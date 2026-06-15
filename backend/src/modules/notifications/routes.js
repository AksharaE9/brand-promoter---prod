const express = require('express');
const router = express.Router();
const prisma = require('../../config/db');
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

  const orgId = req.user.organizationId || 'defaultOrg';
  const userId = req.user.id;
  addClient(orgId, userId, res);

  // Send initial ping
  res.write('data: {"type": "ping"}\n\n');

  req.on('close', () => {
    removeClient(orgId, userId, res);
  });
});

// GET /notifications
router.get('/', asyncHandler(async (req, res) => {
  const { unreadOnly } = req.query;

  const where = { userId: req.user.id };
  if (unreadOnly === 'true') where.isRead = false;

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, type: true, title: true, message: true, link: true, isRead: true, createdAt: true },
  });

  res.json({ success: true, data: notifications });
}));

// POST /notifications (manual push)
router.post('/', asyncHandler(async (req, res) => {
  const { title, message, type, recipientId } = req.body;

  const notif = await prisma.notification.create({
    data: {
      userId: recipientId || req.user.id,
      title,
      message,
      type: type || 'INFO',
      isRead: false,
    },
  });

  const sse = require('../../utils/sse');
  sse.sendToUser(notif.userId, 'NOTIFICATION', {
    notificationId: notif.id,
    type: notif.type,
    title: notif.title,
    message: notif.message,
    createdAt: notif.createdAt,
    isRead: false,
  });

  res.json({ success: true, data: notif });
}));

// PATCH /notifications/:id/read
router.patch('/:id/read', asyncHandler(async (req, res) => {
  const notif = await prisma.notification.findUnique({ where: { id: req.params.id } });

  if (!notif || notif.userId !== req.user.id) {
    throw new ApiError(404, 'Notification not found');
  }

  const updated = await prisma.notification.update({
    where: { id: req.params.id },
    data: { isRead: true },
  });
  res.json({ success: true, data: updated });
}));

// PATCH /notifications/read-all
router.patch('/read-all', asyncHandler(async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, isRead: false },
    data: { isRead: true },
  });
  res.json({ success: true, message: 'All notifications marked as read' });
}));

// Preferences — simplified (stored in-memory or as JSON in user record)
router.get('/preferences', asyncHandler(async (req, res) => {
  res.json({ success: true, data: [] });
}));

router.patch('/preferences', asyncHandler(async (req, res) => {
  const { type, inApp, email } = req.body;
  res.json({ success: true, data: { userId: req.user.id, type, inApp, email } });
}));

module.exports = router;
