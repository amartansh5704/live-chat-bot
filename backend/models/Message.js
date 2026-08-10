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
    required: [true, 'Message content is required'],
    trim: true
  },
  // ── STATUS FIELD ──
  // WHY: Tracks exactly where the message is in its delivery lifecycle
  // pending  → frontend only, not yet saved (handled in frontend state only)
  // sent     → saved in MongoDB, operator not yet received
  // delivered→ operator's socket received it
  // read     → operator has read/acknowledged it
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
    // NOTE: 'pending' is only a frontend state - never saved to DB
    // WHY: If it's in DB it already reached the server = 'sent' minimum
  },
  // Track exactly when each status was achieved
  deliveredAt: {
    type: Date,
    default: null
  },
  readAt: {
    type: Date,
    default: null
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Message', messageSchema);