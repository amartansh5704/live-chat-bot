import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { initSocket, disconnectSocket, getSocket } from '../services/socket';
import api from '../services/api';
import MessageList from '../components/MessageList';
import MessageInput from '../components/MessageInput';
import Sidebar from '../components/Sidebar';

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [connected, setConnected] = useState(false);
  // Ref to always have the latest activeConversation inside socket callbacks
  const activeConvRef = useRef(null);

  const { user, logout } = useAuth();
  const { isDarkMode } = useTheme();
  const navigate = useNavigate();

  // Keep ref in sync with state
  useEffect(() => {
    activeConvRef.current = activeConversation;
  }, [activeConversation]);

  // ── Load all conversations from REST API ──
  const loadConversations = useCallback(async () => {
    try {
      const { data } = await api.get('/messages/conversations/all');
      setConversations(data);
      // Auto-select first conversation on initial load
      if (data.length > 0 && !activeConvRef.current) {
        setActiveConversation(data[0]._id);
        activeConvRef.current = data[0]._id;
      }
      return data;
    } catch (error) {
      console.error('Error loading conversations:', error);
      return [];
    }
  }, []);

  // ── Load messages for a conversation from REST API ──
  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) return;
    try {
      const { data } = await api.get(`/messages/${conversationId}`);
      setMessages(data);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  }, []);

  // ── WebSocket setup ──
  useEffect(() => {
    if (!user?.token) {
      navigate('/login');
      return;
    }

    const socket = initSocket(user.token);

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    // Server tells us the default conversation ID
    socket.on('conversation_info', ({ conversationId }) => {
      // Only auto-set if we don't already have an active conversation
      if (!activeConvRef.current) {
        setActiveConversation(conversationId);
        activeConvRef.current = conversationId;
        loadMessages(conversationId);
      }
    });

    // Operator sends a reply
    socket.on('receive_message', (message) => {
      // Only show if it belongs to the currently open conversation
      if (message.conversationId === activeConvRef.current) {
        setMessages(prev => [...prev, message]);
      }
      loadConversations();
    });

    // Our message was saved - confirmation from server
    socket.on('message_confirmed', (message) => {
      if (message.conversationId === activeConvRef.current) {
        setMessages(prev => [...prev, message]);
      }
      loadConversations();
    });

    socket.on('error_message', ({ message }) => {
      console.error('Socket error:', message);
    });

    // Initial load
    loadConversations();

    return () => {
      disconnectSocket();
    };
  }, [user, navigate, loadConversations, loadMessages]);

  // ── Load messages when switching conversations ──
  useEffect(() => {
    if (activeConversation) {
      loadMessages(activeConversation);
    }
  }, [activeConversation, loadMessages]);

  // ── Handle "Start New Chat" button ──
  // WHY: Calls POST /api/messages/conversations/new → creates DB record → switches to it
  const handleNewChat = async () => {
    try {
      const { data } = await api.post('/messages/conversations/new');
      // Add new conversation to top of list
      setConversations(prev => [data, ...prev]);
      // Switch to the newly created conversation
      setActiveConversation(data._id);
      // Clear messages since it's a fresh conversation
      setMessages([]);
    } catch (error) {
      console.error('Error creating new chat:', error);
    }
  };

  // ── Send message via WebSocket ──
  const handleSendMessage = (content) => {
    const socket = getSocket();
    if (socket && connected && activeConvRef.current) {
      // Send with the active conversation ID so backend saves to correct conversation
      socket.emit('send_message', {
        content,
        conversationId: activeConvRef.current
      });
    }
  };

  // ── Typing indicator ──
  const handleTyping = () => {
    const socket = getSocket();
    if (socket && connected) {
      socket.emit('typing');
    }
  };

  // ── Select conversation from sidebar ──
  const handleSelectConversation = (conversationId) => {
    setActiveConversation(conversationId);
  };

  // ── Logout ──
  const handleLogout = () => {
    disconnectSocket();
    logout();
    navigate('/login');
  };

  // Find title of active conversation for header
  const activeConvTitle = conversations.find(
    c => c._id === activeConversation
  )?.title || 'Support Chat';

  return (
    <div className={`chat-container ${isDarkMode ? 'dark' : ''}`}>
      <Sidebar
        conversations={conversations}
        activeConversation={activeConversation}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        user={user}
        onLogout={handleLogout}
      />

      <div className={`chat-main ${isDarkMode ? 'dark' : ''}`}>
        <div className={`chat-header ${isDarkMode ? 'dark' : ''}`}>
          <div className="chat-header-info">
            <div className="chat-header-left">
              <h2>🤖 {activeConvTitle}</h2>
              <span className={`connection-status ${connected ? 'online' : 'offline'}`}>
                {connected ? '● Connected' : '○ Disconnected'}
              </span>
            </div>
          </div>
        </div>

        <MessageList messages={messages} isDarkMode={isDarkMode} />

        <MessageInput
          onSendMessage={handleSendMessage}
          onTyping={handleTyping}
          isDarkMode={isDarkMode}
        />
      </div>
    </div>
  );
};

export default Chat;