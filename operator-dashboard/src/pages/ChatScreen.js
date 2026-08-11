import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { initSocket, getSocket } from '../services/socket';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import ChatWindow from '../components/ChatWindow';
import OperatorInput from '../components/OperatorInput';

const ChatScreen = ({ operator }) => {
  const [user, setUser] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [userTyping, setUserTyping] = useState(null);
  const [connected, setConnected] = useState(false);

  const activeConversationRef = useRef(null);
  const { isDarkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();
  const { userId } = useParams();

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  // Load user info + conversations
  const loadUserData = useCallback(async () => {
    try {
      // Get all users and find this one
      const { data: usersData } = await api.get('/operator/users');
      const foundUser = usersData.find(u => u._id === userId);
      if (foundUser) setUser(foundUser);

      // Get conversations for this user
      const { data: convsData } = await api.get(`/operator/conversations/${userId}`);
      setConversations(convsData);

      // Auto-select first conversation
      if (convsData.length > 0 && !activeConversationRef.current) {
        setActiveConversationId(convsData[0]._id);
      }
    } catch (err) {
      console.error('Error loading user data:', err);
    }
  }, [userId]);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try {
      const { data } = await api.get(`/operator/messages/${conversationId}`);
      setMessages(data);
    } catch (err) {
      console.error('Error loading messages:', err);
    }
  }, []);

  const handleMarkRead = useCallback((conversationId) => {
    const socket = getSocket();
    if (socket && conversationId) {
      socket.emit('operator_mark_read', { conversationId });
    }
  }, []);

  // Setup socket
  useEffect(() => {
    if (!operator?.token) return;

    let socket = getSocket();
    if (!socket || !socket.connected) {
      socket = initSocket(operator.token);
    }

    setConnected(socket.connected);

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('new_user_message', (data) => {
      // If message is for this user + current conversation, add it
      if (data.userId === userId && data.conversationId === activeConversationRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === data.message._id);
          return exists ? prev : [...prev, data.message];
        });
      }
      // Update conversations list
      if (data.userId === userId) {
        loadUserData();
      }
    });

    socket.on('message_sent_confirm', (message) => {
      if (message.conversationId === activeConversationRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      }
      loadUserData();
    });

    socket.on('new_message_in_conversation', ({ conversationId, message }) => {
      if (conversationId === activeConversationRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      }
    });

    socket.on('conversation_read', ({ conversationId }) => {
      if (conversationId === activeConversationRef.current) {
        setMessages(prev =>
          prev.map(m => m.sender === 'user' ? { ...m, status: 'read' } : m)
        );
      }
      loadUserData();
    });

    socket.on('user_status_change', ({ userId: uid, isOnline }) => {
      if (uid === userId) {
        setUser(prev => prev ? { ...prev, isOnline } : prev);
      }
    });

    socket.on('user_typing', (data) => {
      if (data.userId === userId) {
        setUserTyping(data);
        if (data.isTyping) {
          setTimeout(() => {
            setUserTyping(prev =>
              prev?.userId === data.userId ? { ...prev, isTyping: false } : prev
            );
          }, 3500);
        }
      }
    });

    socket.on('message_status_changed', ({ messageId, status }) => {
      setMessages(prev =>
        prev.map(m => m._id === messageId ? { ...m, status } : m)
      );
    });

    loadUserData();

    return () => {
      // Don't disconnect - keep socket alive when going back to users home
    };
  }, [operator, userId, loadUserData]);

  // Load messages when conversation changes
  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
      const socket = getSocket();
      if (socket) {
        socket.emit('operator_viewing', { conversationId: activeConversationId });
      }
      setTimeout(() => handleMarkRead(activeConversationId), 1000);
    }
  }, [activeConversationId, loadMessages, handleMarkRead]);

  const handleBack = () => {
    navigate('/');
  };

  const handleSelectConversation = (convId) => {
    setActiveConversationId(convId);
  };

  const formatDate = (date) => {
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-screen">
      {/* ── TOP BAR ── */}
      <div className="cs-topbar">
        <button className="cs-back-btn" onClick={handleBack}>
          ← Back to Users
        </button>

        <div className="cs-user-header">
          {user && (
            <>
              <div className="cs-user-avatar">
                {user.username.charAt(0).toUpperCase()}
                <span className={`cs-status-dot ${user.isOnline ? 'online' : 'offline'}`}></span>
              </div>
              <div className="cs-user-info">
                <h2>{user.username}</h2>
                <span className={user.isOnline ? 'online-text' : 'offline-text'}>
                  {user.isOnline ? '🟢 Online' : '⚪ Offline'}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="cs-topbar-right">
          <span className={connected ? 'cs-live' : 'cs-offline'}>
            {connected ? '● Live' : '○ Reconnecting'}
          </span>
          <button className="cs-theme-btn" onClick={toggleDarkMode}>
            {isDarkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </div>

      {/* ── MAIN LAYOUT ── */}
      <div className="cs-body">
        {/* Left: conversations list */}
        <div className="cs-convs-sidebar">
          <div className="cs-convs-header">
            <h3>Conversations</h3>
            <span className="cs-conv-count">{conversations.length}</span>
          </div>

          <div className="cs-convs-list">
            {conversations.map(conv => (
              <div
                key={conv._id}
                className={`cs-conv-item ${activeConversationId === conv._id ? 'active' : ''}`}
                onClick={() => handleSelectConversation(conv._id)}
              >
                <div className="cs-conv-icon">💬</div>
                <div className="cs-conv-info">
                  <div className="cs-conv-title">{conv.title}</div>
                  <div className="cs-conv-preview">
                    {conv.lastMessage || 'No messages yet'}
                  </div>
                  <div className="cs-conv-time">
                    {formatDate(conv.lastMessageAt)}
                  </div>
                </div>
                {conv.unreadCount > 0 && (
                  <span className="cs-conv-badge">{conv.unreadCount}</span>
                )}
              </div>
            ))}

            {conversations.length === 0 && (
              <div className="cs-no-convs">
                <p>No conversations yet</p>
              </div>
            )}
          </div>
        </div>

        {/* Right: chat area */}
        <div className="cs-chat-area">
          <ChatWindow
            messages={messages}
            activeUser={user}
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

export default ChatScreen;