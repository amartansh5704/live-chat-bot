const express = require('express');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { protect } = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/messages/conversations/all
// @desc    Get all conversations for the logged-in user
// @access  Private
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
// @desc    Create a brand new conversation for the user
// @access  Private
// WHY: Each "Start New Chat" click creates a fresh conversation in DB
router.post('/conversations/new', protect, async (req, res) => {
  try {
    const { title } = req.body;

    // Count how many conversations user already has (for auto-naming)
    const count = await Conversation.countDocuments({ userId: req.user._id });

    // Create new conversation with auto-generated title
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
// @desc    Get all messages for a specific conversation
// @access  Private
router.get('/:conversationId', protect, async (req, res) => {
  try {
    // Verify this conversation belongs to the requesting user
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

module.exports = router;