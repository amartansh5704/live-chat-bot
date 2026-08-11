const mongoose = require('mongoose');

const uploadedFileSchema = new mongoose.Schema({
  // Who uploaded the file
  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  uploaderName: {
    type: String,
    required: true
  },

  // Original filename from user's computer (e.g., "my-report.pdf")
  originalName: {
    type: String,
    required: true
  },

  // Stored filename on disk (unique, prefixed with timestamp)
  // e.g., "1699234567-my-report.pdf"
  storedName: {
    type: String,
    required: true,
    unique: true
  },

  // Full path on disk
  filePath: {
    type: String,
    required: true
  },

  // File type: pdf, docx, txt, csv, json, image, other
  fileType: {
    type: String,
    required: true
  },

  // MIME type: application/pdf, image/png, etc.
  mimeType: {
    type: String,
    required: true
  },

  // Size in bytes
  size: {
    type: Number,
    required: true
  },

  // Parsed text content (for searchable/viewable files)
  parsedContent: {
    type: String,
    default: ''
  },

  // Parsing status
  parseStatus: {
    type: String,
    enum: ['pending', 'success', 'failed', 'unsupported'],
    default: 'pending'
  },

  parseError: {
    type: String,
    default: null
  },

  // Custom tags for organizing
  tags: [{
    type: String
  }],

  // Notes about the file
  notes: {
    type: String,
    default: ''
  },

  uploadedAt: {
    type: Date,
    default: Date.now
  }
});

// Prevents OverwriteModelError on hot reload
module.exports = mongoose.models.UploadedFile || mongoose.model('UploadedFile', uploadedFileSchema);