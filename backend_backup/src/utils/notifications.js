const prisma = require('../config/prisma');
const { getIO } = require('../config/socket');
const { sendToUser } = require('./sse');

/**
 * Creates a notification in the DB and emits it via SSE and Socket.io
 */
async function sendNotification({ userId, title, message, link = null, type = 'INFO' }) {
  try {
    const notification = await prisma.notification.create({
      data: {
        userId,
        title,
        message,
        link,
        type,
      },
    });

    // 1. Send via SSE
    sendToUser(userId, notification);

    // 2. Send via Socket.io (fallback/legacy)
    try {
      const io = getIO();
      if (io) {
        io.to(userId).emit('notification', notification);
      }
    } catch (socketErr) {
      // socket.io might not be initialized
    }

    return notification;
  } catch (err) {
    console.error('[NOTIFICATION] Failed to create notification:', err.message);
    return null;
  }
}

async function notifyAdmins({ title, message, link = null, type = 'INFO' }) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE' },
      select: { id: true }
    });

    const promises = admins.map(admin => sendNotification({
      userId: admin.id,
      title,
      message,
      link,
      type
    }));

    await Promise.all(promises);
  } catch (err) {
    console.error('[NOTIFICATION] notifyAdmins failed:', err.message);
  }
}

module.exports = { sendNotification, notifyAdmins };
