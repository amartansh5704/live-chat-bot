require('dotenv').config();

// TEMPORARY DEBUG - remove after fix
console.log('JWT_SECRET loaded:', !!process.env.JWT_SECRET);
console.log('JWT_SECRET length:', process.env.JWT_SECRET?.length);

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');
const authRoutes = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const operatorRoutes = require('./routes/operator');
const uploadRoutes = require('./routes/upload');
const setupSocket = require('./socket/socketHandler');
const { testConnection } = require('./services/postgresService');
const { setupProgressBridge } = require('./services/progressBridge');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    methods: ['GET', 'POST', 'PATCH', 'HEAD', 'DELETE', 'OPTIONS'],
    credentials: true
  }
});

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'HEAD', 'DELETE', 'OPTIONS']
}));

app.use(express.json());

// Debug middleware - remove after fixing
app.use('/api/upload/resumable', (req, res, next) => {
  console.log(`\n🔍 Resumable request: ${req.method} ${req.url}`);
  console.log(`   Auth: ${req.headers.authorization?.substring(0, 30)}...`);
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/operator', operatorRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  await testConnection();

  setupSocket(io);
  setupProgressBridge(io);

  server.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket ready`);
    console.log(`☁️  S3 Bucket: ${process.env.AWS_S3_BUCKET}`);
    console.log(`🐘 PostgreSQL: connected`);
    console.log(`📋 Job queue: Redis-backed (BullMQ)`);
    console.log(`\n💡 Start worker: npm run worker\n`);
  });
};

startServer();