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

// ── Deliver ALL queued messages across ALL conversations ──
// WHY: When operator types /online, find every message stuck at 'sent'
//      and deliver them. Notify each connected user so their ticks update.
const deliverQueuedMessages = async (io, connectedUsers) => {
  try {
    // Step 1: Find ALL undelivered user messages in the entire database
    const queuedMessages = await Message.find({
      status: 'sent',
      sender: 'user'
    });

    if (queuedMessages.length === 0) {
      console.log('   📭 No queued messages to deliver');
      return 0;
    }

    console.log(`   📬 Found ${queuedMessages.length} queued messages`);

    let deliveredCount = 0;

    for (const message of queuedMessages) {
      // Step 2: Find which conversation this message belongs to
      const conversation = await Conversation.findById(message.conversationId);
      if (!conversation) continue;

      // Step 3: Update status in MongoDB
      await Message.findByIdAndUpdate(message._id, {
        status: 'delivered',
        deliveredAt: new Date()
      });

      deliveredCount++;

      // Step 4: Find if this conversation's user is currently connected
      let userSocket = null;
      connectedUsers.forEach((data) => {
        if (data.user._id.toString() === conversation.userId.toString()) {
          userSocket = data.socket;
        }
      });

      // Step 5: If user is online, notify them so tick updates from ✓ to ✓✓
      if (userSocket) {
        userSocket.emit('message_status_update', {
          messageId: message._id,
          status: 'delivered',
          deliveredAt: new Date()
        });
      }
      // If user is offline, no problem - they'll see ✓✓ when they
      // reconnect because MongoDB already has status:'delivered'
    }

    return deliveredCount;
  } catch (error) {
    console.error('Error delivering queued messages:', error);
    return 0;
  }
};

module.exports = {
  markAsDelivered,
  markConversationAsRead,
  deliverQueuedMessages
};