const express = require('express');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { protect } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/messages/conversations/all
router.get('/conversations/all', protect, async (req, res) => {
  try {
    const conversations = await Conversation.find({ userId: req.user._id })
      .sort({ lastMessageAt: -1 });
    res.json(conversations);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ message: 'Error fetching conversations' });
  }
});

// @route   POST /api/messages/conversations/new
router.post('/conversations/new', protect, async (req, res) => {
  try {
    const { title } = req.body;
    const count = await Conversation.countDocuments({ userId: req.user._id });
    const conversation = await Conversation.create({
      userId: req.user._id,
      username: req.user.username,
      title: title || `Chat ${count + 1}`,
      lastMessage: '',
      lastMessageAt: new Date()
    });
    res.status(201).json(conversation);
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({ message: 'Error creating conversation' });
  }
});

// @route   GET /api/messages/:conversationId
router.get('/:conversationId', protect, async (req, res) => {
  try {
    const conversation = await Conversation.findOne({
      _id: req.params.conversationId,
      userId: req.user._id
    });
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    const messages = await Message.find({
      conversationId: req.params.conversationId
    }).sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Error fetching messages' });
  }
});

// ═══════════════════════════════════════════════════════
//  NEW: DELETE CONVERSATION (user only)
// ═══════════════════════════════════════════════════════
// @route   DELETE /api/messages/conversations/:conversationId
// @desc    Delete a conversation and all its messages
// @access  Private (user must own the conversation)
router.delete('/conversations/:conversationId', protect, async (req, res) => {
  try {
    // Verify ownership
    const conversation = await Conversation.findOne({
      _id: req.params.conversationId,
      userId: req.user._id
    });

    if (!conversation) {
      return res.status(404).json({
        message: 'Conversation not found or you do not own it'
      });
    }

    // Delete all messages in this conversation
    const deletedMessages = await Message.deleteMany({
      conversationId: req.params.conversationId
    });

    // Delete the conversation itself
    await Conversation.findByIdAndDelete(req.params.conversationId);

    console.log(`🗑️  Conversation deleted: ${conversation.title} (${deletedMessages.deletedCount} messages)`);

    res.json({
      message: 'Conversation deleted',
      deletedMessages: deletedMessages.deletedCount,
      conversationId: req.params.conversationId
    });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ message: 'Error deleting conversation' });
  }
});

module.exports = router;