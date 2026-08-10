const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const readline = require('readline');
const {
  markAsDelivered,
  markConversationAsRead,
} = require('./statusHandler');

const connectedUsers = new Map();
let operatorOnline = false;

const setupSocket = (io) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  operatorOnline = true;

  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║           OPERATOR CONSOLE READY                 ║');
  console.log('║  @username message  → Send reply                 ║');
  console.log('║  /users             → See connected users        ║');
  console.log('║  /read @username    → Mark messages as read      ║');
  console.log('║  /read all          → Mark ALL as read           ║');
  console.log('║  /history @username → See message history        ║');
  console.log('║  /status @username  → See message statuses       ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  rl.on('line', async (input) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return;

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

    if (trimmedInput.startsWith('/read @')) {
      const targetUsername = trimmedInput.replace('/read @', '').trim();
      let targetSocketData = null;
      connectedUsers.forEach((data) => {
        if (data.user.username === targetUsername) {
          targetSocketData = data;
        }
      });

      if (!targetSocketData) {
        const conv = await Conversation.findOne({ username: targetUsername });
        if (conv) {
          const count = await markConversationAsRead(conv._id, io, null);
          console.log(`   ✅ Marked ${count} messages as read for @${targetUsername} (offline)`);
        } else {
          console.log(`   ❌ User @${targetUsername} not found`);
        }
        return;
      }

      const count = await markConversationAsRead(
        targetSocketData.activeConversationId,
        io,
        targetSocketData.socket
      );
      console.log(`   ✅ Marked ${count} messages as read for @${targetUsername}`);
      return;
    }

    if (trimmedInput === '/read all') {
      let totalCount = 0;
      for (const [, data] of connectedUsers) {
        const count = await markConversationAsRead(
          data.activeConversationId,
          io,
          data.socket
        );
        totalCount += count || 0;
      }
      console.log(`   ✅ Marked ${totalCount} messages as read`);
      return;
    }

    if (trimmedInput.startsWith('/status @')) {
      const targetUsername = trimmedInput.replace('/status @', '').trim();
      const conv = await Conversation.findOne({ username: targetUsername });
      if (!conv) {
        console.log(`   ❌ No conversation for @${targetUsername}`);
        return;
      }
      const messages = await Message.find({ conversationId: conv._id })
        .sort({ timestamp: -1 })
        .limit(10);

      console.log(`\n📊 Message Status for @${targetUsername}:`);
      messages.reverse().forEach((msg) => {
        const statusIcon =
          msg.status === 'read' ? '🔵✓✓' :
          msg.status === 'delivered' ? '⚫✓✓' :
          msg.status === 'sent' ? '⚫✓' : '⏳';
        const sender = msg.sender === 'user' ? '👤' : '🤖';
        console.log(`   ${sender} ${statusIcon} [${msg.status}] ${msg.senderName}: ${msg.content}`);
      });
      console.log('');
      return;
    }

    if (trimmedInput.startsWith('/history @')) {
      const targetUsername = trimmedInput.replace('/history @', '').trim();
      const conv = await Conversation.findOne({ username: targetUsername });
      if (!conv) {
        console.log(`   ❌ No conversation for @${targetUsername}`);
        return;
      }
      const messages = await Message.find({ conversationId: conv._id })
        .sort({ timestamp: 1 })
        .limit(20);

      console.log(`\n📜 History for @${targetUsername}:`);
      messages.forEach((msg) => {
        const time = new Date(msg.timestamp).toLocaleTimeString();
        const prefix = msg.sender === 'user' ? '👤' : '🤖';
        console.log(`   ${prefix} [${time}] ${msg.senderName}: ${msg.content}`);
      });
      console.log('');
      return;
    }

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
        const message = await Message.create({
          conversationId: targetSocketData.activeConversationId,
          sender: 'operator',
          senderName: 'Operator',
          content: messageContent,
          status: 'delivered'
        });

        await Conversation.findByIdAndUpdate(
          targetSocketData.activeConversationId,
          { lastMessage: messageContent, lastMessageAt: new Date() }
        );

        targetSocketData.socket.emit('receive_message', {
          _id: message._id,
          conversationId: message.conversationId,
          sender: 'operator',
          senderName: 'Operator',
          content: messageContent,
          status: 'delivered',
          timestamp: message.timestamp
        });

        console.log(`   ✅ Sent to @${targetUsername}: ${messageContent}`);
      } catch (err) {
        console.log(`   ❌ Error: ${err.message}`);
      }
      return;
    }

    console.log('   ⚠️  Commands: @username msg | /users | /read @username | /read all | /status @username');
  });

  // Socket Auth
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('No token'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));
      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;
    console.log(`\n🟢 Connected: ${user.username}`);

    await User.findByIdAndUpdate(user._id, { isOnline: true });

    let conversation = await Conversation.findOne({ userId: user._id });
    if (!conversation) {
      conversation = await Conversation.create({
        userId: user._id,
        username: user.username,
        title: 'Chat 1'
      });
    }

    connectedUsers.set(socket.id, {
      socket,
      user: { _id: user._id, username: user.username },
      activeConversationId: conversation._id
    });

    socket.emit('conversation_info', {
      conversationId: conversation._id
    });

    // Deliver queued messages
    if (operatorOnline) {
      const queuedMessages = await Message.find({
        conversationId: conversation._id,
        status: 'sent',
        sender: 'user'
      });

      for (const msg of queuedMessages) {
        await markAsDelivered(msg._id, io, socket);
      }

      if (queuedMessages.length > 0) {
        console.log(`   📬 Delivered ${queuedMessages.length} queued messages for ${user.username}`);
      }
    }

    // ── THE KEY FIX: send_message handler ──
    socket.on('send_message', async (data) => {
      try {
        // IMPORTANT: receive tempId from frontend
        const { content, conversationId, tempId } = data;
        if (!content?.trim()) return;

        const targetConvId =
          conversationId ||
          connectedUsers.get(socket.id)?.activeConversationId;

        const userData = connectedUsers.get(socket.id);
        if (userData) {
          userData.activeConversationId = targetConvId;
          connectedUsers.set(socket.id, userData);
        }

        // Save to MongoDB
        const message = await Message.create({
          conversationId: targetConvId,
          sender: 'user',
          senderName: user.username,
          content: content.trim(),
          status: 'sent'
        });

        await Conversation.findByIdAndUpdate(targetConvId, {
          lastMessage: content.trim(),
          lastMessageAt: new Date()
        });

        // FIX: Send back tempId so frontend can find and replace the pending message
        socket.emit('message_confirmed', {
          _id: message._id,
          tempId: tempId,  // ← THIS WAS MISSING - frontend needs this to match
          conversationId: message.conversationId,
          sender: 'user',
          senderName: user.username,
          content: message.content,
          status: 'sent',
          timestamp: message.timestamp
        });

        // If operator online, mark delivered after a tiny delay
        // WHY: So user sees sent ✓ briefly before ✓✓
        if (operatorOnline) {
          setTimeout(async () => {
            await markAsDelivered(message._id, io, socket);
          }, 500);
        }

        const conv = await Conversation.findById(targetConvId);
        console.log(`\n💬 [${user.username}] in [${conv?.title || 'Chat'}]: ${content.trim()}`);
        console.log(`   Reply: @${user.username} your reply`);
        console.log(`   Mark read: /read @${user.username}`);
      } catch (error) {
        console.error('Message error:', error);
        socket.emit('error_message', { message: 'Failed to send message' });
      }
    });

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