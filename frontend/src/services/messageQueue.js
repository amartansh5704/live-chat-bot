// ═══════════════════════════════════════════════════════
//  MESSAGE QUEUE - localStorage based offline storage
// ═══════════════════════════════════════════════════════
// WHY: When server is down, messages need to be stored
//      somewhere on the USER'S device until server returns.
//      localStorage persists across refreshes and browser close.

const QUEUE_KEY = 'messageQueue';
const PENDING_MESSAGES_KEY = 'pendingMessages';

// ── Get all queued messages (waiting to be sent to server) ──
export const getQueue = () => {
  try {
    const queue = localStorage.getItem(QUEUE_KEY);
    return queue ? JSON.parse(queue) : [];
  } catch (error) {
    console.error('Error reading message queue:', error);
    return [];
  }
};

// ── Add a message to the queue ──
// WHY: Called when user sends a message but server is unreachable
export const addToQueue = (message) => {
  try {
    const queue = getQueue();
    queue.push({
      tempId: message.tempId,
      content: message.content,
      conversationId: message.conversationId,
      senderName: message.senderName,
      timestamp: message.timestamp,
      // Track retry attempts
      retryCount: 0,
      queuedAt: new Date().toISOString()
    });
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    return true;
  } catch (error) {
    console.error('Error adding to queue:', error);
    return false;
  }
};

// ── Remove a specific message from queue (after successful send) ──
export const removeFromQueue = (tempId) => {
  try {
    const queue = getQueue();
    const filtered = queue.filter(msg => msg.tempId !== tempId);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error removing from queue:', error);
  }
};

// ── Clear entire queue ──
export const clearQueue = () => {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify([]));
  } catch (error) {
    console.error('Error clearing queue:', error);
  }
};

// ── Get queue size ──
export const getQueueSize = () => {
  return getQueue().length;
};

// ═══════════════════════════════════════════════════════
//  PENDING MESSAGES - Messages shown in UI as pending
// ═══════════════════════════════════════════════════════
// WHY: React state is lost on page refresh. We save pending
//      messages to localStorage so they reappear after refresh
//      with the ⏳ icon still showing.

// ── Save pending messages for a conversation ──
export const savePendingMessages = (conversationId, messages) => {
  try {
    const allPending = getAllPendingMessages();
    allPending[conversationId] = messages.filter(
      msg => msg.status === 'pending'
    ).map(msg => ({
      tempId: msg.tempId,
      content: msg.content,
      conversationId: msg.conversationId,
      sender: msg.sender,
      senderName: msg.senderName,
      status: 'pending',
      timestamp: msg.timestamp
    }));

    // Clean up empty arrays
    Object.keys(allPending).forEach(key => {
      if (allPending[key].length === 0) delete allPending[key];
    });

    localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(allPending));
  } catch (error) {
    console.error('Error saving pending messages:', error);
  }
};

// ── Get pending messages for a specific conversation ──
export const getPendingMessages = (conversationId) => {
  try {
    const allPending = getAllPendingMessages();
    return allPending[conversationId] || [];
  } catch (error) {
    console.error('Error getting pending messages:', error);
    return [];
  }
};

// ── Get ALL pending messages across all conversations ──
export const getAllPendingMessages = () => {
  try {
    const data = localStorage.getItem(PENDING_MESSAGES_KEY);
    return data ? JSON.parse(data) : {};
  } catch (error) {
    console.error('Error getting all pending messages:', error);
    return {};
  }
};

// ── Remove a pending message after it's confirmed ──
export const removePendingMessage = (conversationId, tempId) => {
  try {
    const allPending = getAllPendingMessages();
    if (allPending[conversationId]) {
      allPending[conversationId] = allPending[conversationId].filter(
        msg => msg.tempId !== tempId
      );
      if (allPending[conversationId].length === 0) {
        delete allPending[conversationId];
      }
      localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(allPending));
    }
  } catch (error) {
    console.error('Error removing pending message:', error);
  }
};

// ── Clear all pending messages for a conversation ──
export const clearPendingMessages = (conversationId) => {
  try {
    const allPending = getAllPendingMessages();
    delete allPending[conversationId];
    localStorage.setItem(PENDING_MESSAGES_KEY, JSON.stringify(allPending));
  } catch (error) {
    console.error('Error clearing pending messages:', error);
  }
};