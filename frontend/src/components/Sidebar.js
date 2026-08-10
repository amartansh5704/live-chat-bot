import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

const Sidebar = ({
  conversations,
  activeConversation,
  onSelectConversation,
  onNewChat,
  user,
  onLogout
}) => {
  const { isDarkMode, toggleDarkMode } = useTheme();
  // Track which conversation is being clicked for animation
  const [clickedId, setClickedId] = useState(null);
  // Loading state while new chat is being created
  const [creatingChat, setCreatingChat] = useState(false);

  const formatDate = (date) => {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString();
  };

  const handleNewChat = async () => {
    setCreatingChat(true);
    await onNewChat();
    setCreatingChat(false);
  };

  const handleConversationClick = (id) => {
    setClickedId(id);
    setTimeout(() => setClickedId(null), 300);
    onSelectConversation(id);
  };

  return (
    <div className={`sidebar ${isDarkMode ? 'dark' : ''}`}>

      {/* ── Header ── */}
      <div className="sidebar-header">
        <div className="user-info">
          <div className="user-avatar">
            {user?.username?.charAt(0).toUpperCase()}
          </div>
          <div className="user-details">
            <h3>{user?.username}</h3>
            <span className="online-status">● Online</span>
          </div>
        </div>

        {/* Dark mode toggle button */}
        <button
          className="theme-toggle-btn"
          onClick={toggleDarkMode}
          title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
        >
          <span className={`theme-icon ${isDarkMode ? 'rotate-in' : 'rotate-out'}`}>
            {isDarkMode ? '☀️' : '🌙'}
          </span>
        </button>
      </div>

      {/* ── Start New Chat Button ── */}
      <div className="new-chat-wrapper">
        <button
          className={`new-chat-btn ${creatingChat ? 'loading' : ''}`}
          onClick={handleNewChat}
          disabled={creatingChat}
        >
          {creatingChat ? (
            <>
              <span className="btn-spinner"></span>
              Creating...
            </>
          ) : (
            <>
              <span className="plus-icon">＋</span>
              Start New Chat
            </>
          )}
        </button>
      </div>

      {/* ── Sidebar Title ── */}
      <div className="sidebar-title">
        <h4>💬 Conversations</h4>
        <span className="conv-count">{conversations.length}</span>
      </div>

      {/* ── Conversation List ── */}
      <div className="conversation-list">
        {conversations.length === 0 && (
          <div className="no-conversations">
            <span>🗨️</span>
            <p>No conversations yet</p>
            <small>Click "Start New Chat" above</small>
          </div>
        )}

        {conversations.map((conv) => (
          <div
            key={conv._id}
            className={`
              conversation-item
              ${activeConversation === conv._id ? 'active' : ''}
              ${clickedId === conv._id ? 'clicked' : ''}
            `}
            onClick={() => handleConversationClick(conv._id)}
          >
            <div className="conv-avatar">
              {conv.title?.charAt(0) || '💬'}
            </div>
            <div className="conv-details">
              <div className="conv-name">
                {conv.title || 'Support Chat'}
              </div>
              <div className="conv-last-message">
                {conv.lastMessage || 'No messages yet'}
              </div>
            </div>
            <div className="conv-meta">
              <div className="conv-time">
                {formatDate(conv.lastMessageAt)}
              </div>
              {activeConversation === conv._id && (
                <div className="active-dot"></div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Footer Logout ── */}
      <div className="sidebar-footer">
        <button className="logout-btn" onClick={onLogout}>
          🚪 Logout
        </button>
      </div>
    </div>
  );
};

export default Sidebar;