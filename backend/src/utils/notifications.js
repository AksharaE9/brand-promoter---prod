const prisma = require('../config/db');
const { sendToUser } = require('./sse');

/**
 * Creates a notification in the DB and emits it via SSE
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
        isRead: false,
      },
    });

    // Emit via SSE
    sendToUser(userId, notification);

    return notification;
  } catch (err) {
    console.error('[NOTIFICATION] Failed to create notification:', err.message);
    return null;
  }
}

async function notifyAdmins({ title, message, link = null, type = 'INFO' }) {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'SUPER_ADMIN', status: 'ACTIVE', isDeleted: false },
      select: { id: true },
    });

    await Promise.all(admins.map(admin => sendNotification({
      userId: admin.id,
      title,
      message,
      link,
      type,
    })));
  } catch (err) {
    console.error('[NOTIFICATION] notifyAdmins failed:', err.message);
  }
}

module.exports = { sendNotification, notifyAdmins };

