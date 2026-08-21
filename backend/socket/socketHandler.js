// backend/socket/socketHandler.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { markAsDelivered, markConversationAsRead, deliverQueuedMessages } = require('./statusHandler');
const { processUserMessage, shouldTriggerAI } = require('../services/ragService');

// ── Global Socket State ──
const connectedUsers = new Map();
const connectedOperators = new Map();
const userSocketCount = new Map();
const activeAIStreams = new Map(); // conversationId -> boolean

// ── Global Helper Functions (Accessible to all handlers & AI trigger) ──
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
    if (opData.socket && opData.socket.connected) {
      opData.socket.emit(event, data);
    }
  });
};

const setupSocket = (io) => {
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

      try {
        const count = await deliverQueuedMessages(io, connectedUsers);
        if (count > 0) console.log(`   📬 Auto-delivered ${count} queued messages`);
      } catch (err) {
        console.error('Error delivering queued messages:', err.message);
      }

      // ── Operator sends message ──
      socket.on('operator_send_message', async (data) => {
        try {
          const { conversationId, content } = data;
          if (!content?.trim() || !conversationId) return;

          const conversation = await Conversation.findById(conversationId);
          if (!conversation) return;

          // Cancel AI stream if operator types
          if (activeAIStreams.has(conversationId)) {
            console.log(`   🛑 Operator ${user.username} took over from AI in conv ${conversationId}`);
            activeAIStreams.delete(conversationId);

            const targetUserSockets = findAllUserSockets(conversation.userId);
            targetUserSockets.forEach(us => {
              us.socket.emit('ai_typing', { conversationId, isTyping: false });
            });
          }

          const message = await Message.create({
            conversationId,
            sender: 'operator',
            senderName: user.username,
            content: content.trim(),
            status: 'delivered',
            isAI: false
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
            isAI: false,
            timestamp: message.timestamp
          };

          const targetUserSockets = findAllUserSockets(conversation.userId);
          targetUserSockets.forEach(userSocketData => {
            userSocketData.socket.emit('receive_message', msgData);
          });

          socket.emit('message_sent_confirm', msgData);
          broadcastToOperators('new_message_in_conversation', { conversationId, message: msgData });

        } catch (error) {
          console.error('❌ Operator send error:', error.message);
        }
      });

      // ── Operator typing ──
      socket.on('operator_typing', async (data) => {
        try {
          const { conversationId, isTyping } = data;
          if (!conversationId) return;

          const conversation = await Conversation.findById(conversationId);
          if (!conversation) return;

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

      // ── Operator mark read ──
      socket.on('operator_mark_read', async (data) => {
        try {
          const { conversationId } = data;
          if (!conversationId) return;

          const conversation = await Conversation.findById(conversationId);
          if (!conversation) return;

          const targetUserSockets = findAllUserSockets(conversation.userId);
          const primarySocket = targetUserSockets[0]?.socket || null;

          const count = await markConversationAsRead(conversationId, io, primarySocket);

          targetUserSockets.slice(1).forEach(userSocketData => {
            userSocketData.socket.emit('messages_read', {
              conversationId,
              messageIds: [],
              readAt: new Date()
            });
          });

          broadcastToOperators('conversation_read', { conversationId, readCount: count });

        } catch (err) {
          console.error('Mark read error:', err.message);
        }
      });

      // ── Operator deletes message ──
      socket.on('operator_delete_message', async ({ messageId }) => {
        try {
          const message = await Message.findById(messageId);
          if (!message) {
            socket.emit('error_message', { message: 'Message not found' });
            return;
          }

          if (message.sender !== 'operator') {
            socket.emit('error_message', { message: 'You can only delete operator messages' });
            return;
          }

          if (message.isDeleted) return;

          const originalContent = message.content;

          const updated = await Message.findByIdAndUpdate(
            messageId,
            {
              $set: {
                originalContent: originalContent,
                content: '',
                isDeleted: true,
                deletedBy: 'operator',
                deletedAt: new Date()
              }
            },
            { new: true, runValidators: false }
          );

          const deletedData = {
            messageId: updated._id,
            conversationId: updated.conversationId,
            deletedBy: 'operator',
            deletedAt: updated.deletedAt,
            deletedByName: user.username
          };

          broadcastToOperators('message_deleted', deletedData);

          const conversation = await Conversation.findById(updated.conversationId);
          if (conversation) {
            const targetUserSockets = findAllUserSockets(conversation.userId);
            targetUserSockets.forEach(sockData => {
              sockData.socket.emit('message_deleted', deletedData);
            });
          }

        } catch (error) {
          console.error('Operator delete message error:', error);
          socket.emit('error_message', { message: 'Failed to delete message' });
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

      const userIdStr = user._id.toString();
      const currentCount = userSocketCount.get(userIdStr) || 0;
      userSocketCount.set(userIdStr, currentCount + 1);

      const wasOffline = currentCount === 0;
      if (wasOffline) {
        await User.findByIdAndUpdate(user._id, {
          isOnline: true,
          lastSeen: new Date()
        });

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

      // Deliver queued messages
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
        } catch (err) {
          console.error('Queue delivery error:', err.message);
        }
      }

      // ══════════════════════════════════════════════════════
      //  USER SENDS MESSAGE (WITH AI RAG INTEGRATION)
      // ══════════════════════════════════════════════════════
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

          // Save user message to MongoDB
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

          // Confirm to sender tab
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

          // Sync across user's other tabs
          const allUserSockets = findAllUserSockets(user._id);
          allUserSockets.forEach(userSocketData => {
            if (userSocketData.socket.id !== socket.id) {
              userSocketData.socket.emit('receive_message', msgData);
            }
          });

          // Send to operators
          broadcastToOperators('new_user_message', {
            conversationId: targetConvId,
            userId: user._id,
            username: user.username,
            message: msgData
          });

          console.log(`   💬 ${user.username}: ${content.trim()}`);

          // Mark as delivered if operator is online
          if (isAnyOperatorOnline()) {
            setTimeout(async () => {
              try {
                await markAsDelivered(message._id, io, socket);
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

          // ══════════════════════════════════════════════════
          //  ⭐ AI RAG TRIGGER
          // ══════════════════════════════════════════════════
          if (shouldTriggerAI(content)) {
            triggerAIResponse(targetConvId, content, user._id, io, socket).catch(err => {
              console.error('AI trigger error:', err.message);
            });
          }

        } catch (error) {
          console.error('❌ send_message error:', error.message);
        }
      });

      // ── User typing ──
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

      // ── User deletes message ──
      socket.on('delete_message', async ({ messageId }) => {
        try {
          const message = await Message.findById(messageId);
          if (!message) {
            socket.emit('error_message', { message: 'Message not found' });
            return;
          }

          if (message.sender !== 'user' || message.senderName !== user.username) {
            socket.emit('error_message', { message: 'You can only delete your own messages' });
            return;
          }

          if (message.isDeleted) return;

          const originalContent = message.content;

          const updated = await Message.findByIdAndUpdate(
            messageId,
            {
              $set: {
                originalContent: originalContent,
                content: '',
                isDeleted: true,
                deletedBy: 'user',
                deletedAt: new Date()
              }
            },
            { new: true, runValidators: false }
          );

          const deletedData = {
            messageId: updated._id,
            conversationId: updated.conversationId,
            deletedBy: 'user',
            deletedAt: updated.deletedAt,
            deletedByName: user.username
          };

          const allUserSockets = findAllUserSockets(user._id);
          allUserSockets.forEach(sockData => {
            sockData.socket.emit('message_deleted', deletedData);
          });

          broadcastToOperators('message_deleted', deletedData);

        } catch (error) {
          console.error('Delete message error:', error);
          socket.emit('error_message', { message: 'Failed to delete message' });
        }
      });

      socket.on('conversation_deleted_notify', async ({ conversationId }) => {
        try {
          broadcastToOperators('conversation_deleted', {
            conversationId,
            username: user.username,
            userId: user._id
          });
        } catch (error) {
          console.error('Notify conversation delete error:', error);
        }
      });

      socket.on('switch_conversation', ({ conversationId }) => {
        const userData = connectedUsers.get(socket.id);
        if (userData) {
          userData.activeConversationId = conversationId;
          connectedUsers.set(socket.id, userData);
        }
      });

      socket.on('disconnect', async (reason) => {
        console.log(`\n👤 User socket disconnected: ${user.username} (${reason})`);

        const userIdStr = user._id.toString();
        const currentCount = userSocketCount.get(userIdStr) || 1;
        const newCount = currentCount - 1;

        connectedUsers.delete(socket.id);

        if (newCount <= 0) {
          userSocketCount.delete(userIdStr);

          try {
            await User.findByIdAndUpdate(user._id, {
              isOnline: false,
              lastSeen: new Date()
            });
          } catch (err) {
            console.error('Disconnect update error:', err.message);
          }

          broadcastToOperators('user_status_change', {
            userId: user._id,
            username: user.username,
            isOnline: false
          });
        } else {
          userSocketCount.set(userIdStr, newCount);
        }
      });
    }
  });
};

// ══════════════════════════════════════════════════════════
//  AI RAG TRIGGER FUNCTION
// ══════════════════════════════════════════════════════════
const triggerAIResponse = async (conversationId, userMessage, userId, io, userSocket) => {
  try {
    if (activeAIStreams.has(conversationId)) {
      console.log(`   🛑 Cancelling previous AI stream for conv ${conversationId}`);
      activeAIStreams.delete(conversationId);
    }

    activeAIStreams.set(conversationId, true);

    const enhancedSocket = {
      emit: (event, data) => {
        // Forward to user tab
        if (userSocket && userSocket.connected) {
          userSocket.emit(event, data);
        }

        // Forward to all connected operator tabs
        if (event === 'ai_typing') {
          broadcastToOperators('ai_response_typing', {
            conversationId,
            isTyping: data.isTyping
          });
        }

        if (event === 'ai_message_chunk') {
          broadcastToOperators('ai_response_chunk', {
            conversationId,
            content: data.content,
            fullText: data.fullText
          });
        }

        if (event === 'ai_message_complete') {
          broadcastToOperators('ai_response_complete', {
            conversationId,
            messageId: data.messageId,
            fullText: data.fullText,
            sources: data.sources,
            senderName: process.env.AI_SYSTEM_NAME || 'Support Assistant'
          });
        }

        if (event === 'ai_message_error') {
          broadcastToOperators('ai_response_error', {
            conversationId,
            error: data.error
          });
        }
      }
    };

    const result = await processUserMessage(
      userMessage,
      conversationId,
      io,
      enhancedSocket
    );

    activeAIStreams.delete(conversationId);

    if (result?.success && result.fullText) {
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: result.fullText.substring(0, 100),
        lastMessageAt: new Date()
      });
    }

  } catch (error) {
    console.error('❌ AI trigger error:', error.message);
    activeAIStreams.delete(conversationId);
  }
};

module.exports = setupSocket;