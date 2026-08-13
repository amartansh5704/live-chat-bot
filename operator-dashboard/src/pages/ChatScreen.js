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
  // WHY: Keep conversations in ref so socket handlers see latest list
  const conversationsRef = useRef([]);

  const { isDarkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();
  const { userId } = useParams();

  useEffect(() => {
    activeConversationRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  // ── Load user info + conversations ──
  const loadUserData = useCallback(async () => {
    try {
      // Get all users and find this one
      const { data: usersData } = await api.get('/operator/users');
      const foundUser = usersData.find(u => u._id === userId);
      if (foundUser) setUser(foundUser);

      // Get conversations for this user
      const { data: convsData } = await api.get(`/operator/conversations/${userId}`);
      setConversations(convsData);

      // Auto-select first conversation only if none selected
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

  // ══════════════════════════════════════════════════════
  //  WEBSOCKET SETUP
  // ══════════════════════════════════════════════════════
  useEffect(() => {
    if (!operator?.token) return;

    let socket = getSocket();
    if (!socket || !socket.connected) {
      socket = initSocket(operator.token);
    }

    setConnected(socket.connected);

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // ── New user message ──
    socket.on('new_user_message', (data) => {
      if (data.userId === userId && data.conversationId === activeConversationRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === data.message._id);
          return exists ? prev : [...prev, data.message];
        });
      }
      // Refresh conversation list for unread counts
      if (data.userId === userId) {
        loadUserData();
      }
    });

    // ── Our sent message was confirmed ──
    socket.on('message_sent_confirm', (message) => {
      if (message.conversationId === activeConversationRef.current) {
        setMessages(prev => {
          const exists = prev.some(m => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      }
      loadUserData();
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

    // ── Messages marked as read ──
    socket.on('conversation_read', ({ conversationId }) => {
      if (conversationId === activeConversationRef.current) {
        setMessages(prev =>
          prev.map(m => m.sender === 'user' ? { ...m, status: 'read' } : m)
        );
      }
      loadUserData();
    });

    // ══════════════════════════════════════════════════════
    //  MESSAGE DELETED EVENT
    // ══════════════════════════════════════════════════════
    // WHY: Update the deleted message to show "deleted" placeholder
    //      Sync across all operators + user's own tabs
    socket.on('message_deleted', ({ messageId, deletedBy, deletedAt, deletedByName }) => {
      console.log(`🗑️ Message ${messageId} was deleted by ${deletedBy}`);
      setMessages(prev =>
        prev.map(msg =>
          msg._id === messageId
            ? {
                ...msg,
                content: '',
                isDeleted: true,
                deletedBy,
                deletedAt,
                deletedByName
              }
            : msg
        )
      );
    });

    // ══════════════════════════════════════════════════════
    //  CONVERSATION DELETED EVENT
    // ══════════════════════════════════════════════════════
    // WHY: When user deletes conversation, remove it from operator's view
    //      Auto-switch to another conversation if this one was active
    socket.on('conversation_deleted', ({ conversationId, username }) => {
      console.log(`🗑️ Conversation ${conversationId} deleted`);

      // Remove from list
      setConversations(prev => prev.filter(c => c._id !== conversationId));

      // If we were viewing this conversation, switch or clear
      if (activeConversationRef.current === conversationId) {
        const remaining = conversationsRef.current.filter(c => c._id !== conversationId);
        if (remaining.length > 0) {
          setActiveConversationId(remaining[0]._id);
        } else {
          setActiveConversationId(null);
          setMessages([]);
        }
      }
    });

    // ── User online/offline status ──
    socket.on('user_status_change', ({ userId: uid, isOnline }) => {
      if (uid === userId) {
        setUser(prev => prev ? { ...prev, isOnline } : prev);
      }
    });

    // ── User is typing ──
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

    // ── Message status changed ──
    socket.on('message_status_changed', ({ messageId, status }) => {
      setMessages(prev =>
        prev.map(m => m._id === messageId ? { ...m, status } : m)
      );
    });

    loadUserData();

    return () => {
      // Do NOT disconnect socket - keep it alive when navigating back
      // The socket is shared across the whole app
    };
  }, [operator, userId, loadUserData]);

  // ── Load messages when conversation changes ──
  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
      const socket = getSocket();
      if (socket) {
        socket.emit('operator_viewing', { conversationId: activeConversationId });
      }
      setTimeout(() => handleMarkRead(activeConversationId), 1000);
    } else {
      // No active conversation - clear messages
      setMessages([]);
    }
  }, [activeConversationId, loadMessages, handleMarkRead]);

  const handleBack = () => {
    navigate('/');
  };

  const handleSelectConversation = (convId) => {
    setActiveConversationId(convId);
  };

  const formatDate = (date) => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  // ══════════════════════════════════════════════════════
  //  DELETE OPERATOR MESSAGE
  // ══════════════════════════════════════════════════════
  // WHY: Sends WebSocket event to soft-delete the message
  //      Backend broadcasts to all operators and the target user
  const handleDeleteMessage = (messageId) => {
    const confirmed = window.confirm('Delete this message?');
    if (!confirmed) return;

    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('operator_delete_message', { messageId });
    } else {
      alert('Cannot delete: not connected to server');
    }
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
                <small>User may have deleted all chats</small>
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
            onDeleteMessage={handleDeleteMessage}
            currentOperatorName={operator?.username}
          />
          <OperatorInput activeConversationId={activeConversationId} />
        </div>
      </div>
    </div>
  );
};

export default ChatScreen;