require('dotenv').config();
const IORedis = require('ioredis');

const subscriber = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const publisher = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const setupProgressBridge = (io) => {
  subscriber.subscribe('upload-progress', (err) => {
    if (err) {
      console.error('❌ Progress bridge subscribe error:', err.message);
      return;
    }
    console.log('📡 Progress bridge ready (Redis → Socket)');
  });

  subscriber.on('message', (channel, message) => {
    if (channel !== 'upload-progress') return;

    try {
      const data = JSON.parse(message);
      const { userId, uploadId, ...progressData } = data;

      if (!userId || !uploadId) {
        console.warn('⚠️ Progress missing userId or uploadId:', data);
        return;
      }

      // ⭐ DEBUG: Log every progress event
      console.log(`📡 Bridge: uploadId=${uploadId} stage=${progressData.stage} progress=${progressData.progress}`);

      // Find operator sockets
      let sent = 0;
      io.sockets.sockets.forEach((socket) => {
        if (socket.user && socket.user._id.toString() === userId.toString()) {
          socket.emit('upload_progress', {
            uploadId,
            ...progressData
          });
          sent++;
        }
      });

      // ⭐ DEBUG: Log if nobody received it
      if (sent === 0) {
        console.warn(`⚠️ No sockets found for userId: ${userId}`);
        console.warn(`   Connected sockets:`);
        io.sockets.sockets.forEach((socket) => {
          console.warn(`   - ${socket.id}: user=${socket.user?.username} (${socket.user?._id})`);
        });
      } else {
        console.log(`   → Sent to ${sent} socket(s)`);
      }

    } catch (err) {
      console.error('Progress bridge parse error:', err.message);
    }
  });

  subscriber.on('error', (err) => {
    console.error('Progress bridge Redis error:', err.message);
  });
};

const publishProgress = async (userId, uploadId, data) => {
  try {
    const payload = JSON.stringify({ userId, uploadId, ...data });
    // ⭐ DEBUG
    console.log(`📤 Publishing: uploadId=${uploadId} stage=${data.stage} progress=${data.progress}`);
    await publisher.publish('upload-progress', payload);
  } catch (error) {
    console.error('Publish progress error:', error.message);
  }
};

module.exports = {
  setupProgressBridge,
  publishProgress,
  publisher
};