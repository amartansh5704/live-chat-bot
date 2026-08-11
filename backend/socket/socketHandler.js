const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { markAsDelivered, markConversationAsRead, deliverQueuedMessages } = require('./statusHandler');

const connectedUsers = new Map();     // socketId → data
const connectedOperators = new Map(); // socketId → data

// ⭐ NEW: Track how many sockets each user has open
// WHY: A user can have multiple tabs/windows open
//      We only mark them offline when ALL tabs close
const userSocketCount = new Map();    // userId → count

const setupSocket = (io) => {

  const isAnyOperatorOnline = () => connectedOperators.size > 0;

  const findUserSocket = (userId) => {
    let found = null;
    connectedUsers.forEach((data) => {
      if (data.user._id.toString() === userId.toString()) {
        found = data;
      }
    });
    return found;
  };

  // ⭐ NEW: Find ALL sockets for a user (not just one)
  const findAllUserSockets = (userId) => {
    const sockets = [];
    connectedUsers.forEach((data) => {
      if (data.user._id.toString() === userId.toString()) {
        sockets.push(data);
      }
    });
    return sockets;
  };

  const broadcastToOperators = (event, data) => {
    connectedOperators.forEach((opData) => {
      opData.socket.emit(event, data);
    });
  };

  // ── Socket Auth Middleware ──
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('No token provided'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));

      console.log(`🔌 Socket auth: ${user.username} (role: ${user.role})`);
      socket.user = user;
      next();
    } catch (err) {
      console.error('Socket auth error:', err.message);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.user;

    // ══════════════════════════════════════════════════════
    //  OPERATOR CONNECTION
    // ══════════════════════════════════════════════════════
    if (user.role === 'operator') {
      console.log(`\n🖥️  Operator connected: ${user.username} (${socket.id})`);

      connectedOperators.set(socket.id, {
        socket,
        user: { _id: user._id, username: user.username },
        viewingConversationId: null
      });

      socket.emit('operator_connected_ack', {
        message: 'Connected to dashboard',
        connectedUsers: connectedUsers.size
      });

      // Deliver queued messages
      try {
        const count = await deliverQueuedMessages(io, connectedUsers);
        if (count > 0) console.log(`   📬 Auto-delivered ${count} queued messages`);
      } catch (err) {
        console.error('Error delivering queued messages:', err.message);
      }

      // Operator sends message
      socket.on('operator_send_message', async (data) => {
        try {
          const { conversationId, content } = data;
          if (!content?.trim() || !conversationId) return;

          const conversation = await Conversation.findById(conversationId);
          if (!conversation) return;

          const message = await Message.create({
            conversationId,
            sender: 'operator',
            senderName: user.username,
            content: content.trim(),
            status: 'delivered'
          });

          await Conversation.findByIdAndUpdate(conversationId, {
            lastMessage: content.trim(),
            lastMessageAt: new Date()
          });

          const msgData = {
            _id: message._id,
            conversationId: message.conversationId,
            sender: 'operator',
            senderName: user.username,
            content: message.content,
            status: 'delivered',
            timestamp: message.timestamp
          };

          // ⭐ Send to ALL sockets of the target user (not just one)
          // WHY: User might have multiple tabs open
          const targetUserSockets = findAllUserSockets(conversation.userId);
          targetUserSockets.forEach(userSocketData => {
            userSocketData.socket.emit('receive_message', msgData);
          });

          if (targetUserSockets.length > 0) {
            console.log(`   ✅ Delivered to ${conversation.username} (${targetUserSockets.length} tab${targetUserSockets.length > 1 ? 's' : ''})`);
          } else {
            console.log(`   ⚠️  ${conversation.username} is offline`);
          }

          socket.emit('message_sent_confirm', msgData);
          broadcastToOperators('new_message_in_conversation', { conversationId, message: msgData });

        } catch (error) {
          console.error('❌ Operator send error:', error.message);
        }
      });

      socket.on('operator_typing', async (data) => {
        try {
          const { conversationId, isTyping } = data;
          if (!conversationId) return;

          const conversation = await Conversation.findById(conversationId);
          if (!conversation) return;

          // ⭐ Send typing to ALL of user's sockets
          const targetUserSockets = findAllUserSockets(conversation.userId);
          targetUserSockets.forEach(userSocketData => {
            userSocketData.socket.emit('operator_typing', {
              isTyping,
              conversationId,
              typingUser: user.username
            });
          });
        } catch (err) {
          console.error('Typing error:', err.message);
        }
      });

      socket.on('operator_mark_read', async (data) => {
        try {
          const { conversationId } = data;
          if (!conversationId) return;

          const conversation = await Conversation.findById(conversationId);
          if (!conversation) return;

          // ⭐ Notify ALL of user's sockets
          const targetUserSockets = findAllUserSockets(conversation.userId);
          const primarySocket = targetUserSockets[0]?.socket || null;

          const count = await markConversationAsRead(conversationId, io, primarySocket);

          // Broadcast to remaining sockets
          targetUserSockets.slice(1).forEach(userSocketData => {
            userSocketData.socket.emit('messages_read', {
              conversationId,
              messageIds: [], // client will refresh
              readAt: new Date()
            });
          });

          console.log(`   ✅ Marked ${count} messages as read in conv ${conversationId}`);
          broadcastToOperators('conversation_read', { conversationId, readCount: count });

        } catch (err) {
          console.error('Mark read error:', err.message);
        }
      });

      socket.on('operator_viewing', (data) => {
        const opData = connectedOperators.get(socket.id);
        if (opData) {
          opData.viewingConversationId = data.conversationId;
          connectedOperators.set(socket.id, opData);
        }
      });

      socket.on('disconnect', (reason) => {
        console.log(`\n🖥️  Operator disconnected: ${user.username} (${reason})`);
        connectedOperators.delete(socket.id);
      });

    } else {
      // ══════════════════════════════════════════════════════
      //  USER CONNECTION
      // ══════════════════════════════════════════════════════
      console.log(`\n👤 User connected: ${user.username} (${socket.id})`);

      // ⭐ INCREMENT socket count for this user
      const userIdStr = user._id.toString();
      const currentCount = userSocketCount.get(userIdStr) || 0;
      userSocketCount.set(userIdStr, currentCount + 1);

      console.log(`   📊 ${user.username} now has ${currentCount + 1} tab(s) open`);

      // ⭐ Only mark as online if this is their FIRST socket
      // (avoids unnecessary DB write on every tab open)
      const wasOffline = currentCount === 0;
      if (wasOffline) {
        await User.findByIdAndUpdate(user._id, {
          isOnline: true,
          lastSeen: new Date()
        });

        // Notify operators only if user JUST came online (was offline before)
        broadcastToOperators('user_status_change', {
          userId: user._id,
          username: user.username,
          isOnline: true
        });
      }

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

      socket.emit('conversation_info', { conversationId: conversation._id });

      // Deliver queued messages if operator online
      if (isAnyOperatorOnline()) {
        try {
          const userConvs = await Conversation.find({ userId: user._id });
          const convIds = userConvs.map(c => c._id);
          const queued = await Message.find({
            conversationId: { $in: convIds },
            status: 'sent',
            sender: 'user'
          });

          for (const msg of queued) {
            await Message.findByIdAndUpdate(msg._id, {
              status: 'delivered',
              deliveredAt: new Date()
            });
            socket.emit('message_status_update', {
              messageId: msg._id,
              status: 'delivered',
              deliveredAt: new Date()
            });
          }

          if (queued.length > 0) {
            console.log(`   📬 Delivered ${queued.length} queued messages to ${user.username}`);
          }
        } catch (err) {
          console.error('Queue delivery error:', err.message);
        }
      }

      socket.on('send_message', async (data) => {
        try {
          const { content, conversationId, tempId } = data;
          if (!content?.trim()) return;

          const targetConvId = conversationId ||
            connectedUsers.get(socket.id)?.activeConversationId;

          if (!targetConvId) return;

          const userData = connectedUsers.get(socket.id);
          if (userData) {
            userData.activeConversationId = targetConvId;
            connectedUsers.set(socket.id, userData);
          }

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

          // Confirm to the sending socket
          socket.emit('message_confirmed', {
            _id: message._id,
            tempId,
            conversationId: message.conversationId,
            sender: 'user',
            senderName: user.username,
            content: message.content,
            status: 'sent',
            timestamp: message.timestamp
          });

          const msgData = {
            _id: message._id,
            conversationId: message.conversationId,
            sender: 'user',
            senderName: user.username,
            content: message.content,
            status: 'sent',
            timestamp: message.timestamp
          };

          // ⭐ Send to OTHER sockets of the same user (sync across tabs)
          const allUserSockets = findAllUserSockets(user._id);
          allUserSockets.forEach(userSocketData => {
            if (userSocketData.socket.id !== socket.id) {
              userSocketData.socket.emit('receive_message', msgData);
            }
          });

          broadcastToOperators('new_user_message', {
            conversationId: targetConvId,
            userId: user._id,
            username: user.username,
            message: msgData
          });

          console.log(`   💬 ${user.username}: ${content.trim()}`);

          if (isAnyOperatorOnline()) {
            setTimeout(async () => {
              try {
                await markAsDelivered(message._id, io, socket);
                // Also update other tabs
                allUserSockets.forEach(userSocketData => {
                  if (userSocketData.socket.id !== socket.id) {
                    userSocketData.socket.emit('message_status_update', {
                      messageId: message._id,
                      status: 'delivered',
                      deliveredAt: new Date()
                    });
                  }
                });
                broadcastToOperators('message_status_changed', {
                  messageId: message._id,
                  conversationId: targetConvId,
                  status: 'delivered'
                });
              } catch (err) {
                console.error('Deliver error:', err.message);
              }
            }, 500);
          }

        } catch (error) {
          console.error('❌ send_message error:', error.message);
        }
      });

      socket.on('typing', () => {
        const userData = connectedUsers.get(socket.id);
        broadcastToOperators('user_typing', {
          userId: user._id,
          username: user.username,
          conversationId: userData?.activeConversationId,
          isTyping: true
        });
        setTimeout(() => {
          broadcastToOperators('user_typing', {
            userId: user._id,
            username: user.username,
            conversationId: userData?.activeConversationId,
            isTyping: false
          });
        }, 3000);
      });

      socket.on('switch_conversation', ({ conversationId }) => {
        const userData = connectedUsers.get(socket.id);
        if (userData) {
          userData.activeConversationId = conversationId;
          connectedUsers.set(socket.id, userData);
        }
      });

      // ⭐ FIXED: Only mark offline when ALL tabs close
      socket.on('disconnect', async (reason) => {
        console.log(`\n👤 User socket disconnected: ${user.username} (${reason})`);

        // Decrement socket count
        const userIdStr = user._id.toString();
        const currentCount = userSocketCount.get(userIdStr) || 1;
        const newCount = currentCount - 1;

        connectedUsers.delete(socket.id);

        if (newCount <= 0) {
          // No more sockets → user is truly offline
          userSocketCount.delete(userIdStr);
          console.log(`   ⚫ ${user.username} is now OFFLINE (all tabs closed)`);

          try {
            await User.findByIdAndUpdate(user._id, {
              isOnline: false,
              lastSeen: new Date()
            });
          } catch (err) {
            console.error('Disconnect update error:', err.message);
          }

          // Notify operators that user went offline
          broadcastToOperators('user_status_change', {
            userId: user._id,
            username: user.username,
            isOnline: false
          });
        } else {
          // Still has other tabs open → stay online
          userSocketCount.set(userIdStr, newCount);
          console.log(`   🟢 ${user.username} still has ${newCount} tab(s) open - remaining online`);
        }
      });
    }
  });
};

module.exports = setupSocket;