require('dotenv').config();
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
const { testConnection } = require('./services/postgresService'); // ← NEW

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001'],
  credentials: true
}));
app.use(express.json());

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

  // NEW: Test PostgreSQL connection
  await testConnection();

  setupSocket(io);
  // ⭐ Wire IO to upload routes for progress emission
const uploadRoutesModule = require('./routes/upload');
if (uploadRoutesModule.setIO) {
  uploadRoutesModule.setIO(io);
}
  server.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 WebSocket ready`);
    console.log(`☁️  S3 Bucket: ${process.env.AWS_S3_BUCKET}`);
    console.log(`🐘 PostgreSQL: connected\n`);
    
  });
  
};

startServer();