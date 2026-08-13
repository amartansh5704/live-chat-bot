const express = require('express');
const multer = require('multer');
const multerS3 = require('multer-s3');
const path = require('path');
const UploadedFile = require('../models/UploadedFile');
const { protect } = require('../middleware/auth');
const { parseFile, getFileType } = require('../utils/fileParser');
const { s3Client, BUCKET, deleteFromS3, getSignedFileUrl, getS3FileBuffer } = require('../services/s3Service');
const { processDocument, generateEmbedding } = require('../services/embeddingService');
const { saveFileChunks, deleteFileChunks, searchSimilar, getStats } = require('../services/postgresService');
const fs = require('fs');

const router = express.Router();

// ⭐ NEW: Get io instance to emit progress
let ioInstance = null;
const setIO = (io) => {
  ioInstance = io;
};

// Emit progress to specific user
const emitProgress = (userId, uploadId, data) => {
  if (!ioInstance) return;

  // Emit to all sockets of this user
  ioInstance.sockets.sockets.forEach((socket) => {
    if (socket.user && socket.user._id.toString() === userId.toString()) {
      socket.emit('upload_progress', {
        uploadId,
        ...data
      });
    }
  });
};

const operatorOnly = (req, res, next) => {
  if (req.user.role !== 'operator') {
    return res.status(403).json({ message: 'Operator access only' });
  }
  next();
};

