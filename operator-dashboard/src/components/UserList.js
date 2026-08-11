import React, { useState } from 'react';

const UserList = ({
  users,
  conversations,
  activeUserId,
  activeConversationId,
  onSelectUser,
  onSelectConversation,
  userTyping
}) => {
  const [expandedUser, setExpandedUser] = useState(null);

  const handleUserClick = (userId) => {
    setExpandedUser(expandedUser === userId ? null : userId);
    onSelectUser(userId);
  };

  const formatTime = (date) => {
    if (!date) return '';
    const d = new Date(date);
    const now = new Date();
    const diff = Math.floor((now - d) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="user-list">
      <div className="user-list-header">
        <h3>👥 Users</h3>
      </div>

      <div className="user-list-content">
        {users.length === 0 && (
          <div className="no-users">No users yet</div>
        )}

        {users.map((u) => (
          <div key={u._id} className="user-section">
            {/* User row */}
            <div
              className={`user-item ${activeUserId === u._id ? 'active' : ''}`}
              onClick={() => handleUserClick(u._id)}
            >
              <div className="user-avatar-op">
                <span>{u.username.charAt(0).toUpperCase()}</span>
                <span className={`status-dot ${u.isOnline ? 'online' : 'offline'}`}></span>
              </div>
              <div className="user-info-op">
                <div className="user-name-row">
                  <span className="user-name-op">{u.username}</span>
                  {u.unreadCount > 0 && (
                    <span className="unread-badge">{u.unreadCount}</span>
                  )}
                </div>
                <span className="user-status-op">
                  {u.isOnline ? '🟢 Online' : `Last seen ${formatTime(u.lastSeen)}`}
                </span>
                {userTyping?.userId === u._id && userTyping?.isTyping && (
                  <span className="user-typing-label">
                    typing
                    <span className="typing-dots-small">
                      <span></span><span></span><span></span>
                    </span>
                  </span>
                )}
              </div>
              <span className="expand-arrow">
                {expandedUser === u._id ? '▼' : '▶'}
              </span>
            </div>

            {/* Expanded: show conversations */}
            {expandedUser === u._id && (
              <div className="user-conversations">
                {(conversations[u._id] || []).map((conv) => (
                  <div
                    key={conv._id}
                    className={`conv-item-op ${activeConversationId === conv._id ? 'active' : ''}`}
                    onClick={() => onSelectConversation(u._id, conv._id)}
                  >
                    <span className="conv-icon">💬</span>
                    <div className="conv-info-op">
                      <span className="conv-title-op">{conv.title || 'Chat'}</span>
                      <span className="conv-last-op">
                        {conv.lastMessage || 'No messages'}
                      </span>
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="unread-badge small">{conv.unreadCount}</span>
                    )}
                  </div>
                ))}
                {(!conversations[u._id] || conversations[u._id].length === 0) && (
                  <div className="no-convs">No conversations</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default UserList;