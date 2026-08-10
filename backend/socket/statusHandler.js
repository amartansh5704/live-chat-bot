const Message = require('../models/Message');
const Conversation = require('../models/Conversation');

const markAsDelivered = async (messageId, io, userSocket) => {
  try {
    const message = await Message.findByIdAndUpdate(
      messageId,
      {
        status: 'delivered',
        deliveredAt: new Date()
      },
      { new: true }
    );

    if (message && userSocket) {
      userSocket.emit('message_status_update', {
        messageId: message._id,
        status: 'delivered',
        deliveredAt: message.deliveredAt
      });
    }

    return message;
  } catch (error) {
    console.error('Error marking as delivered:', error);
  }
};

const markConversationAsRead = async (conversationId, io, userSocket) => {
  try {
    const now = new Date();

    await Message.updateMany(
      {
        conversationId,
        sender: 'user',
        status: { $ne: 'read' }
      },
      {
        status: 'read',
        readAt: now
      }
    );

    const updatedMessages = await Message.find({
      conversationId,
      sender: 'user',
      status: 'read',
      readAt: now
    }).select('_id');

    const messageIds = updatedMessages.map(m => m._id);

    if (userSocket && messageIds.length > 0) {
      userSocket.emit('messages_read', {
        conversationId,
        messageIds,
        readAt: now
      });
    }

    return messageIds.length;
  } catch (error) {
    console.error('Error marking as read:', error);
  }
};

const deliverQueuedMessages = async (io, connectedUsers) => {
  try {
    const queuedMessages = await Message.find({
      status: 'sent',
      sender: 'user'
    });

    console.log(`📬 Found ${queuedMessages.length} queued messages to deliver`);

    for (const message of queuedMessages) {
      let targetSocket = null;

      connectedUsers.forEach((data) => {
        if (data.user._id.toString() === message.conversationId?.userId?.toString()) {
          targetSocket = data.socket;
        }
      });

      await Message.findByIdAndUpdate(message._id, {
        status: 'delivered',
        deliveredAt: new Date()
      });

      if (targetSocket) {
        targetSocket.emit('message_status_update', {
          messageId: message._id,
          status: 'delivered',
          deliveredAt: new Date()
        });
      }
    }
  } catch (error) {
    console.error('Error delivering queued messages:', error);
  }
};

module.exports = {
  markAsDelivered,
  markConversationAsRead,
  deliverQueuedMessages
};