const upload = multer({
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
    if (allowedTypes.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type .${ext} not allowed`), false);
    }
  },
  limits: {
    fileSize: 20 * 1024 * 1024
  }
});

// ⭐ UPLOAD WITH PROGRESS TRACKING
router.post('/file', protect, operatorOnly, upload.single('file'), async (req, res) => {
  let fileRecord = null;
  let tempPath = null;
  const uploadId = req.headers['x-upload-id'] || Date.now().toString();
  const userId = req.user._id;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    console.log(`\n📤 Stage 1 COMPLETE: File uploaded to S3`);
    console.log(`   File: ${req.file.originalname}`);
    console.log(`   Size: ${(req.file.size / 1024).toFixed(1)} KB`);

    // ⭐ EMIT: Storage upload complete
    emitProgress(userId, uploadId, {
      stage: 'stored',
      progress: 100,
      message: 'Uploaded to storage'
    });

    // ⭐ EMIT: Starting embeddings stage
    emitProgress(userId, uploadId, {
      stage: 'embedding',
      progress: 0,
      message: 'Preparing to process content...'
    });

    const fileType = getFileType(req.file.originalname);

    fileRecord = await UploadedFile.create({
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
      embeddingStatus: 'pending'
    });

    // ⭐ Return response IMMEDIATELY - client doesn't wait for embeddings
    res.status(201).json({
      message: 'File uploaded successfully',
      file: fileRecord,
      uploadId
    });

    // ⭐ Continue processing in background
    processFileInBackground(fileRecord, req.file, userId, uploadId);

  } catch (error) {
    console.error('❌ Upload error:', error.message);

    if (req.file?.key) {
      await deleteFromS3(req.file.key);
    }
    if (fileRecord) {
      await UploadedFile.findByIdAndDelete(fileRecord._id);
    }

    emitProgress(userId, uploadId, {
      stage: 'failed',
      progress: 0,
      message: 'Upload failed: ' + error.message,
      error: true
    });

    if (!res.headersSent) {
      res.status(500).json({ message: 'Upload failed: ' + error.message });
    }
  }
});

// ⭐ Background processing function
async function processFileInBackground(fileRecord, s3File, userId, uploadId) {
  let tempPath = null;

  try {
    console.log(`🔍 Stage 2: Downloading from S3...`);
    emitProgress(userId, uploadId, {
      stage: 'embedding',
      progress: 5,
      message: 'Downloading file for processing...'
    });

    const fileBuffer = await getS3FileBuffer(s3File.key);
    if (!fileBuffer) throw new Error('Failed to download from S3');

    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    tempPath = path.join(uploadsDir, `temp_${Date.now()}_${s3File.key.split('/').pop()}`);
    fs.writeFileSync(tempPath, fileBuffer);

    const fileType = getFileType(s3File.originalname);

    // Parse with progress callback
    emitProgress(userId, uploadId, {
      stage: 'embedding',
      progress: 10,
      message: 'Extracting content...'
    });

    const parseResult = await parseFile(
      tempPath,
      fileType,
      s3File.originalname,
      // Progress callback
      (stage, pct, message) => {
        emitProgress(userId, uploadId, {
          stage: 'embedding',
          progress: 10 + Math.round(pct * 0.5), // Map to 10-60%
          message
        });
      }
    );

    console.log(`   Content: ${parseResult.content?.length || 0} chars`);

    fileRecord.parsedContent = parseResult.content || '';
    fileRecord.parseStatus = parseResult.status;
    fileRecord.parseError = parseResult.error || null;

    if (fileType === 'image' && parseResult.metadata) {
      fileRecord.imageMetadata = {
        width: parseResult.metadata.width,
        height: parseResult.metadata.height,
        format: parseResult.metadata.format,
        aspectRatio: parseResult.metadata.aspectRatio,
        ocrText: parseResult.metadata.ocr?.text || '',
        ocrConfidence: parseResult.metadata.ocr?.confidence || 0,
        ocrWordCount: parseResult.metadata.ocr?.wordCount || 0
      };
    }

    await fileRecord.save();

    // Generate embeddings
    if (parseResult.status === 'success' && parseResult.content?.length > 20) {
      emitProgress(userId, uploadId, {
        stage: 'embedding',
        progress: 65,
        message: 'Generating vector embeddings...'
      });

      const chunks = await processDocument(parseResult.content);

      emitProgress(userId, uploadId, {
        stage: 'embedding',
        progress: 85,
        message: `Saving ${chunks.length} vectors to database...`
      });

      if (chunks.length > 0) {
        const saved = await saveFileChunks(fileRecord._id, fileRecord.originalName, chunks);

        if (saved) {
          fileRecord.embeddingStatus = 'success';
          fileRecord.chunkCount = chunks.length;
          await fileRecord.save();

          console.log(`✅ ALL COMPLETE: ${chunks.length} vectors saved`);

          emitProgress(userId, uploadId, {
            stage: 'complete',
            progress: 100,
            message: `${chunks.length} vectors saved`,
            chunkCount: chunks.length
          });
        } else {
          fileRecord.embeddingStatus = 'failed';
          await fileRecord.save();
          emitProgress(userId, uploadId, {
            stage: 'failed',
            progress: 0,
            message: 'Failed to save vectors',
            error: true
          });
        }
      } else {
        fileRecord.embeddingStatus = 'skipped';
        await fileRecord.save();
        emitProgress(userId, uploadId, {
          stage: 'complete',
          progress: 100,
          message: 'No content to vectorize',
          chunkCount: 0
        });
      }
    } else {
      fileRecord.embeddingStatus = 'skipped';
      await fileRecord.save();
      emitProgress(userId, uploadId, {
        stage: 'complete',
        progress: 100,
        message: 'File uploaded (no vectors)',
        chunkCount: 0
      });
    }

    if (tempPath && fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

  } catch (error) {
    console.error('❌ Background processing failed:', error.message);

    if (tempPath && fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch (e) {}
    }

    if (fileRecord) {
      fileRecord.parseStatus = 'failed';
      fileRecord.parseError = error.message;
      await fileRecord.save();
    }

    emitProgress(userId, uploadId, {
      stage: 'failed',
      progress: 0,
      message: 'Processing failed: ' + error.message,
      error: true
    });
  }
}

// ... rest of your routes (files list, download, delete, etc.)

// GET files
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
    if (!signedUrl) return res.status(500).json({ message: 'Could not generate download URL' });
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
    if (!queryEmbedding) return res.status(500).json({ message: 'Failed to generate query embedding' });

    const results = await searchSimilar(queryEmbedding, limit);

    const enriched = await Promise.all(
      results.map(async (result) => {
        const file = await UploadedFile.findById(result.mongo_file_id)
          .select('originalName fileType uploaderName uploadedAt');
        return {
          ...result,
          file: file || null,
          similarityPercent: Math.round(result.similarity * 100)
        };
      })
    );

    res.json({ query, results: enriched });
  } catch (error) {
    res.status(500).json({ message: 'Search failed: ' + error.message });
  }
});

module.exports = router;
module.exports.setIO = setIO;