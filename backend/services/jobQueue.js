// backend/services/jobQueue.js
require('dotenv').config();
const { Queue, QueueEvents } = require('bullmq');
const IORedis = require('ioredis');

// ── Redis Connection ──
// WHY: BullMQ uses Redis to persist jobs
//      If server crashes, jobs survive in Redis
const redisConnection = new IORedis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false
});

redisConnection.on('connect', () => {
  console.log('✅ Redis connected (job queue)');
});

redisConnection.on('error', (err) => {
  console.error('❌ Redis error:', err.message);
});

// ── The Queue ──
// Think of this as a to-do list stored in Redis
const fileProcessingQueue = new Queue('file-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,              // retry up to 3 times on failure
    backoff: {
      type: 'exponential',
      delay: 5000             // 5s, 10s, 20s between retries
    },
    removeOnComplete: {
      age: 24 * 3600,         // keep completed jobs for 24 hours
      count: 100              // keep last 100 completed
    },
    removeOnFail: {
      age: 7 * 24 * 3600      // keep failed jobs for 7 days
    }
  }
});

// ── Add job to queue ──
const addFileProcessingJob = async (jobData) => {
  try {
    const job = await fileProcessingQueue.add(
      'process-file',
      jobData,
      {
        // Use uploadId as jobId to prevent duplicates
        // WHY: If same file uploaded twice, second is ignored
        jobId: `upload-${jobData.uploadId}`
      }
    );
    console.log(`📋 Job queued: ${job.id} for ${jobData.originalName}`);
    return job;
  } catch (error) {
    console.error('Failed to add job to queue:', error.message);
    throw error;
  }
};

// ── Get job status ──
const getJobStatus = async (uploadId) => {
  try {
    const job = await fileProcessingQueue.getJob(`upload-${uploadId}`);
    if (!job) return null;

    const state = await job.getState();
    return {
      id: job.id,
      state,                        // waiting/active/completed/failed/delayed
      progress: job.progress || 0,
      data: job.data,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn
    };
  } catch (error) {
    console.error('Get job status error:', error.message);
    return null;
  }
};

// ── Get queue stats ──
const getQueueStats = async () => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      fileProcessingQueue.getWaitingCount(),
      fileProcessingQueue.getActiveCount(),
      fileProcessingQueue.getCompletedCount(),
      fileProcessingQueue.getFailedCount(),
      fileProcessingQueue.getDelayedCount()
    ]);
    return { waiting, active, completed, failed, delayed };
  } catch (error) {
    return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
  }
};

module.exports = {
  fileProcessingQueue,
  redisConnection,
  addFileProcessingJob,
  getJobStatus,
  getQueueStats
};