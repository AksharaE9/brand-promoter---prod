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
 * Sends data to all connected clients for a specific user
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
 * Sends generic data to ALL connected clients (unnamed event)
 */
function broadcast(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(userClients => {
    userClients.forEach(res => {
      try {
        res.write(message);
      } catch (err) {
        // cleanup handled by onclose
      }
    });
  });
}

/**
 * Broadcasts a NAMED SSE event to ALL connected clients.
 * Frontend can listen with: eventSource.addEventListener(eventName, handler)
 */
function broadcastNamedEvent(eventName, payload) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  clients.forEach(userClients => {
    userClients.forEach(res => {
      try {
        res.write(message);
      } catch (err) {
        // cleanup handled by onclose
      }
    });
  });

  // Also broadcast as a standard message for clients that only use onmessage
  broadcast({ ...payload, type: eventName });
}

module.exports = {
  addClient,
  removeClient,
  sendToUser,
  broadcast,
  broadcastNamedEvent,
};
