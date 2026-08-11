import React, { useState } from 'react';

const MessageInput = ({ onSendMessage, onTyping, isDarkMode, serverOnline }) => {
  const [message, setMessage] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleChange = (e) => {
    setMessage(e.target.value);
    if (onTyping) onTyping();
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form className={`message-input ${isDarkMode ? 'dark' : ''}`} onSubmit={handleSubmit}>
      <input
        type="text"
        value={message}
        onChange={handleChange}
        onKeyPress={handleKeyPress}
        placeholder={
          serverOnline
            ? 'Type a message...'
            : '✉️ Type a message (will send when online)...'
        }
        autoFocus
      />
      <button type="submit" disabled={!message.trim()}>
        {serverOnline ? 'Send ➤' : 'Queue ➤'}
      </button>
    </form>
  );
};

export default MessageInput;