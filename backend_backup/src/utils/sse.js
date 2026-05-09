// SSE Clients store
const clients = new Map();

/**
 * Adds a client to the SSE store
 */
function addClient(userId, res) {
  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId).add(res);
}

/**
 * Removes a client from the SSE store
 */
function removeClient(userId, res) {
  const userClients = clients.get(userId);
  if (userClients) {
    userClients.delete(res);
    if (userClients.size === 0) {
      clients.delete(userId);
    }
  }
}

/**
 * Sends data to all connected clients for a user
 */
function sendToUser(userId, data) {
  const userClients = clients.get(userId);
  if (userClients) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    userClients.forEach(res => {
      try {
        res.write(message);
      } catch (err) {
        console.error(`[SSE] Failed to write to client for user ${userId}:`, err.message);
      }
    });
  }
}

/**
 * Sends data to ALL connected clients regardless of userId
 */
function broadcast(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(userClients => {
    userClients.forEach(res => {
      try {
        res.write(message);
      } catch (err) {
        // cleanup handled by onclose usually
      }
    });
  });
}

module.exports = {
  addClient,
  removeClient,
  sendToUser,
  broadcast
};
