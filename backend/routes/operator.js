const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── Operator only middleware ──
const operatorOnly = (req, res, next) => {
  console.log('🔐 operatorOnly check - user role:', req.user?.role);
  if (req.user.role !== 'operator') {
    return res.status(403).json({
      message: `Access denied. Your role is "${req.user.role}", needs "operator"`
    });
  }
  next();
};

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// @route   POST /api/operator/register
router.post('/register', async (req, res) => {
  try {
    console.log('📝 Operator register attempt:', req.body.email);
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: 'All fields required' });
    }

    const exists = await User.findOne({ $or: [{ email }, { username }] });
    if (exists) {
      return res.status(400).json({
        message: `User already exists with that ${exists.email === email ? 'email' : 'username'}`
      });
    }

    const user = await User.create({
      username,
      email,
      password,
      role: 'operator'
    });

    console.log('✅ Operator created:', user.username, 'role:', user.role);

    res.status(201).json({
      _id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      token: generateToken(user._id)
    });
  } catch (error) {
    console.error('❌ Operator register error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/operator/login
router.post('/login', async (req, res) => {
  try {
    console.log('🔑 Operator login attempt:', req.body.email);
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    // Find user with this email (any role first, then check)
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: 'No account found with this email' });
    }

    console.log('👤 Found user:', user.username, 'role:', user.role);

    if (user.role !== 'operator') {
      return res.status(401).json({
        message: `This account is a "${user.role}" not an operator. Register as operator first.`
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Wrong password' });
    }

    console.log('✅ Operator logged in:', user.username);

    res.json({
      _id: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      token: generateToken(user._id)
    });
  } catch (error) {
    console.error('❌ Operator login error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/operator/users
// WHY: Returns all non-operator users with their conversation stats
router.get('/users', protect, operatorOnly, async (req, res) => {
  try {
    console.log('📋 Getting all users for operator:', req.user.username);

    const users = await User.find({ role: 'user' })
      .select('-password')
      .sort({ isOnline: -1, lastSeen: -1 });

    console.log(`   Found ${users.length} users`);

    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const conversations = await Conversation.find({ userId: user._id });
        const unreadCount = await Message.countDocuments({
          conversationId: { $in: conversations.map(c => c._id) },
          sender: 'user',
          status: { $in: ['sent', 'delivered'] }
        });

        return {
          _id: user._id,
          username: user.username,
          email: user.email,
          isOnline: user.isOnline,
          lastSeen: user.lastSeen,
          conversationCount: conversations.length,
          unreadCount
        };
      })
    );

    res.json(usersWithStats);
  } catch (error) {
    console.error('❌ Get users error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/operator/conversations/:userId
router.get('/conversations/:userId', protect, operatorOnly, async (req, res) => {
  try {
    console.log('💬 Getting conversations for userId:', req.params.userId);

    const conversations = await Conversation.find({ userId: req.params.userId })
      .sort({ lastMessageAt: -1 });

    console.log(`   Found ${conversations.length} conversations`);

    const convsWithUnread = await Promise.all(
      conversations.map(async (conv) => {
        const unreadCount = await Message.countDocuments({
          conversationId: conv._id,
          sender: 'user',
          status: { $in: ['sent', 'delivered'] }
        });
        return { ...conv.toObject(), unreadCount };
      })
    );

    res.json(convsWithUnread);
  } catch (error) {
    console.error('❌ Get conversations error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/operator/messages/:conversationId
router.get('/messages/:conversationId', protect, operatorOnly, async (req, res) => {
  try {
    console.log('📨 Getting messages for conversation:', req.params.conversationId);

    const messages = await Message.find({
      conversationId: req.params.conversationId
    }).sort({ timestamp: 1 });

    console.log(`   Found ${messages.length} messages`);

    res.json(messages);
  } catch (error) {
    console.error('❌ Get messages error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// @route   GET /api/operator/stats
router.get('/stats', protect, operatorOnly, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const onlineUsers = await User.countDocuments({ role: 'user', isOnline: true });
    const totalMessages = await Message.countDocuments();
    const totalConversations = await Conversation.countDocuments();
    const unreadMessages = await Message.countDocuments({
      sender: 'user',
      status: { $in: ['sent', 'delivered'] }
    });

    res.json({ totalUsers, onlineUsers, totalMessages, totalConversations, unreadMessages });
  } catch (error) {
    console.error('❌ Stats error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;