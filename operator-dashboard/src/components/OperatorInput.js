import React, { useState, useRef, useCallback } from 'react';
import { getSocket } from '../services/socket';

const OperatorInput = ({ activeConversationId }) => {
  const [message, setMessage] = useState('');
  const typingTimerRef = useRef(null);
  const isTypingRef = useRef(false);

  // Emit typing events
  const emitTyping = useCallback((isTyping) => {
    const socket = getSocket();
    if (socket && activeConversationId) {
      socket.emit('operator_typing', {
        conversationId: activeConversationId,
        isTyping
      });
      isTypingRef.current = isTyping;
    }
  }, [activeConversationId]);

  const handleChange = (e) => {
    setMessage(e.target.value);

    // Start typing
    if (!isTypingRef.current && e.target.value.length > 0) {
      emitTyping(true);
    }

    // Reset stop timer
    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    typingTimerRef.current = setTimeout(() => {
      emitTyping(false);
    }, 2000);

    // Stop if empty
    if (e.target.value.length === 0) {
      emitTyping(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
    }
  };

  const handleSend = (e) => {
    e.preventDefault();
    if (!message.trim() || !activeConversationId) return;

    const socket = getSocket();
    if (socket) {
      // Stop typing indicator
      emitTyping(false);
      if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

      socket.emit('operator_send_message', {
        conversationId: activeConversationId,
        content: message.trim()
      });
      setMessage('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  if (!activeConversationId) return null;

  return (
    <form className="operator-input" onSubmit={handleSend}>
      <input
        type="text"
        value={message}
        onChange={handleChange}
        onKeyPress={handleKeyPress}
        placeholder="Type a reply..."
        autoFocus
      />
      <button type="submit" disabled={!message.trim()}>
        Send ➤
      </button>
    </form>
  );
};

export default OperatorInput;