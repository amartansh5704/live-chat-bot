import React, { useEffect, useRef } from 'react';

// ── Tick Icons ──
const MessageTick = ({ status }) => {
  if (!status) return null;

  // Pending: pulsing clock
  if (status === 'pending') {
    return (
      <span className="tick tick-pending" title="Sending...">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
          <polyline points="12 6 12 12 16 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </span>
    );
  }

  // Sent: single grey tick
  if (status === 'sent') {
    return (
      <span className="tick tick-sent" title="Sent">
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  // Delivered: double grey tick
  if (status === 'delivered') {
    return (
      <span className="tick tick-delivered" title="Delivered">
        <svg width="20" height="11" viewBox="0 0 20 11" fill="none">
          <path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.5L9.5 10L18.5 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  // Read: double blue tick
  if (status === 'read') {
    return (
      <span className="tick tick-read" title="Read">
        <svg className="tick-read-svg" width="20" height="11" viewBox="0 0 20 11" fill="none">
          <path d="M1 5.5L5.5 10L14.5 1" stroke="#53bdeb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 5.5L9.5 10L18.5 1" stroke="#53bdeb" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

  return null;
};

const MessageList = ({ messages, isDarkMode }) => {
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
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
          // Use _id for saved messages, tempId for pending, index as last resort
          key={msg._id || msg.tempId || `msg-${index}`}
          className={`
            message
            ${msg.sender === 'user' ? 'message-user' : 'message-operator'}
            message-animate
            ${msg.status === 'pending' ? 'message-pending' : ''}
          `}
        >
          <div className={`message-bubble ${isDarkMode ? 'dark' : ''}`}>
            <div className="message-sender">{msg.senderName}</div>
            <div className="message-content">{msg.content}</div>
            <div className="message-footer">
              <span className="message-time">
                {formatTime(msg.timestamp)}
              </span>
              {/* Only show ticks on USER messages, not operator messages */}
              {msg.sender === 'user' && (
                <span className="message-status">
                  <MessageTick status={msg.status || 'sent'} />
                </span>
              )}
            </div>
          </div>
        </div>
      ))}

      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;