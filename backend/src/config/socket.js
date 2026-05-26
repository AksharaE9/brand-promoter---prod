const { Server } = require('socket.io');

let io;

const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        const allowedOrigins = process.env.CORS_ORIGIN
          ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
          : [];
        if (
          !origin ||
          allowedOrigins.includes('*') ||
          allowedOrigins.length === 0 ||
          allowedOrigins.includes(origin) ||
          origin.endsWith('.vercel.app') ||
          /^https:\/\/brand-promoter-prod-.*\.vercel\.app$/.test(origin) ||
          /^http:\/\/localhost:\d+$/.test(origin)
        ) {
          return callback(null, true);
        }
        callback(null, false);
      },
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`[SOCKET] User connected: ${socket.id}`);

    socket.on('join', (userId) => {
      socket.join(userId);
      console.log(`[SOCKET] User ${userId} joined their personal room`);
    });

    socket.on('disconnect', () => {
      console.log(`[SOCKET] User disconnected: ${socket.id}`);
    });
  });

  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

module.exports = { initSocket, getIO };
