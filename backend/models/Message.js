const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: String,
    enum: ['user', 'operator'],
    required: true
  },
  senderName: {
    type: String,
    required: true
  },
  content: {
    type: String,
    // FIX: Use custom validator that allows empty content ONLY when isDeleted is true
    // WHY: When a message is soft-deleted, we clear content but keep the record
    validate: {
      validator: function (value) {
        // If deleted, empty content is OK
        if (this.isDeleted) return true;
        // Otherwise, content must be non-empty
        return value && value.trim().length > 0;
      },
      message: 'Message content is required'
    },
    trim: true
  },
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  },
  deliveredAt: {
    type: Date,
    default: null
  },
  readAt: {
    type: Date,
    default: null
  },

  // ── SOFT DELETE FIELDS ──
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedBy: {
    type: String,
    enum: ['user', 'operator', null],
    default: null
  },
  deletedAt: {
    type: Date,
    default: null
  },
  originalContent: {
    type: String,
    default: null
  },

  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);