// operator-dashboard/src/components/ChatWindow.js
import React, { useEffect, useRef, useState } from 'react';
import { getSocket } from '../services/socket';

// ── Tick Icons ──
const getStatusIcon = (msg) => {
  if (msg.sender !== 'operator' || msg.isDeleted) return null;
  const s = msg.status;
  if (s === 'read') return <span className="tick-op blue">✓✓</span>;
  if (s === 'delivered') return <span className="tick-op grey">✓✓</span>;
  return <span className="tick-op grey">✓</span>;
};

// ── Sources citations inside bubble ──
const MessageSources = ({ sources }) => {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div style={{ marginTop: '8px', fontSize: '11px', borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: '4px' }}>
      <span
        onClick={() => setOpen(!open)}
        style={{ cursor: 'pointer', color: '#8b5cf6', fontWeight: 600, userSelect: 'none' }}
      >
        📚 {sources.length} document source{sources.length > 1 ? 's' : ''} cited {open ? '▲' : '▼'}
      </span>
      {open && (
        <ul style={{ margin: '4px 0 0 0', paddingLeft: '16px', color: '#666' }}>
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

const ChatWindow = ({
  messages,
  activeUser,
  activeConversation,
  userTyping,
  onMarkRead,
  onDeleteMessage,
  currentOperatorName
}) => {
  const bottomRef = useRef(null);
  const [hoveredMsgId, setHoveredMsgId] = useState(null);

  // ⭐ NEW: Local state to track real-time AI streams
  const [aiTyping, setAiTyping] = useState(false);
  const [aiStreamingMessage, setAiStreamingMessage] = useState(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, userTyping, aiTyping, aiStreamingMessage]);

  const formatTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // ── Auto mark as read ──
  useEffect(() => {
    if (activeConversation && messages.length > 0) {
      const hasUnread = messages.some(
        m => m.sender === 'user' && m.status !== 'read' && !m.isDeleted
      );
      if (hasUnread) {
        onMarkRead(activeConversation);
      }
    }
  }, [activeConversation, messages, onMarkRead]);

  // ══════════════════════════════════════════════════════
  //  ⭐ NEW: LISTEN FOR REAL-TIME AI EVENTS
  //  Allows operator to see the AI generate responses
  // ══════════════════════════════════════════════════════
  useEffect(() => {
    const socket = getSocket();
    if (!socket || !activeConversation) return;

    setAiTyping(false);
    setAiStreamingMessage(null);

    const handleAiTyping = (data) => {
      if (data.conversationId === activeConversation) {
        setAiTyping(data.isTyping);
      }
    };

    const handleAiChunk = (data) => {
      if (data.conversationId === activeConversation) {
        setAiTyping(false);
        setAiStreamingMessage({
          conversationId: data.conversationId,
          sender: 'operator',
          senderName: 'AI Assistant',
          content: data.fullText,
          isAI: true,
          isStreaming: true,
          timestamp: new Date().toISOString()
        });
      }
    };

    const handleAiComplete = (data) => {
      if (data.conversationId === activeConversation) {
        setAiTyping(false);
        setAiStreamingMessage(null);
        // Completed message is delivered via normal state channels
      }
    };

    const handleAiError = (data) => {
      if (data.conversationId === activeConversation) {
        setAiTyping(false);
        setAiStreamingMessage(null);
      }
    };

    socket.on('ai_response_typing', handleAiTyping);
    socket.on('ai_response_chunk', handleAiChunk);
    socket.on('ai_response_complete', handleAiComplete);
    socket.on('ai_response_error', handleAiError);

    return () => {
      socket.off('ai_response_typing', handleAiTyping);
      socket.off('ai_response_chunk', handleAiChunk);
      socket.off('ai_response_complete', handleAiComplete);
      socket.off('ai_response_error', handleAiError);
    };
  }, [activeConversation]);

  if (!activeConversation) {
    return (
      <div className="chat-window empty">
        <div className="empty-state">
          <span className="empty-icon">💬</span>
          <h2>Select a conversation</h2>
          <p>Choose a user and conversation from the left panel</p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-window">
      <div className="chat-window-header">
        <div className="chat-window-user">
          <div className="chat-window-avatar">
            {activeUser?.username?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="chat-window-info">
            <h3>{activeUser?.username || 'User'}</h3>
            {userTyping?.userId === activeUser?._id && userTyping?.isTyping ? (
              <span className="typing-status">
                typing
                <span className="typing-dots-small">
                  <span></span><span></span><span></span>
                </span>
              </span>
            ) : (
              <span className={activeUser?.isOnline ? 'online-text' : 'offline-text'}>
                {activeUser?.isOnline ? '🟢 Online' : '🔴 Offline'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="chat-window-messages">
        {messages.length === 0 && !aiTyping && !aiStreamingMessage && (
          <div className="no-messages-op">
            <p>No messages in this conversation</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isOwnOperatorMessage = msg.sender === 'operator';
          const canDelete = isOwnOperatorMessage && !msg.isDeleted && msg._id;

          return (
            <div
              key={msg._id || i}
              className={`
                msg
                ${msg.sender === 'operator' ? 'msg-operator' : 'msg-user'}
                ${msg.isDeleted ? 'msg-deleted' : ''}
              `}
              onMouseEnter={() => setHoveredMsgId(msg._id)}
              onMouseLeave={() => setHoveredMsgId(null)}
            >
              {canDelete && hoveredMsgId === msg._id && (
                <button
                  className="msg-delete-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteMessage(msg._id);
                  }}
                  title="Delete message"
                >
                  🗑️
                </button>
              )}

              <div className="msg-bubble" style={{ borderLeft: msg.isAI ? '3px solid #8b5cf6' : 'none' }}>
                <div className="msg-sender" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>{msg.senderName}</span>
                  {msg.isAI && (
                    <span style={{
                      fontSize: '8px',
                      padding: '1px 4px',
                      borderRadius: '3px',
                      background: '#8b5cf6',
                      color: '#fff',
                      fontWeight: 700
                    }}>
                      AI
                    </span>
                  )}
                </div>

                {msg.isDeleted ? (
                  <div className="msg-content-deleted">
                    <span>🚫</span>
                    <span>
                      This message was deleted by {msg.deletedBy === 'user' ? 'user' : 'operator'}
                    </span>
                  </div>
                ) : (
                  <div className="msg-content" style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                )}

                {msg.isAI && msg.aiSources && (
                  <MessageSources sources={msg.aiSources} />
                )}

                <div className="msg-footer">
                  <span className="msg-time">{formatTime(msg.timestamp)}</span>
                  {getStatusIcon(msg)}
                </div>
              </div>
            </div>
          );
        })}

        {/* ⭐ Real-time Streaming AI Message Monitor */}
        {aiStreamingMessage && (
          <div className="msg msg-operator">
            <div className="msg-bubble" style={{ borderLeft: '3px solid #8b5cf6', opacity: 0.85 }}>
              <div className="msg-sender" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span>AI Assistant</span>
                <span style={{
                  fontSize: '8px',
                  padding: '1px 4px',
                  borderRadius: '3px',
                  background: '#8b5cf6',
                  color: '#fff',
                  fontWeight: 700
                }}>
                  GENERATING...
                </span>
              </div>
              <div className="msg-content" style={{ whiteSpace: 'pre-wrap' }}>
                {aiStreamingMessage.content}
                <span className="typing-cursor" style={{ display: 'inline-block', width: '5px', height: '12px', background: '#8b5cf6', marginLeft: '2px', verticalAlign: 'middle' }}></span>
              </div>
            </div>
          </div>
        )}

        {/* AI Searching Indicator */}
        {aiTyping && !aiStreamingMessage && (
          <div className="msg msg-operator">
            <div className="msg-bubble" style={{ opacity: 0.7 }}>
              <div className="msg-sender">🤖 AI Assistant</div>
              <div className="typing-dots-op" style={{ display: 'inline-flex', gap: '3px', marginLeft: '5px' }}>
                <span style={{ background: '#8b5cf6' }}></span>
                <span style={{ background: '#8b5cf6' }}></span>
                <span style={{ background: '#8b5cf6' }}></span>
              </div>
              <span style={{ fontSize: '11px', color: '#8b5cf6', marginLeft: '8px', fontWeight: 600 }}>Searching documents...</span>
            </div>
          </div>
        )}

        {/* User typing bubble */}
        {userTyping?.userId === activeUser?._id &&
         userTyping?.conversationId === activeConversation &&
         userTyping?.isTyping && (
          <div className="msg msg-user">
            <div className="msg-bubble typing-bubble-op">
              <div className="msg-sender">{activeUser?.username}</div>
              <div className="typing-dots-op">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
};

export default ChatWindow;