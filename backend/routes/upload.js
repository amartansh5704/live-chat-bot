const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const fs = require('fs');
const UploadedFile = require('../models/UploadedFile');
const { protect } = require('../middleware/auth');
const { getFileType } = require('../utils/fileParser');
const { s3Client, BUCKET, deleteFromS3, getSignedFileUrl } = require('../services/s3Service');
const { generateEmbedding } = require('../services/embeddingService');
const { deleteFileChunks, searchSimilar, getStats } = require('../services/postgresService');
const { addFileProcessingJob, getJobStatus, getQueueStats } = require('../services/jobQueue');
const { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand } = require('@aws-sdk/client-s3');

const router = express.Router();

const operatorOnly = (req, res, next) => {
  if (req.user?.role !== 'operator') {
    return res.status(403).json({ message: 'Operator access only' });
  }
  next();
};

// ══════════════════════════════════════════════════════════
//  RESUMABLE UPLOAD - Custom Chunked Upload
//  Uses S3 Multipart Upload API directly
//
//  Flow:
//  1. POST /resumable/init      → create S3 multipart upload, get uploadId
//  2. POST /resumable/chunk     → upload each chunk to S3
//  3. POST /resumable/complete  → assemble all chunks in S3
//  4. POST /resumable/abort     → cancel if needed
//
//  Resume flow:
//  Client stores { uploadId, s3UploadId, parts, mongoFileId } in localStorage
//  On reconnect: skip to step 2 with stored uploadId
// ══════════════════════════════════════════════════════════

// ── Step 1: Initialize multipart upload ──
// Client calls this ONCE before sending any chunks
router.post('/resumable/init', protect, operatorOnly, async (req, res) => {
  try {
    const { fileName, fileSize, fileType, uploadId } = req.body;

    if (!fileName || !fileSize || !uploadId) {
      return res.status(400).json({ message: 'fileName, fileSize, uploadId required' });
    }

    const sanitized = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const date = new Date();
    const s3Key = `uploads/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${Date.now()}-${sanitized}`;

    // Create S3 multipart upload
    // WHY: S3 holds the chunks, not our server
    //      Even if server restarts, chunks are safe in S3
    const command = new CreateMultipartUploadCommand({
      Bucket: BUCKET,
      Key: s3Key,
      ContentType: fileType || 'application/octet-stream',
      Metadata: {
        originalName: fileName,
        uploadedBy: req.user._id.toString()
      }
    });

    const s3Response = await s3Client.send(command);
    const s3UploadId = s3Response.UploadId;

    // Create MongoDB record
    const detectedFileType = getFileType(fileName);
    const fileRecord = await UploadedFile.create({
      uploadedBy: req.user._id,
      uploaderName: req.user.username,
      originalName: fileName,
      storedName: sanitized,
      s3Bucket: BUCKET,
      s3Key,
      s3Url: '',
      fileType: detectedFileType,
      mimeType: fileType || 'application/octet-stream',
      size: fileSize,
      parseStatus: 'pending',
      embeddingStatus: 'pending',
      uploadStatus: 'uploading'
    });

    console.log(`\n📤 Multipart upload initialized`);
    console.log(`   File: ${fileName}`);
    console.log(`   S3 Key: ${s3Key}`);
    console.log(`   S3 UploadId: ${s3UploadId}`);
    console.log(`   MongoDB: ${fileRecord._id}`);

    res.json({
      uploadId,           // our tracking ID
      s3UploadId,         // S3 multipart upload ID
      s3Key,              // S3 object key
      mongoFileId: fileRecord._id.toString()
    });

  } catch (error) {
    console.error('Init upload error:', error.message);
    res.status(500).json({ message: 'Failed to initialize upload: ' + error.message });
  }
});

// ── Step 2: Upload a single chunk ──
// Called for each 5MB piece of the file
// multer handles the binary data
const chunkUpload = multer({
  storage: multer.memoryStorage(), // keep chunk in memory
  limits: { fileSize: 10 * 1024 * 1024 } // max 10MB per chunk
});

