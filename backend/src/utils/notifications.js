const { db: firestore } = require('../config/firebase');
const { sendToUser } = require('./sse');

/**
 * Creates a notification in the DB and emits it via SSE
 */
async function sendNotification({ userId, title, message, link = null, type = 'INFO' }) {
  try {
    const notificationData = {
      userId,
      title,
      message,
      link,
      type,
      isRead: false,
      createdAt: new Date().toISOString(),
    };

    const docRef = await firestore.collection("notifications").add(notificationData);
    const notification = { id: docRef.id, ...notificationData };

    // 1. Send via SSE
    sendToUser(userId, notification);

    return notification;
  } catch (err) {
    console.error('[NOTIFICATION] Failed to create notification:', err.message);
    return null;
  }
}

async function notifyAdmins({ title, message, link = null, type = 'INFO' }) {
  try {
    const snapshot = await firestore.collection("users")
      .where("role", "==", "SUPER_ADMIN")
      .where("status", "==", "ACTIVE")
      .get();

    const admins = snapshot.docs.map(doc => ({ id: doc.id }));

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
