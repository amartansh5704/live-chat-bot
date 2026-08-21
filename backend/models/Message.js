// backend/models/Message.js
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
    validate: {
      validator: function (value) {
        if (this.isDeleted) return true;
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

  // ══════════════════════════════════════════
  //  NEW: AI FIELDS
  // ══════════════════════════════════════════
  // WHY: Distinguish AI replies from human operator replies
  //      Operator can see which messages AI generated
  //      Can review, edit, or delete AI responses
  isAI: {
    type: Boolean,
    default: false
  },

  // Which documents the AI used to generate this answer
  // WHY: Transparency - operator can verify AI sources
  aiSources: [{
    fileName: String,
    similarity: Number,    // percentage match
    chunkIndex: Number
  }],

  // Confidence score of the AI response
  // WHY: Low confidence = AI was guessing
  //      Operator should review low-confidence replies
  aiConfidence: {
    type: Number,
    default: null
  },

  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.models.Message || mongoose.model('Message', messageSchema);