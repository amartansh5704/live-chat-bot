import React, { useEffect, useRef, useState } from 'react';

// ── Tick Icons (same as before) ──
const MessageTick = ({ status }) => {
  if (!status) return null;

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

  if (status === 'sent') {
    return (
      <span className="tick tick-sent" title="Sent">
        <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
          <path d="M1 5.5L5.5 10L14.5 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }

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

// ── Typing Bubble ──
const TypingBubble = ({ isDarkMode }) => (
  <div className="message message-operator typing-bubble-wrapper">
    <div className={`message-bubble typing-bubble ${isDarkMode ? 'dark' : ''}`}>
      <div className="message-sender">Operator</div>
      <div className="typing-dots">
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
      </div>
    </div>
  </div>
);

// ── Deleted Message Placeholder ──
// WHY: When a message is soft-deleted, show this instead of the content
const DeletedMessage = ({ msg, isOwnMessage }) => {
  const deletedByLabel = msg.deletedBy === 'user'
    ? (isOwnMessage ? 'you' : 'sender')
    : 'operator';

  return (
    <div className="message-content-deleted">
      <span className="deleted-icon">🚫</span>
      <span className="deleted-text">
        This message was deleted by {deletedByLabel}
      </span>
    </div>
  );
};

// ── Main MessageList ──
const MessageList = ({
  messages,
  isDarkMode,
  operatorTyping,
  currentUsername,
  onDeleteMessage
}) => {
  const messagesEndRef = useRef(null);
  const [hoveredMsgId, setHoveredMsgId] = useState(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, operatorTyping]);

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className={`message-list ${isDarkMode ? 'dark' : ''}`}>
      {messages.length === 0 && !operatorTyping && (
        <div className="no-messages">
          <div className="no-messages-icon">💬</div>
          <p>No messages yet</p>
          <small>Start the conversation!</small>
        </div>
      )}

      {messages.map((msg, index) => {
        // Only user's OWN non-deleted messages can be deleted
        const isOwnMessage = msg.sender === 'user' && msg.senderName === currentUsername;
        const canDelete = isOwnMessage && !msg.isDeleted && msg.status !== 'pending' && msg._id;

        return (
          <div
            key={msg._id || msg.tempId || `msg-${index}`}
            className={`
              message
              ${msg.sender === 'user' ? 'message-user' : 'message-operator'}
              message-animate
              ${msg.status === 'pending' ? 'message-pending' : ''}
              ${msg.isDeleted ? 'message-deleted' : ''}
            `}
            onMouseEnter={() => setHoveredMsgId(msg._id)}
            onMouseLeave={() => setHoveredMsgId(null)}
          >
            {/* Delete button (shows on hover for own messages) */}
            {canDelete && hoveredMsgId === msg._id && (
              <button
                className="message-delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteMessage(msg._id);
                }}
                title="Delete message"
              >
                🗑️
              </button>
            )}

            <div className={`message-bubble ${isDarkMode ? 'dark' : ''}`}>
              <div className="message-sender">{msg.senderName}</div>

              {/* Show deleted placeholder OR content */}
              {msg.isDeleted ? (
                <DeletedMessage msg={msg} isOwnMessage={isOwnMessage} />
              ) : (
                <div className="message-content">{msg.content}</div>
              )}

              <div className="message-footer">
                <span className="message-time">
                  {formatTime(msg.timestamp)}
                </span>
                {msg.sender === 'user' && !msg.isDeleted && (
                  <span className="message-status">
                    <MessageTick status={msg.status || 'sent'} />
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {operatorTyping && <TypingBubble isDarkMode={isDarkMode} />}

      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;