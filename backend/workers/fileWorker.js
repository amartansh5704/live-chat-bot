// backend/workers/fileWorker.js
// ── SEPARATE PROCESS ──
// Run with: node workers/fileWorker.js
// WHY SEPARATE:
// 1. Heavy AI model loading doesn't slow down API server
// 2. Worker crash doesn't crash API server
// 3. Can scale independently (run multiple workers)
// 4. BullMQ handles job distribution between workers

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Worker } = require('bullmq');
const path = require('path');
const fs = require('fs');

// Import services
const { redisConnection } = require('../services/jobQueue');
const { publishProgress } = require('../services/progressBridge');
const { getS3FileBuffer } = require('../services/s3Service');
const { parseFile, getFileType } = require('../utils/fileParser');
const { processDocument } = require('../services/embeddingService');
const { saveFileChunks } = require('../services/postgresService');
const UploadedFile = require('../models/UploadedFile');
const connectDB = require('../config/db');

// ── Connect to MongoDB ──
// WHY: Worker is separate process, needs its own DB connection
connectDB().then(() => {
  console.log('\n🔧 File processing worker starting...');
  console.log('   Waiting for jobs from Redis queue...\n');
});

// ── Temp directory for downloaded files ──
const TEMP_DIR = path.join(__dirname, '..', 'uploads', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// ── Helper: clean up temp file safely ──
const cleanupTemp = (tempPath) => {
  try {
    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  } catch (e) {
    // Don't crash if cleanup fails
    console.warn('Temp cleanup warning:', e.message);
  }
};

// ── The Worker ──
const worker = new Worker(
  'file-processing',

  // This function runs for EACH job
  async (job) => {
    const {
      mongoFileId,
      userId,
      uploadId,
      s3Key,
      originalName
    } = job.data;

    console.log(`\n🔧 Processing job ${job.id}`);
    console.log(`   File: ${originalName}`);
    console.log(`   Attempt: ${job.attemptsMade + 1}/3`);
    

    let tempPath = null;

    try {
      // ══════════════════════════════════════════
      // STAGE 1: Download file from S3
      // ══════════════════════════════════════════
      await job.updateProgress(5);
      await publishProgress(userId, uploadId, {
        stage: 'embedding',
        progress: 5,
        message: 'Downloading file for processing...'
      });

      console.log(`   📥 Downloading from S3: ${s3Key}`);
      const fileBuffer = await getS3FileBuffer(s3Key);

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error(`Failed to download file from S3: ${s3Key}`);
      }

      // Write to temp file
      // WHY: File parsers (pdf-parse, mammoth) need file path not buffer
      const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
      tempPath = path.join(TEMP_DIR, `job_${job.id}_${safeName}`);
      fs.writeFileSync(tempPath, fileBuffer);

      console.log(`   💾 Temp file written: ${(fileBuffer.length / 1024).toFixed(1)} KB`);

      // ══════════════════════════════════════════
      // STAGE 2: Parse file content
      // ══════════════════════════════════════════
      await job.updateProgress(10);
      await publishProgress(userId, uploadId, {
        stage: 'embedding',
        progress: 10,
        message: 'Extracting content from file...'
      });

      const fileType = getFileType(originalName);
      console.log(`   📄 Parsing as: ${fileType}`);

      // Progress callback maps parser progress (0-100) → our range (10-55)
      const parseResult = await parseFile(
        tempPath,
        fileType,
        originalName,
        async (stage, pct, message) => {
          const mapped = 10 + Math.round(pct * 0.45);
          await job.updateProgress(mapped);
          await publishProgress(userId, uploadId, {
            stage: 'embedding',
            progress: mapped,
            message
          });
        }
      );

      console.log(`   📝 Parsed: ${parseResult.content?.length || 0} chars (${parseResult.status})`);

      // Update MongoDB with parsed content
      await UploadedFile.findByIdAndUpdate(mongoFileId, {
        parsedContent: parseResult.content || '',
        parseStatus: parseResult.status,
        parseError: parseResult.error || null,
        // Image metadata if applicable
        ...(parseResult.metadata && fileType === 'image' ? {
          imageMetadata: {
            width: parseResult.metadata.width,
            height: parseResult.metadata.height,
            format: parseResult.metadata.format,
            aspectRatio: parseResult.metadata.aspectRatio,
            ocrText: parseResult.metadata.ocr?.text || '',
            ocrConfidence: parseResult.metadata.ocr?.confidence || 0,
            ocrWordCount: parseResult.metadata.ocr?.wordCount || 0
          }
        } : {})
      });

      // ══════════════════════════════════════════
      // STAGE 3: Generate embeddings
      // ══════════════════════════════════════════
      if (parseResult.status !== 'success' || !parseResult.content || parseResult.content.length < 20) {
        // Nothing to embed
        await UploadedFile.findByIdAndUpdate(mongoFileId, {
          embeddingStatus: 'skipped'
        });

        await job.updateProgress(100);
        await publishProgress(userId, uploadId, {
          stage: 'complete',
          progress: 100,
          message: 'File uploaded (no content to vectorize)',
          chunkCount: 0
        });

        console.log(`   ⚠️  Skipping embeddings: ${parseResult.status}`);
        cleanupTemp(tempPath);
        return { success: true, chunkCount: 0, skipped: true };
      }

      await job.updateProgress(55);
      await publishProgress(userId, uploadId, {
        stage: 'embedding',
        progress: 55,
        message: 'Generating vector embeddings...'
      });

      console.log(`   🧠 Generating embeddings...`);
      const chunks = await processDocument(parseResult.content);
      console.log(`   📊 Created ${chunks.length} chunks`);

      // ══════════════════════════════════════════
      // STAGE 4: Save vectors to Supabase
      // ══════════════════════════════════════════
      await job.updateProgress(80);
      await publishProgress(userId, uploadId, {
        stage: 'embedding',
        progress: 80,
        message: `Saving ${chunks.length} vectors to database...`
      });

      let savedCount = 0;

      if (chunks.length > 0) {
        const saved = await saveFileChunks(mongoFileId, originalName, chunks);

        if (saved) {
          savedCount = chunks.length;

          // Update MongoDB - fully complete
          await UploadedFile.findByIdAndUpdate(mongoFileId, {
            embeddingStatus: 'success',
            chunkCount: chunks.length
          });

          console.log(`   ✅ Saved ${chunks.length} vectors to Supabase`);
        } else {
          throw new Error('Failed to save vectors to Supabase');
        }
      } else {
        await UploadedFile.findByIdAndUpdate(mongoFileId, {
          embeddingStatus: 'skipped'
        });
      }

      // ══════════════════════════════════════════
      // DONE
      // ══════════════════════════════════════════
      await job.updateProgress(100);
      await publishProgress(userId, uploadId, {
        stage: 'complete',
        progress: 100,
        message: savedCount > 0
          ? `${savedCount} vectors saved successfully`
          : 'File processed (no vectors)',
        chunkCount: savedCount
      });

      console.log(`\n✅ Job ${job.id} COMPLETE: ${originalName}`);
      console.log(`   Chunks: ${savedCount}`);

      cleanupTemp(tempPath);

      return { success: true, chunkCount: savedCount };

    } catch (error) {
      console.error(`\n❌ Job ${job.id} FAILED: ${error.message}`);

      cleanupTemp(tempPath);

      // Will retry if attemptsMade < 3
      const willRetry = job.attemptsMade < (job.opts.attempts - 1);

      await publishProgress(userId, uploadId, {
        stage: willRetry ? 'retrying' : 'failed',
        progress: 0,
        message: willRetry
          ? `Processing failed, retrying... (${job.attemptsMade + 1}/3)`
          : `Failed after 3 attempts: ${error.message}`,
        error: !willRetry,
        willRetry
      });

      // Update MongoDB with failure if final attempt
      if (!willRetry) {
        try {
          await UploadedFile.findByIdAndUpdate(mongoFileId, {
            parseStatus: 'failed',
            parseError: error.message,
            embeddingStatus: 'failed'
          });
        } catch (dbErr) {
          console.error('Failed to update MongoDB on error:', dbErr.message);
        }
      }

      // Re-throw so BullMQ marks job as failed and retries
      throw error;
    }
  },

  {
    connection: redisConnection,
    concurrency: 2,           // process 2 files simultaneously
    lockDuration: 300000,     // 5 min lock (large PDFs can take long)
    stalledInterval: 60000,   // check for stalled jobs every 60s
    maxStalledCount: 2        // re-queue stalled jobs up to 2 times
  }
);

// ── Worker event handlers ──
worker.on('active', (job) => {
  console.log(`\n▶️  Job active: ${job.id} (${job.data.originalName})`);
});

worker.on('completed', (job, result) => {
  console.log(`✅ Job completed: ${job.id} → ${result.chunkCount} chunks`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job failed: ${job?.id} → ${err.message}`);
  console.error(`   Attempts made: ${job?.attemptsMade}`);
});

worker.on('stalled', (jobId) => {
  // Job was being processed but worker died
  // BullMQ automatically re-queues stalled jobs
  console.warn(`⚠️  Job stalled (will be requeued): ${jobId}`);
});

worker.on('error', (err) => {
  console.error('Worker error:', err.message);
});

// ── Graceful shutdown ──
const shutdown = async () => {
  console.log('\n🛑 Worker shutting down...');
  await worker.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('🔧 Worker process started');
console.log(`   Concurrency: 2`);
console.log(`   Redis: ${process.env.REDIS_HOST || '127.0.0.1'}:${process.env.REDIS_PORT || 6379}`);

module.exports = worker;