import React from 'react';

const UserCard = ({ user, onClick }) => {
  // Format last seen time
  const formatLastSeen = (date) => {
    if (!date) return 'Never';
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return d.toLocaleDateString();
  };

  // Determine category tag based on user activity
  const getCategoryTag = () => {
    if (user.unreadCount > 5) return { label: 'Urgent', color: '#ef4444' };
    if (user.unreadCount > 0) return { label: 'Pending', color: '#f59e0b' };
    if (user.isOnline) return { label: 'Active', color: '#22c55e' };
    if (user.conversationCount > 3) return { label: 'Regular', color: '#8b5cf6' };
    return { label: 'General', color: '#6b7280' };
  };

  const category = getCategoryTag();
  const firstLetter = user.username.charAt(0).toUpperCase();

  // Border color changes based on unread
  const cardClass = `user-card ${user.unreadCount > 0 ? 'has-unread' : ''} ${user.isOnline ? 'is-online' : ''}`;

  return (
    <div className={cardClass} onClick={() => onClick(user)}>
      {/* Header: avatar + name + more menu */}
      <div className="uc-header">
        <div className="uc-avatar-wrapper">
          <div className="uc-avatar">
            {firstLetter}
          </div>
          <span className={`uc-status-dot ${user.isOnline ? 'online' : 'offline'}`}></span>
        </div>

        <div className="uc-user-info">
          <h3 className="uc-name">{user.username}</h3>
          <span className="uc-time">
            {user.isOnline ? '🟢 Online now' : formatLastSeen(user.lastSeen)}
          </span>
        </div>

        {user.unreadCount > 0 && (
          <div className="uc-badge">{user.unreadCount}</div>
        )}
      </div>

      {/* Category tag */}
      <div className="uc-category" style={{ color: category.color }}>
        {category.label}
      </div>

      {/* Description / stats */}
      <div className="uc-description">
        {user.conversationCount} conversation{user.conversationCount !== 1 ? 's' : ''}
        {user.unreadCount > 0 && (
          <>
            <br />
            <span style={{ color: '#f59e0b' }}>
              {user.unreadCount} unread message{user.unreadCount !== 1 ? 's' : ''}
            </span>
          </>
        )}
      </div>

      {/* Footer: action icons */}
      <div className="uc-footer">
        <button
          className="uc-action-btn chat"
          title="Open chat"
          onClick={(e) => {
            e.stopPropagation();
            onClick(user);
          }}
        >
          💬
        </button>
        <button
          className="uc-action-btn"
          title={user.isOnline ? 'Online' : 'Offline'}
          onClick={(e) => e.stopPropagation()}
        >
          {user.isOnline ? '🟢' : '⚪'}
        </button>
      </div>
    </div>
  );
};

export default UserCard;