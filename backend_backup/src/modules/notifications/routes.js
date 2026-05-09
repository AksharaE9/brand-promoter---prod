const express = require('express');
const router = express.Router();
const prisma = require('../../config/prisma');
const { auth } = require('../../middleware/auth');

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
router.get('/', async (req, res) => {
  try {
    const { unreadOnly } = req.query;
    const where = { userId: req.user.id };
    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.json({ success: true, data: notifications });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  try {
    const notification = await prisma.notification.update({
      where: { id: req.params.id, userId: req.user.id },
      data: { isRead: true }
    });
    res.json({ success: true, data: notification });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /notifications/read-all
router.patch('/read-all', async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false },
      data: { isRead: true }
    });
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /notifications/preferences
router.get('/preferences', async (req, res) => {
  try {
    const preferences = await prisma.userNotificationPreference.findMany({
      where: { userId: req.user.id }
    });
    res.json({ success: true, data: preferences });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /notifications/preferences
router.patch('/preferences', async (req, res) => {
  try {
    const { type, inApp, email } = req.body;
    const pref = await prisma.userNotificationPreference.upsert({
      where: {
        userId_type: { userId: req.user.id, type }
      },
      update: { inApp, email },
      create: { userId: req.user.id, type, inApp, email }
    });
    res.json({ success: true, data: pref });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
