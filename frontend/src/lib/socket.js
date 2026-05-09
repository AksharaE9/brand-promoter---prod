import { io } from 'socket.io-client';
import { getStoredToken } from './api';

let socket;

export const initClientSocket = (userId) => {
  if (socket) return socket;

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
  socket = io(API_URL, {
    auth: {
      token: getStoredToken(),
    },
  });

  socket.on('connect', () => {
    console.log('[SOCKET] Connected to server');
    if (userId) {
      socket.emit('join', userId);
    }
  });

  return socket;
};

export const getClientSocket = () => socket;