router.post('/resumable/chunk', protect, operatorOnly, chunkUpload.single('chunk'), async (req, res) => {
  try {
    const { s3UploadId, s3Key, partNumber } = req.body;

    if (!s3UploadId || !s3Key || !partNumber || !req.file) {
      return res.status(400).json({ message: 'Missing chunk data' });
    }

    const partNum = parseInt(partNumber);

    // Upload this chunk to S3
    const command = new UploadPartCommand({
      Bucket: BUCKET,
      Key: s3Key,
      UploadId: s3UploadId,
      PartNumber: partNum,
      Body: req.file.buffer,
      ContentLength: req.file.size
    });

    const s3Response = await s3Client.send(command);

    console.log(`   📦 Chunk ${partNum} uploaded: ${(req.file.size / 1024).toFixed(0)} KB`);

    res.json({
      partNumber: partNum,
      etag: s3Response.ETag
      // Client stores this ETag - needed for complete step
    });

  } catch (error) {
    console.error('Chunk upload error:', error.message);
    res.status(500).json({ message: 'Chunk upload failed: ' + error.message });
  }
});

// ── Step 3: Complete multipart upload ──
// After ALL chunks uploaded, assemble them in S3
router.post('/resumable/complete', protect, operatorOnly, async (req, res) => {
  try {
    const { s3UploadId, s3Key, mongoFileId, uploadId, parts } = req.body;

    if (!s3UploadId || !s3Key || !mongoFileId || !parts?.length) {
      return res.status(400).json({ message: 'Missing completion data' });
    }

    // Tell S3 to assemble all chunks into one file
    const command = new CompleteMultipartUploadCommand({
      Bucket: BUCKET,
      Key: s3Key,
      UploadId: s3UploadId,
      MultipartUpload: {
        Parts: parts.map(p => ({
          PartNumber: p.partNumber,
          ETag: p.etag
        }))
      }
    });

    await s3Client.send(command);

    const s3Url = `https://${BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

    // Update MongoDB - upload complete
    await UploadedFile.findByIdAndUpdate(mongoFileId, {
      s3Url,
      uploadStatus: 'complete'
    });

    console.log(`\n✅ Multipart upload complete: ${s3Key}`);

    // Queue background processing job
    await addFileProcessingJob({
      mongoFileId,
      userId: req.user._id.toString(),
      uploadId,
      s3Key,
      originalName: req.body.fileName || 'unknown',
      fileSize: req.body.fileSize || 0
    });

    console.log(`   📋 Processing job queued`);

    res.json({
      message: 'Upload complete, processing started',
      mongoFileId,
      uploadId
    });

  } catch (error) {
    console.error('Complete upload error:', error.message);
    res.status(500).json({ message: 'Failed to complete upload: ' + error.message });
  }
});

// ── Step 4: Abort multipart upload ──
// Called when user cancels
router.post('/resumable/abort', protect, operatorOnly, async (req, res) => {
  try {
    const { s3UploadId, s3Key, mongoFileId } = req.body;

    if (s3UploadId && s3Key) {
      const command = new AbortMultipartUploadCommand({
        Bucket: BUCKET,
        Key: s3Key,
        UploadId: s3UploadId
      });
      await s3Client.send(command);
      console.log(`🚫 Multipart upload aborted: ${s3Key}`);
    }

    if (mongoFileId) {
      await UploadedFile.findByIdAndDelete(mongoFileId);
    }

    res.json({ message: 'Upload aborted' });

  } catch (error) {
    console.error('Abort error:', error.message);
    res.status(500).json({ message: 'Abort failed' });
  }
});

// ══════════════════════════════════════════════════════════
//  LEGACY UPLOAD (single shot, still works)
// ══════════════════════════════════════════════════════════
const legacyUpload = multer({
  storage: multerS3({
    s3: s3Client,
    bucket: BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, {
        originalName: file.originalname,
        uploadedBy: req.user?._id?.toString() || 'unknown'
      });
    },
    key: (req, file, cb) => {
      const date = new Date();
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const timestamp = Date.now();
      const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
      cb(null, `uploads/${year}/${month}/${timestamp}-${sanitized}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|docx|doc|txt|md|csv|json|xml|png|jpg|jpeg|gif|webp|svg|js|py|html|css/i;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (allowedTypes.test(ext)) cb(null, true);
    else cb(new Error(`File type .${ext} not allowed`), false);
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

router.post('/file', protect, operatorOnly, legacyUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const uploadId = req.headers['x-upload-id'] || Date.now().toString();
    const fileType = getFileType(req.file.originalname);

    const fileRecord = await UploadedFile.create({
      uploadedBy: req.user._id,
      uploaderName: req.user.username,
      originalName: req.file.originalname,
      storedName: req.file.key.split('/').pop(),
      s3Bucket: BUCKET,
      s3Key: req.file.key,
      s3Url: req.file.location,
      fileType,
      mimeType: req.file.mimetype,
      size: req.file.size,
      parseStatus: 'pending',
      embeddingStatus: 'pending',
      uploadStatus: 'complete'
    });

    await addFileProcessingJob({
      mongoFileId: fileRecord._id.toString(),
      userId: req.user._id.toString(),
      uploadId,
      s3Key: req.file.key,
      originalName: req.file.originalname,
      fileSize: req.file.size
    });

    res.status(201).json({
      message: 'File uploaded, processing in background',
      file: fileRecord,
      uploadId
    });

  } catch (error) {
    console.error('Legacy upload error:', error.message);
    if (req.file?.key) await deleteFromS3(req.file.key);
    res.status(500).json({ message: 'Upload failed: ' + error.message });
  }
});

// ══════════════════════════════════════════════════════════
//  JOB STATUS
// ══════════════════════════════════════════════════════════
router.get('/job-status/:uploadId', protect, operatorOnly, async (req, res) => {
  try {
    const status = await getJobStatus(req.params.uploadId);
    if (!status) return res.status(404).json({ message: 'Job not found' });
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get job status' });
  }
});

router.get('/queue-stats', protect, operatorOnly, async (req, res) => {
  try {
    const stats = await getQueueStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get queue stats' });
  }
});

// ══════════════════════════════════════════════════════════
//  FILE MANAGEMENT
// ══════════════════════════════════════════════════════════
router.get('/files', protect, operatorOnly, async (req, res) => {
  try {
    const { fileType, search } = req.query;
    const filter = {};
    if (fileType && fileType !== 'all') filter.fileType = fileType;
    if (search) {
      filter.$or = [
        { originalName: { $regex: search, $options: 'i' } },
        { parsedContent: { $regex: search, $options: 'i' } }
      ];
    }
    const files = await UploadedFile.find(filter)
      .sort({ uploadedAt: -1 })
      .select('-parsedContent');
    res.json(files);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch files' });
  }
});

router.get('/files/:id', protect, operatorOnly, async (req, res) => {
  try {
    const file = await UploadedFile.findById(req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found' });
    res.json(file);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch file' });
  }
});

router.get('/download/:id', protect, operatorOnly, async (req, res) => {
  try {
    const file = await UploadedFile.findById(req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found' });
    const signedUrl = await getSignedFileUrl(file.s3Key, 3600);
    if (!signedUrl) return res.status(500).json({ message: 'Could not generate URL' });
    res.redirect(signedUrl);
  } catch (error) {
    res.status(500).json({ message: 'Download failed' });
  }
});

router.delete('/files/:id', protect, operatorOnly, async (req, res) => {
  try {
    const file = await UploadedFile.findById(req.params.id);
    if (!file) return res.status(404).json({ message: 'File not found' });
    await deleteFromS3(file.s3Key);
    await deleteFileChunks(file._id);
    await UploadedFile.findByIdAndDelete(req.params.id);
    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Delete failed' });
  }
});

router.get('/stats', protect, operatorOnly, async (req, res) => {
  try {
    const totalFiles = await UploadedFile.countDocuments();
    const totalSize = await UploadedFile.aggregate([
      { $group: { _id: null, total: { $sum: '$size' } } }
    ]);
    const byType = await UploadedFile.aggregate([
      { $group: { _id: '$fileType', count: { $sum: 1 } } }
    ]);
    const pgStats = await getStats();
    res.json({
      totalFiles,
      totalSize: totalSize[0]?.total || 0,
      byType: byType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
      embeddings: pgStats
    });
  } catch (error) {
    res.status(500).json({ message: 'Stats failed' });
  }
});

router.post('/search', protect, operatorOnly, async (req, res) => {
  try {
    const { query, limit = 5 } = req.body;
    if (!query?.trim()) return res.status(400).json({ message: 'Query required' });

    const queryEmbedding = await generateEmbedding(query);
    if (!queryEmbedding) return res.status(500).json({ message: 'Embedding failed' });

    const results = await searchSimilar(queryEmbedding, limit);
    const enriched = await Promise.all(
      results.map(async (result) => {
        const file = await UploadedFile.findById(result.mongo_file_id)
          .select('originalName fileType uploaderName uploadedAt');
        return { ...result, file: file || null, similarityPercent: Math.round(result.similarity * 100) };
      })
    );

    res.json({ query, results: enriched });
  } catch (error) {
    res.status(500).json({ message: 'Search failed: ' + error.message });
  }
});

module.exports = router;