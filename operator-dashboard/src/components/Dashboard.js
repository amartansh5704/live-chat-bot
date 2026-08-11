import React, { useState, useEffect, useCallback } from 'react';
import { initSocket, disconnectSocket, getSocket } from '../services/socket';
import api from '../services/api';
import TopBar from '../components/TopBar';
import UserList from '../components/UserList';
import ChatWindow from '../components/ChatWindow';
import OperatorInput from '../components/OperatorInput';

const Dashboard = ({ operator, onLogout }) => {
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState({});
  const [messages, setMessages] = useState([]);
  const [activeUserId, setActiveUserId] = useState(null);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [stats, setStats] = useState({});
  const [userTyping, setUserTyping] = useState(null);

  // Load all users
  const loadUsers = useCallback(async () => {
    try {
      const { data } = await api.get('/operator/users');
      setUsers(data);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  }, []);

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get('/operator/stats');
      setStats(data);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }, []);

  // Load conversations for a user
  const loadConversations = useCallback(async (userId) => {
    try {
      const { data } = await api.get(`/operator/conversations/${userId}`);
      setConversations(prev => ({ ...prev, [userId]: data }));
    } catch (err) {
      console.error('Error loading conversations:', err);
    }
  }, []);

  // Load messages for a conversation
  const loadMessages = useCallback(async (conversationId) => {
    try {
      const { data } = await api.get(`/operator/messages/${conversationId}`);
      setMessages(data);
    } catch (err) {
      console.error('Error loading messages:', err);
    }
  }, []);

  // Mark conversation as read
  const handleMarkRead = useCallback((conversationId) => {
    const socket = getSocket();
    if (socket) {
      socket.emit('operator_mark_read', { conversationId });
    }
  }, []);

  // Select user
  const handleSelectUser = (userId) => {
    setActiveUserId(userId);
    loadConversations(userId);
  };

  // Select conversation
  const handleSelectConversation = (userId, conversationId) => {
    setActiveUserId(userId);
    setActiveConversationId(conversationId);
    loadMessages(conversationId);

    const socket = getSocket();
    if (socket) {
      socket.emit('operator_viewing', { conversationId });
    }
  };

  // WebSocket setup
  useEffect(() => {
    if (!operator?.token) return;

    const socket = initSocket(operator.token);

    // New message from a user
    socket.on('new_user_message', (data) => {
      // If we're viewing this conversation, add message
      if (data.conversationId === activeConversationId) {
        setMessages(prev => [...prev, data.message]);
      }
      // Refresh user list for unread counts
      loadUsers();
      loadStats();
      // Refresh conversations for that user
      if (data.userId) {
        loadConversations(data.userId);
      }
    });

    // Our sent message confirmed
    socket.on('message_sent_confirm', (message) => {
      if (message.conversationId === activeConversationId) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      }
    });

    // Another operator sent a message (multi-operator support)
    socket.on('new_message_in_conversation', ({ conversationId, message }) => {
      if (conversationId === activeConversationId) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      }
    });

    // Conversation marked as read
    socket.on('conversation_read', () => {
      loadUsers();
      loadStats();
      if (activeUserId) loadConversations(activeUserId);
    });

    // User came online/offline
    socket.on('user_status_change', ({ userId, isOnline }) => {
      setUsers(prev =>
        prev.map(u => u._id === userId ? { ...u, isOnline } : u)
      );
      loadStats();
    });

    // User typing
    socket.on('user_typing', (data) => {
      setUserTyping(data);
      if (data.isTyping) {
        setTimeout(() => {
          setUserTyping(prev =>
            prev?.userId === data.userId ? { ...prev, isTyping: false } : prev
          );
        }, 3500);
      }
    });

    // Message status changed
    socket.on('message_status_changed', ({ messageId, status }) => {
      setMessages(prev =>
        prev.map(m => m._id === messageId ? { ...m, status } : m)
      );
    });

    // Initial load
    loadUsers();
    loadStats();

    return () => disconnectSocket();
  }, [operator, activeConversationId, activeUserId, loadUsers, loadStats, loadConversations]);

  // Reload messages when conversation changes
  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    }
  }, [activeConversationId, loadMessages]);

  // Find active user data
  const activeUser = users.find(u => u._id === activeUserId);

  return (
    <div className="dashboard">
      <TopBar
        stats={stats}
        operator={operator}
        onLogout={onLogout}
      />

      <div className="dashboard-body">
        <UserList
          users={users}
          conversations={conversations}
          activeUserId={activeUserId}
          activeConversationId={activeConversationId}
          onSelectUser={handleSelectUser}
          onSelectConversation={handleSelectConversation}
          userTyping={userTyping}
        />

        <div className="dashboard-chat">
          <ChatWindow
            messages={messages}
            activeUser={activeUser}
            activeConversation={activeConversationId}
            userTyping={userTyping}
            onMarkRead={handleMarkRead}
          />
          <OperatorInput activeConversationId={activeConversationId} />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;