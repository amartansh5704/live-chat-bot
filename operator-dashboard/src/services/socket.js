import { io } from 'socket.io-client';

let socket = null;

export const initSocket = (token) => {
  if (socket) socket.disconnect();

  socket = io('http://localhost:5000', {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000
  });

  socket.on('connect', () => console.log('✅ Operator connected'));
  socket.on('disconnect', () => console.log('❌ Operator disconnected'));

  return socket;
};

export const getSocket = () => socket;
export const disconnectSocket = () => {
  if (socket) { socket.disconnect(); socket = null; }
};