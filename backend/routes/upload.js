const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const UploadedFile = require('../models/UploadedFile');
const { protect } = require('../middleware/auth');
const { parseFile, getFileType } = require('../utils/fileParser');

const router = express.Router();

// Only operators can upload/manage files
const operatorOnly = (req, res, next) => {
  if (req.user.role !== 'operator') {
    return res.status(403).json({ message: 'Operator access only' });
  }
  next();
};

// ── Multer Storage Config ──
// WHY: Multer needs to know WHERE to save files and HOW to name them
const uploadsDir = path.join(__dirname, '..', 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Prefix with timestamp to avoid collisions
    // "report.pdf" → "1699234567-report.pdf"
    const timestamp = Date.now();
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${timestamp}-${sanitized}`);
  }
});

// File filter - what types are allowed
const fileFilter = (req, file, cb) => {
  const allowedTypes = /pdf|docx|doc|txt|md|csv|json|xml|png|jpg|jpeg|gif|webp|svg|js|py|html|css/i;
  const ext = path.extname(file.originalname).toLowerCase().replace('.', '');

  if (allowedTypes.test(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type .${ext} not allowed`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 20 * 1024 * 1024 // 20 MB max
  }
});

// ═══════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════

// @route   POST /api/upload/file
// @desc    Upload a single file
// @access  Operator only
router.post('/file', protect, operatorOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    console.log(`📤 File uploaded: ${req.file.originalname} (${req.file.size} bytes)`);

    const fileType = getFileType(req.file.originalname);

    // Save metadata to MongoDB first (with pending status)
    const fileRecord = await UploadedFile.create({
      uploadedBy: req.user._id,
      uploaderName: req.user.username,
      originalName: req.file.originalname,
      storedName: req.file.filename,
      filePath: req.file.path,
      fileType,
      mimeType: req.file.mimetype,
      size: req.file.size,
      parseStatus: 'pending'
    });

    // Parse file content (async - don't wait forever)
    console.log(`🔍 Parsing ${fileType} file...`);
    const parseResult = await parseFile(req.file.path, fileType);

    // Update the record with parsed content
    fileRecord.parsedContent = parseResult.content || '';
    fileRecord.parseStatus = parseResult.status;
    fileRecord.parseError = parseResult.error || null;
    await fileRecord.save();

    console.log(`✅ Parse ${parseResult.status}: ${req.file.originalname}`);

    res.status(201).json({
      message: 'File uploaded successfully',
      file: fileRecord
    });

  } catch (error) {
    console.error('❌ Upload error:', error.message);

    // Cleanup: delete the file if DB save failed
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ message: 'Upload failed: ' + error.message });
  }
});

// @route   POST /api/upload/multiple
// @desc    Upload multiple files at once
// @access  Operator only
router.post('/multiple', protect, operatorOnly, upload.array('files', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const results = [];

    for (const file of req.files) {
      try {
        const fileType = getFileType(file.originalname);

        const fileRecord = await UploadedFile.create({
          uploadedBy: req.user._id,
          uploaderName: req.user.username,
          originalName: file.originalname,
          storedName: file.filename,
          filePath: file.path,
          fileType,
          mimeType: file.mimetype,
          size: file.size,
          parseStatus: 'pending'
        });

        const parseResult = await parseFile(file.path, fileType);
        fileRecord.parsedContent = parseResult.content || '';
        fileRecord.parseStatus = parseResult.status;
        fileRecord.parseError = parseResult.error || null;
        await fileRecord.save();

        results.push(fileRecord);
      } catch (err) {
        results.push({ error: err.message, filename: file.originalname });
      }
    }

    res.status(201).json({
      message: `Uploaded ${results.length} files`,
      files: results
    });

  } catch (error) {
    console.error('❌ Multi-upload error:', error.message);
    res.status(500).json({ message: 'Upload failed' });
  }
});

// @route   GET /api/upload/files
// @desc    Get all uploaded files with optional filters
// @access  Operator only
router.get('/files', protect, operatorOnly, async (req, res) => {
  try {
    const { fileType, search } = req.query;

    // Build query filter
    const filter = {};

    if (fileType && fileType !== 'all') {
      filter.fileType = fileType;
    }

    if (search) {
      // Search in filename or parsed content
      filter.$or = [
        { originalName: { $regex: search, $options: 'i' } },
        { parsedContent: { $regex: search, $options: 'i' } }
      ];
    }

    const files = await UploadedFile.find(filter)
      .sort({ uploadedAt: -1 })
      .select('-parsedContent'); // Don't send full content in list

    res.json(files);
  } catch (error) {
    console.error('❌ Get files error:', error.message);
    res.status(500).json({ message: 'Failed to fetch files' });
  }
});

// @route   GET /api/upload/files/:id
// @desc    Get a single file's full data (including parsed content)
// @access  Operator only
router.get('/files/:id', protect, operatorOnly, async (req, res) => {
  try {
    const file = await UploadedFile.findById(req.params.id);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }
    res.json(file);
  } catch (error) {
    console.error('❌ Get file error:', error.message);
    res.status(500).json({ message: 'Failed to fetch file' });
  }
});

// @route   GET /api/upload/download/:id
// @desc    Download the original file
// @access  Operator only
router.get('/download/:id', protect, operatorOnly, async (req, res) => {
  try {
    const file = await UploadedFile.findById(req.params.id);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    if (!fs.existsSync(file.filePath)) {
      return res.status(404).json({ message: 'File missing from disk' });
    }

    res.download(file.filePath, file.originalName);
  } catch (error) {
    console.error('❌ Download error:', error.message);
    res.status(500).json({ message: 'Download failed' });
  }
});

// @route   PUT /api/upload/files/:id
// @desc    Update file metadata (tags, notes)
// @access  Operator only
router.put('/files/:id', protect, operatorOnly, async (req, res) => {
  try {
    const { tags, notes } = req.body;
    const file = await UploadedFile.findByIdAndUpdate(
      req.params.id,
      { tags, notes },
      { new: true }
    );

    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    res.json(file);
  } catch (error) {
    res.status(500).json({ message: 'Update failed' });
  }
});

// @route   DELETE /api/upload/files/:id
// @desc    Delete file (both DB record and disk file)
// @access  Operator only
router.delete('/files/:id', protect, operatorOnly, async (req, res) => {
  try {
    const file = await UploadedFile.findById(req.params.id);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Delete from disk
    if (fs.existsSync(file.filePath)) {
      fs.unlinkSync(file.filePath);
      console.log(`🗑️  Deleted from disk: ${file.storedName}`);
    }

    // Delete from database
    await UploadedFile.findByIdAndDelete(req.params.id);

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    console.error('❌ Delete error:', error.message);
    res.status(500).json({ message: 'Delete failed' });
  }
});

// @route   GET /api/upload/stats
// @desc    Get upload statistics
// @access  Operator only
router.get('/stats', protect, operatorOnly, async (req, res) => {
  try {
    const totalFiles = await UploadedFile.countDocuments();
    const totalSize = await UploadedFile.aggregate([
      { $group: { _id: null, total: { $sum: '$size' } } }
    ]);

    const byType = await UploadedFile.aggregate([
      { $group: { _id: '$fileType', count: { $sum: 1 } } }
    ]);

    res.json({
      totalFiles,
      totalSize: totalSize[0]?.total || 0,
      byType: byType.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {})
    });
  } catch (error) {
    res.status(500).json({ message: 'Stats failed' });
  }
});

module.exports = router;