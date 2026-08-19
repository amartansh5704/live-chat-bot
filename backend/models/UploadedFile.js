// backend/models/UploadedFile.js
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
    default: ''        // empty until tus completes
  },
  s3Url: {
    type: String,
    default: ''        // empty until tus completes
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
    default: 0
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

  // ── NEW: Track upload phase separately ──
  // WHY: Tus upload can be 'uploading' while embeddingStatus is 'pending'
  //      Lets UI show correct state at each phase
  uploadStatus: {
    type: String,
    enum: ['uploading', 'complete', 'failed'],
    default: 'uploading'
  },

  tusUploadId: {
  type: String,
  default: null,
  index: true
},

clientUploadId: {
  type: String,
  default: null,
  index: true
},

  // Image-specific metadata
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

module.exports = mongoose.models.UploadedFile ||
  mongoose.model('UploadedFile', uploadedFileSchema);