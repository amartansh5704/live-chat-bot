import React, { useEffect, useRef } from 'react';

const ChatWindow = ({
  messages,
  activeUser,
  activeConversation,
  userTyping,
  onMarkRead
}) => {
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, userTyping]);

  const formatTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getStatusIcon = (msg) => {
    if (msg.sender !== 'operator') return null;
    const s = msg.status;
    if (s === 'read') return <span className="tick-op blue">✓✓</span>;
    if (s === 'delivered') return <span className="tick-op grey">✓✓</span>;
    return <span className="tick-op grey">✓</span>;
  };

  // Auto mark as read when operator views messages
  useEffect(() => {
    if (activeConversation && messages.length > 0) {
      const hasUnread = messages.some(
        m => m.sender === 'user' && m.status !== 'read'
      );
      if (hasUnread) {
        onMarkRead(activeConversation);
      }
    }
  }, [activeConversation, messages, onMarkRead]);

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
      {/* Header */}
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

      {/* Messages */}
      <div className="chat-window-messages">
        {messages.length === 0 && (
          <div className="no-messages-op">
            <p>No messages in this conversation</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={msg._id || i}
            className={`msg ${msg.sender === 'operator' ? 'msg-operator' : 'msg-user'}`}
          >
            <div className="msg-bubble">
              <div className="msg-sender">{msg.senderName}</div>
              <div className="msg-content">{msg.content}</div>
              <div className="msg-footer">
                <span className="msg-time">{formatTime(msg.timestamp)}</span>
                {getStatusIcon(msg)}
              </div>
            </div>
          </div>
        ))}

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