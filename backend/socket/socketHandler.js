const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const readline = require('readline');

const connectedUsers = new Map();

const setupSocket = (io) => {
  // ── Operator Console ──
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║         OPERATOR CONSOLE READY               ║');
  console.log('║  Type: @username your message                ║');
  console.log('║  Type: /users  → see connected users         ║');
  console.log('║  Type: /history @username                    ║');
  console.log('╚══════════════════════════════════════════════╝\n');

  rl.on('line', async (input) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

    // List connected users
    if (trimmedInput === '/users') {
      console.log('\n📋 Connected Users:');
      if (connectedUsers.size === 0) {
        console.log('   No users connected.');
      }
      connectedUsers.forEach((data) => {
        console.log(`   👤 ${data.user.username}`);
      });
      console.log('');
      return;
    }

    // View history
    if (trimmedInput.startsWith('/history @')) {
      const targetUsername = trimmedInput.replace('/history @', '').trim();
      try {
        const conversations = await Conversation.find({ username: targetUsername });
        if (!conversations.length) {
          console.log(`   ❌ No conversations for @${targetUsername}`);
          return;
        }
        for (const conv of conversations) {
          const messages = await Message.find({ conversationId: conv._id })
            .sort({ timestamp: 1 }).limit(10);
          console.log(`\n📜 [${conv.title}] History for @${targetUsername}:`);
          messages.forEach((msg) => {
            const time = new Date(msg.timestamp).toLocaleTimeString();
            const prefix = msg.sender === 'user' ? '👤' : '🤖';
            console.log(`   ${prefix} [${time}] ${msg.senderName}: ${msg.content}`);
          });
        }
        console.log('');
      } catch (err) {
        console.log(`   ❌ Error: ${err.message}`);
      }
      return;
    }

    // Reply to user: @username message
    if (trimmedInput.startsWith('@')) {
      const spaceIndex = trimmedInput.indexOf(' ');
      if (spaceIndex === -1) {
        console.log('   ⚠️  Usage: @username your message');
        return;
      }

      const targetUsername = trimmedInput.substring(1, spaceIndex);
      const messageContent = trimmedInput.substring(spaceIndex + 1);

      let targetSocketData = null;
      connectedUsers.forEach((data) => {
        if (data.user.username === targetUsername) {
          targetSocketData = data;
        }
      });

      if (!targetSocketData) {
        console.log(`   ❌ @${targetUsername} is not connected.`);
        return;
      }

      try {
        // Save to the user's currently active conversation
        const message = await Message.create({
          conversationId: targetSocketData.activeConversationId,
          sender: 'operator',
          senderName: 'Operator',
          content: messageContent
        });

        await Conversation.findByIdAndUpdate(targetSocketData.activeConversationId, {
          lastMessage: messageContent,
          lastMessageAt: new Date()
        });

        // Send to user's browser
        targetSocketData.socket.emit('receive_message', {
          _id: message._id,
          conversationId: message.conversationId,
          sender: 'operator',
          senderName: 'Operator',
          content: messageContent,
          timestamp: message.timestamp
        });

        console.log(`   ✅ Sent to @${targetUsername}: ${messageContent}`);
      } catch (err) {
        console.log(`   ❌ Error: ${err.message}`);
      }
      return;
    }

    console.log('   ⚠️  Commands: @username message | /users | /history @username');
  });

  // ── Socket Auth Middleware ──
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('No token provided'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection Handler ──
  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`\n🟢 Connected: ${user.username}`);

    await User.findByIdAndUpdate(user._id, { isOnline: true });

    // Get or create default conversation
    let conversation = await Conversation.findOne({ userId: user._id });
    if (!conversation) {
      conversation = await Conversation.create({
        userId: user._id,
        username: user.username,
        title: 'Chat 1'
      });
    }

    // Store user data - activeConversationId tracks which chat they're in
    connectedUsers.set(socket.id, {
      socket,
      user: { _id: user._id, username: user.username },
      activeConversationId: conversation._id
    });

    socket.emit('conversation_info', {
      conversationId: conversation._id
    });

    // ── Receive message from user ──
    socket.on('send_message', async (data) => {
      try {
        const { content, conversationId } = data;
        if (!content?.trim()) return;

        // Use the conversationId sent from frontend (active conversation)
        // WHY: User might have switched conversations, must save to correct one
        const targetConvId = conversationId || connectedUsers.get(socket.id)?.activeConversationId;

        // Update which conversation this user is actively in
        const userData = connectedUsers.get(socket.id);
        if (userData) {
          userData.activeConversationId = targetConvId;
          connectedUsers.set(socket.id, userData);
        }

        const message = await Message.create({
          conversationId: targetConvId,
          sender: 'user',
          senderName: user.username,
          content: content.trim()
        });

        await Conversation.findByIdAndUpdate(targetConvId, {
          lastMessage: content.trim(),
          lastMessageAt: new Date()
        });

        // Confirm back to the sender
        socket.emit('message_confirmed', {
          _id: message._id,
          conversationId: message.conversationId,
          sender: 'user',
          senderName: user.username,
          content: message.content,
          timestamp: message.timestamp
        });

        // Show in operator console
        const conv = await Conversation.findById(targetConvId);
        console.log(`\n💬 [${user.username}] in [${conv?.title || 'Chat'}]: ${content.trim()}`);
        console.log(`   Reply: @${user.username} your reply`);

      } catch (error) {
        console.error('Message error:', error);
        socket.emit('error_message', { message: 'Failed to send message' });
      }
    });

    // Track which conversation the user is currently viewing
    socket.on('switch_conversation', ({ conversationId }) => {
      const userData = connectedUsers.get(socket.id);
      if (userData) {
        userData.activeConversationId = conversationId;
        connectedUsers.set(socket.id, userData);
      }
    });

    socket.on('typing', () => {
      console.log(`   ⌨️  ${user.username} is typing...`);
    });

    socket.on('disconnect', async () => {
      console.log(`\n🔴 Disconnected: ${user.username}`);
      await User.findByIdAndUpdate(user._id, { isOnline: false });
      connectedUsers.delete(socket.id);
    });
  });
};

module.exports = setupSocket;