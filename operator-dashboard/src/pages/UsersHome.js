import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { initSocket, disconnectSocket, getSocket } from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import UserCard from '../components/UserCard';

const UsersHome = ({ operator, onLogout }) => {
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'online', 'unread'
  const [connected, setConnected] = useState(false);

  const { isDarkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();

  // Load users from API
  const loadUsers = useCallback(async () => {
    try {
      const { data } = await api.get('/operator/users');
      setUsers(data);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get('/operator/stats');
      setStats(data);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }, []);

  // Setup socket for real-time updates
  useEffect(() => {
    if (!operator?.token) return;

    const socket = initSocket(operator.token);

    socket.on('connect', () => {
      setConnected(true);
      loadUsers();
      loadStats();
    });

    socket.on('disconnect', () => setConnected(false));

    // User comes online/offline
    socket.on('user_status_change', ({ userId, isOnline }) => {
      setUsers(prev =>
        prev.map(u => u._id === userId ? { ...u, isOnline } : u)
      );
      loadStats();
    });

    // New message arrived - refresh user list for unread counts
    socket.on('new_user_message', () => {
      loadUsers();
      loadStats();
    });

    socket.on('conversation_read', () => {
      loadUsers();
      loadStats();
    });

    loadUsers();
    loadStats();

    return () => {
      // Do NOT disconnect socket here - keep alive for chat screen
    };
  }, [operator, loadUsers, loadStats]);

  // Click a user card → navigate to chat screen
  const handleSelectUser = (user) => {
    navigate(`/chat/${user._id}`);
  };

  const handleLogout = () => {
    disconnectSocket();
    onLogout();
    navigate('/login');
  };

  // Filter users based on search and tab
  const filteredUsers = users.filter(u => {
    // Search filter
    const matchesSearch = u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (u.email && u.email.toLowerCase().includes(searchQuery.toLowerCase()));

    // Tab filter
    if (activeTab === 'online') return matchesSearch && u.isOnline;
    if (activeTab === 'unread') return matchesSearch && u.unreadCount > 0;
    return matchesSearch;
  });

  const onlineCount = users.filter(u => u.isOnline).length;
  const unreadCount = users.filter(u => u.unreadCount > 0).length;

  return (
    <div className="users-home">
      {/* ── TOP BAR ── */}
      <div className="uh-topbar">
        <div className="uh-brand">
          <div className="uh-logo">💬</div>
          <span className="uh-brand-name">Chat Manager</span>
        </div>

        <div className="uh-search-wrapper">
          <span className="uh-search-icon">🔍</span>
          <input
            type="text"
            className="uh-search"
            placeholder="Search users..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="uh-topbar-right">
          <div className="uh-icon-btn" title="Notifications">
            🔔
            {stats.unreadMessages > 0 && (
              <span className="uh-icon-badge">{stats.unreadMessages}</span>
            )}
          </div>

            <button
    className="uh-nav-btn"
    onClick={() => navigate('/files')}
    title="File Management"
  >
    📁 Files
  </button>

          <div className="uh-icon-btn" title="Messages">
            💬
            {unreadCount > 0 && (
              <span className="uh-icon-badge">{unreadCount}</span>
            )}
          </div>

          <button className="uh-theme-btn" onClick={toggleDarkMode}>
            {isDarkMode ? '☀️' : '🌙'}
          </button>

          <div className="uh-profile">
            <div className="uh-profile-avatar">
              {operator?.username?.charAt(0).toUpperCase()}
            </div>
            <span className="uh-profile-name">{operator?.username}</span>
            <button className="uh-logout" onClick={handleLogout}>Logout</button>
          </div>
        </div>
      </div>

      {/* ── TABS + STATS BAR ── */}
      <div className="uh-tabs-bar">
        <div className="uh-tabs">
          <button
            className={`uh-tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            📋 All Users
            <span className="uh-tab-count">{users.length}</span>
          </button>

          <button
            className={`uh-tab ${activeTab === 'online' ? 'active' : ''}`}
            onClick={() => setActiveTab('online')}
          >
            🟢 Online
            <span className="uh-tab-count">{onlineCount}</span>
          </button>

          <button
            className={`uh-tab ${activeTab === 'unread' ? 'active' : ''}`}
            onClick={() => setActiveTab('unread')}
          >
            🔴 Unread
            <span className="uh-tab-count">{unreadCount}</span>
          </button>
        </div>

        <div className="uh-connection-status">
          <span className={connected ? 'live' : 'offline'}>
            {connected ? '● Live' : '○ Connecting...'}
          </span>
        </div>
      </div>

      {/* ── USERS GRID ── */}
      <div className="uh-content">
        {filteredUsers.length === 0 ? (
          <div className="uh-empty">
            <div className="uh-empty-icon">👥</div>
            <h2>No users found</h2>
            <p>
              {searchQuery
                ? `No users match "${searchQuery}"`
                : activeTab === 'online'
                ? 'No users are currently online'
                : activeTab === 'unread'
                ? 'No unread messages'
                : 'Waiting for users to sign up...'}
            </p>
          </div>
        ) : (
          <div className="uh-cards-grid">
            {filteredUsers.map(user => (
              <UserCard
                key={user._id}
                user={user}
                onClick={handleSelectUser}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default UsersHome;