import { io } from 'socket.io-client';

const SOCKET_URL = 'http://localhost:5000';

let socket = null;

// ── Initialize socket with reconnection settings ──
// WHY: When server goes down, socket auto-retries
//      When server comes back, 'connect' fires and we process queue
export const initSocket = (token) => {
  if (socket) {
    socket.disconnect();
  }

  socket = io(SOCKET_URL, {
    auth: {
      token: token
    },
    transports: ['websocket', 'polling'],
    // ── RECONNECTION CONFIG ──
    // WHY: These settings control auto-reconnect behavior
    reconnection: true,           // Enable auto reconnect
    reconnectionAttempts: Infinity, // Never stop trying
    reconnectionDelay: 1000,       // Start with 1 second delay
    reconnectionDelayMax: 10000,   // Max 10 seconds between retries
    timeout: 5000                  // Connection timeout
  });

  socket.on('connect', () => {
    console.log('✅ Connected to WebSocket server');
  });

  socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected:', reason);
  });

  // WHY: Track reconnection attempts for UI feedback
  socket.io.on('reconnect_attempt', (attempt) => {
    console.log(`🔄 Reconnection attempt ${attempt}...`);
  });

  socket.io.on('reconnect', (attempt) => {
    console.log(`✅ Reconnected after ${attempt} attempts`);
  });

  socket.on('connect_error', (error) => {
    console.log('⚠️ Connection error:', error.message);
  });

  return socket;
};

// ── Check if socket is currently connected ──
export const isConnected = () => {
  return socket?.connected || false;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};