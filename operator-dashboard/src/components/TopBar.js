import React from 'react';
import { useTheme } from '../context/ThemeContext';

const TopBar = ({ stats, operator, onLogout, connected }) => {
  const { isDarkMode, toggleDarkMode } = useTheme();

  return (
    <div className="topbar">
      <div className="topbar-left">
        <h1>🖥️ Operator Dashboard</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="operator-name">{operator?.username}</span>
          <span style={{
            fontSize: '11px',
            color: connected ? '#4ade80' : '#f87171',
            fontWeight: 600
          }}>
            {connected ? '● Live' : '○ Reconnecting...'}
          </span>
        </div>
      </div>

      <div className="topbar-stats">
        <div className="stat-item">
          <span className="stat-number" style={{ color: '#4ade80' }}>
            {stats.onlineUsers || 0}
          </span>
          <span className="stat-label">Online</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">{stats.totalUsers || 0}</span>
          <span className="stat-label">Total Users</span>
        </div>
        <div className="stat-item">
          <span className="stat-number" style={{ color: '#fb923c' }}>
            {stats.unreadMessages || 0}
          </span>
          <span className="stat-label">Unread</span>
        </div>
        <div className="stat-item">
          <span className="stat-number">{stats.totalMessages || 0}</span>
          <span className="stat-label">Messages</span>
        </div>
      </div>

      <div className="topbar-actions">
        <button className="theme-btn" onClick={toggleDarkMode}>
          {isDarkMode ? '☀️' : '🌙'}
        </button>
        <button className="logout-btn" onClick={onLogout}>
          🚪 Logout
        </button>
      </div>
    </div>
  );
};

export default TopBar;