import React, { useEffect, useRef } from 'react';

const MessageList = ({ messages, isDarkMode }) => {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className={`message-list ${isDarkMode ? 'dark' : ''}`}>
      {messages.length === 0 && (
        <div className="no-messages">
          <div className="no-messages-icon">💬</div>
          <p>No messages yet</p>
          <small>Start the conversation!</small>
        </div>
      )}
      {messages.map((msg, index) => (
        <div
          key={msg._id || index}
          className={`message ${msg.sender === 'user' ? 'message-user' : 'message-operator'} message-animate`}
        >
          <div className={`message-bubble ${isDarkMode ? 'dark' : ''}`}>
            <div className="message-sender">{msg.senderName}</div>
            <div className="message-content">{msg.content}</div>
            <div className="message-time">{formatTime(msg.timestamp)}</div>
          </div>
        </div>
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;