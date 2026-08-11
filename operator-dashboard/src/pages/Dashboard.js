import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initSocket, disconnectSocket, getSocket } from '../services/socket';
import api from '../services/api';
import TopBar from '../components/TopBar';
import UserList from '../components/UserList';
import ChatWindow from '../components/ChatWindow';
import OperatorInput from '../components/OperatorInput';

const Dashboard = ({ operator, onLogout }) => {
  const [users, setUsers] = useState([]);
  const [conversations, setConversations] = useState({});   // { userId: [conv, conv] }
  const [messages, setMessages] = useState([]);
  const [activeUserId, setActiveUserId] = useState(null);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [stats, setStats] = useState({});
  const [userTyping, setUserTyping] = useState(null);
  const [connected, setConnected] = useState(false);

  // Keep these in refs so socket event handlers always have latest values
  const activeConversationRef = useRef(null);
  const activeUserRef = useRef(null);

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeUserRef.current = activeUserId;
  }, [activeUserId]);

  // ── Load all users ──
  const loadUsers = useCallback(async () => {
    try {
      const { data } = await api.get('/operator/users');
      console.log('✅ Loaded users:', data.length);
      setUsers(data);
    } catch (err) {
      console.error('❌ Load users error:', err.response?.data || err.message);
    }
  }, []);

  // ── Load stats ──
  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get('/operator/stats');
      setStats(data);
    } catch (err) {
      console.error('❌ Load stats error:', err.message);
    }
  }, []);

  // ── Load conversations for a user ──
  const loadConversations = useCallback(async (userId) => {
    try {
      const { data } = await api.get(`/operator/conversations/${userId}`);
      console.log(`✅ Loaded ${data.length} conversations for user ${userId}`);
      setConversations(prev => ({ ...prev, [userId]: data }));
      return data;
    } catch (err) {
      console.error('❌ Load conversations error:', err.response?.data || err.message);
      return [];
    }
  }, []);

  // ── Load messages for a conversation ──
  const loadMessages = useCallback(async (conversationId) => {
    try {
      console.log('📨 Loading messages for conv:', conversationId);
      const { data } = await api.get(`/operator/messages/${conversationId}`);
      console.log(`✅ Loaded ${data.length} messages`);
      setMessages(data);
    } catch (err) {
      console.error('❌ Load messages error:', err.response?.data || err.message);
    }
  }, []);

  // ── Mark read ──
  const handleMarkRead = useCallback((conversationId) => {
    const socket = getSocket();
    if (socket && conversationId) {
      socket.emit('operator_mark_read', { conversationId });
    }
  }, []);

  // ── Select a user ──
  const handleSelectUser = async (userId) => {
    console.log('👤 Selected user:', userId);
    setActiveUserId(userId);
    const convs = await loadConversations(userId);

    // Auto select first conversation
    if (convs && convs.length > 0) {
      handleSelectConversation(userId, convs[0]._id);
    }
  };

  // ── Select a specific conversation ──
  const handleSelectConversation = (userId, conversationId) => {
    console.log('💬 Selected conversation:', conversationId, 'for user:', userId);
    setActiveUserId(userId);
    setActiveConversationId(conversationId);
    loadMessages(conversationId);

    const socket = getSocket();
    if (socket) {
      socket.emit('operator_viewing', { conversationId });
    }

    // Auto mark as read after short delay
    setTimeout(() => {
      handleMarkRead(conversationId);
    }, 1000);
  };

  // ══════════════════════════════════════════════════════
  //  WEBSOCKET SETUP
  // ══════════════════════════════════════════════════════
  useEffect(() => {
    if (!operator?.token) return;

    console.log('🔌 Initializing operator socket...');
    const socket = initSocket(operator.token);

    socket.on('connect', () => {
      console.log('✅ Operator dashboard connected to server');
      setConnected(true);
      // Reload data on reconnect
      loadUsers();
      loadStats();
    });

    socket.on('disconnect', (reason) => {
      console.log('❌ Operator dashboard disconnected:', reason);
      setConnected(false);
    });

    socket.on('connect_error', (err) => {
      console.error('❌ Socket connection error:', err.message);
      setConnected(false);
    });

    socket.on('operator_connected_ack', (data) => {
      console.log('✅ Operator ACK:', data);
    });

    // ── New message from a user ──
    socket.on('new_user_message', (data) => {
      console.log('📨 New user message received:', data);
      const { conversationId, userId, message } = data;

      // If operator is viewing this conversation, add message to view
      if (conversationId === activeConversationRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      }

      // Always refresh users list for unread counts
      loadUsers();
      loadStats();

      // Refresh conversations for this user
      if (userId) {
        loadConversations(userId);
      }
    });

    // ── Our message was confirmed ──
    socket.on('message_sent_confirm', (message) => {
      console.log('✅ Message sent confirmed:', message._id);
      if (message.conversationId === activeConversationRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      }
      // Refresh users so last message preview updates
      loadUsers();
      if (activeUserRef.current) {
        loadConversations(activeUserRef.current);
      }
    });

    // ── Another operator sent a message ──
    socket.on('new_message_in_conversation', ({ conversationId, message }) => {
      if (conversationId === activeConversationRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      }
    });

    // ── A conversation was marked read ──
    socket.on('conversation_read', ({ conversationId }) => {
      console.log('✅ Conversation read:', conversationId);
      // Update message statuses in view
      if (conversationId === activeConversationRef.current) {
        setMessages(prev =>
          prev.map(m =>
            m.sender === 'user' ? { ...m, status: 'read' } : m
          )
        );
      }
      loadUsers();
      loadStats();
      if (activeUserRef.current) loadConversations(activeUserRef.current);
    });

    // ── User online/offline status change ──
    socket.on('user_status_change', ({ userId, isOnline }) => {
      console.log(`👤 User ${userId} is now ${isOnline ? 'online' : 'offline'}`);
      setUsers(prev =>
        prev.map(u =>
          u._id === userId ? { ...u, isOnline } : u
        )
      );
      loadStats();
    });

    // ── User is typing ──
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

    // ── Message status updated ──
    socket.on('message_status_changed', ({ messageId, status }) => {
      setMessages(prev =>
        prev.map(m => m._id === messageId ? { ...m, status } : m)
      );
    });

    // Initial data load
    loadUsers();
    loadStats();

    return () => {
      console.log('🔌 Disconnecting operator socket');
      disconnectSocket();
    };
  }, [operator, loadUsers, loadStats, loadConversations]);

  // Reload messages when conversation changes
  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId, loadMessages]);

  const activeUser = users.find(u => u._id === activeUserId) || null;

  return (
    <div className="dashboard">
      <TopBar
        stats={stats}
        operator={operator}
        onLogout={onLogout}
        connected={connected}
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