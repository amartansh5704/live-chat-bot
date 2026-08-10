require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const setupSocket = require('./socket/socketHandler');

// Initialize Express
const app = express();

// Create HTTP server (needed for Socket.IO to attach to)
const server = http.createServer(app);

// Initialize Socket.IO with CORS configuration
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000', // React frontend URL
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// ========== MIDDLEWARE ==========
// WHY: Parse JSON bodies in requests, enable cross-origin requests from frontend
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// ========== REST API ROUTES ==========
// WHY: RESTful endpoints for authentication and message history retrieval
app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ========== START SERVER ==========
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Connect to MongoDB first
  await connectDB();

  // Setup WebSocket handlers
  setupSocket(io);

  // Start listening
  server.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket server ready`);
    console.log(`📊 REST API available at http://localhost:${PORT}/api`);
    console.log(`\n─────────────────────────────────────────────`);
  });
};

startServer();