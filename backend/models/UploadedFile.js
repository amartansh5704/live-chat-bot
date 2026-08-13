const mongoose = require('mongoose');

const uploadedFileSchema = new mongoose.Schema({
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  uploaderName: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  storedName: {
    type: String,
    required: true
  },
  s3Bucket: {
    type: String,
    required: true
  },
  s3Key: {
    type: String,
    required: true
  },
  s3Url: {
    type: String,
    required: true
  },
  fileType: {
    type: String,
    required: true
  },
  mimeType: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  parsedContent: {
    type: String,
    default: ''
  },
  parseStatus: {
    type: String,
    enum: ['pending', 'success', 'failed', 'unsupported'],
    default: 'pending'
  },
  parseError: {
    type: String,
    default: null
  },
  embeddingStatus: {
    type: String,
    enum: ['pending', 'success', 'failed', 'skipped'],
    default: 'pending'
  },
  chunkCount: {
    type: Number,
    default: 0
  },

  // ⭐ NEW: Image-specific metadata
  imageMetadata: {
    width: Number,
    height: Number,
    format: String,
    aspectRatio: String,
    ocrText: String,
    ocrConfidence: Number,
    ocrWordCount: Number
  },

  tags: [{ type: String }],
  notes: {
    type: String,
    default: ''
  },
  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.models.UploadedFile || mongoose.model('UploadedFile', uploadedFileSchema);