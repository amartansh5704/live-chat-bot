import React, { useState } from 'react';
import { useTheme } from '../context/ThemeContext';

const Sidebar = ({
  conversations,
  activeConversation,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  user,
  onLogout
}) => {
  const { isDarkMode, toggleDarkMode } = useTheme();
  const [clickedId, setClickedId] = useState(null);
  const [creatingChat, setCreatingChat] = useState(false);
  const [hoveredId, setHoveredId] = useState(null);

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

  const handleDelete = (e, convId) => {
    e.stopPropagation();
    if (onDeleteConversation) {
      onDeleteConversation(convId);
    }
  };

  return (
    <div className={`sidebar ${isDarkMode ? 'dark' : ''}`}>
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

      <div className="sidebar-title">
        <h4>💬 Conversations</h4>
        <span className="conv-count">{conversations.length}</span>
      </div>

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
            onMouseEnter={() => setHoveredId(conv._id)}
            onMouseLeave={() => setHoveredId(null)}
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

            {/* Delete button - shows on hover */}
            {hoveredId === conv._id && (
              <button
                className="conv-delete-btn"
                onClick={(e) => handleDelete(e, conv._id)}
                title="Delete conversation"
              >
                🗑️
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="sidebar-footer">
        <button className="logout-btn" onClick={onLogout}>
          🚪 Logout
        </button>
      </div>
    </div>
  );
};

export default Sidebar;