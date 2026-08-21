// frontend/src/components/MessageList.js
import React, { useEffect, useRef, useState } from 'react';

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
const TypingBubble = ({ isDarkMode, label = 'Operator' }) => (
  <div className="message message-operator typing-bubble-wrapper">
    <div className={`message-bubble typing-bubble ${isDarkMode ? 'dark' : ''}`}>
      <div className="message-sender">{label}</div>
      <div className="typing-dots">
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
      </div>
    </div>
  </div>
);

// ── Deleted Message Placeholder ──
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

// ── Sources Accordion ──
const MessageSources = ({ sources }) => {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div style={{ marginTop: '8px', fontSize: '11px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '4px' }}>
      <span
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer', color: '#8b5cf6', fontWeight: 600, userSelect: 'none' }}
      >
        📚 {sources.length} source{sources.length > 1 ? 's' : ''} referenced {open ? '▲' : '▼'}
      </span>
      {open && (
        <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px', color: '#aaa' }}>
          {sources.map((s, idx) => (
            <li key={idx}>
              {s.fileName} {s.similarity ? `(${s.similarity}% match)` : ''}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ── Main MessageList ──
const MessageList = ({
  messages,
  streamingMessage,
  isDarkMode,
  operatorTyping,
  aiTyping,
  currentUsername,
  onDeleteMessage
}) => {
  const messagesEndRef = useRef(null);
  const [hoveredMsgId, setHoveredMsgId] = useState(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingMessage, operatorTyping, aiTyping]);

  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className={`message-list ${isDarkMode ? 'dark' : ''}`}>
      {messages.length === 0 && !operatorTyping && !aiTyping && !streamingMessage && (
        <div className="no-messages">
          <div className="no-messages-icon">💬</div>
          <p>No messages yet</p>
          <small>Ask a question based on uploaded documents!</small>
        </div>
      )}

      {messages.map((msg, index) => {
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
              <div className="message-sender" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>{msg.senderName}</span>
                {msg.isAI && (
                  <span style={{
                    fontSize: '9px',
                    padding: '2px 5px',
                    borderRadius: '4px',
                    background: '#8b5cf6',
                    color: '#fff',
                    fontWeight: 700
                  }}>
                    AI
                  </span>
                )}
              </div>

              {msg.isDeleted ? (
                <DeletedMessage msg={msg} isOwnMessage={isOwnMessage} />
              ) : (
                <div className="message-content" style={{ whiteSpace: 'pre-wrap' }}>
                  {msg.content}
                </div>
              )}

              {/* Source citations */}
              {msg.isAI && msg.aiSources && (
                <MessageSources sources={msg.aiSources} />
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

      {/* ⭐ Real-time Streaming AI Message */}
      {streamingMessage && (
        <div className="message message-operator message-animate">
          <div className={`message-bubble ${isDarkMode ? 'dark' : ''}`}>
            <div className="message-sender" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span>{streamingMessage.senderName}</span>
              <span style={{
                fontSize: '9px',
                padding: '2px 5px',
                borderRadius: '4px',
                background: '#8b5cf6',
                color: '#fff',
                fontWeight: 700
              }}>
                AI STREAMING...
              </span>
            </div>

            <div className="message-content" style={{ whiteSpace: 'pre-wrap' }}>
              {streamingMessage.content}
              <span className="typing-cursor" style={{ display: 'inline-block', width: '6px', height: '14px', background: '#8b5cf6', marginLeft: '3px', verticalAlign: 'middle', animation: 'blink 1s infinite' }}></span>
            </div>

            <div className="message-footer">
              <span className="message-time">Just now</span>
            </div>
          </div>
        </div>
      )}

      {/* AI Searching Bubble */}
      {aiTyping && !streamingMessage && <TypingBubble isDarkMode={isDarkMode} label="🤖 AI Searching Knowledge Base..." />}

      {/* Human Operator Typing Bubble */}
      {operatorTyping && <TypingBubble isDarkMode={isDarkMode} label="Operator" />}

      <div ref={messagesEndRef} />
    </div>
  );
};

export default MessageList;