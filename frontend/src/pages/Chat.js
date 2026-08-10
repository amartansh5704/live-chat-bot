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
  const activeConvRef = useRef(null);

  const { user, logout } = useAuth();
  const { isDarkMode } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    activeConvRef.current = activeConversation;
  }, [activeConversation]);

  // ── Load conversations ──
  const loadConversations = useCallback(async () => {
    try {
      const { data } = await api.get('/messages/conversations/all');
      setConversations(data);
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

  // ── Load messages ──
  // This replaces ALL messages with what's in the database
  // We must NOT call this after every send - only on conversation switch
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

    socket.on('conversation_info', ({ conversationId }) => {
      if (!activeConvRef.current) {
        setActiveConversation(conversationId);
        activeConvRef.current = conversationId;
        loadMessages(conversationId);
      }
    });

    // ── Operator sends a reply ──
    // FIX: Just append to existing messages, don't touch anything else
    socket.on('receive_message', (message) => {
      if (message.conversationId === activeConvRef.current) {
        setMessages(prev => [...prev, message]);
      }
      // Update sidebar last message (don't reload all messages)
      setConversations(prev =>
        prev.map(conv =>
          conv._id === message.conversationId
            ? { ...conv, lastMessage: message.content, lastMessageAt: message.timestamp }
            : conv
        )
      );
    });

    // ── Server confirmed our message saved ──
    // FIX: Find the pending message by tempId and REPLACE it
    socket.on('message_confirmed', (confirmedMessage) => {
      if (confirmedMessage.conversationId === activeConvRef.current) {
        setMessages(prev => {
          // Check if we have a pending message with this tempId
          const hasPending = prev.some(
            msg => msg.tempId && msg.tempId === confirmedMessage.tempId
          );

          if (hasPending) {
            // REPLACE the pending message with the confirmed one
            return prev.map(msg =>
              msg.tempId === confirmedMessage.tempId
                ? {
                    _id: confirmedMessage._id,
                    conversationId: confirmedMessage.conversationId,
                    sender: confirmedMessage.sender,
                    senderName: confirmedMessage.senderName,
                    content: confirmedMessage.content,
                    status: confirmedMessage.status,
                    timestamp: confirmedMessage.timestamp
                  }
                : msg
            );
          }

          // No pending found (edge case) - check if already exists by _id
          const alreadyExists = prev.some(
            msg => msg._id === confirmedMessage._id
          );
          if (alreadyExists) return prev;

          // Otherwise add it
          return [...prev, confirmedMessage];
        });
      }

      // Update sidebar
      setConversations(prev =>
        prev.map(conv =>
          conv._id === confirmedMessage.conversationId
            ? { ...conv, lastMessage: confirmedMessage.content, lastMessageAt: confirmedMessage.timestamp }
            : conv
        )
      );
    });

    // ── Single message status update (sent → delivered) ──
    socket.on('message_status_update', ({ messageId, status, deliveredAt }) => {
      setMessages(prev =>
        prev.map(msg =>
          msg._id === messageId
            ? { ...msg, status, deliveredAt }
            : msg
        )
      );
    });

    // ── Multiple messages marked as read ──
    socket.on('messages_read', ({ messageIds, readAt }) => {
      setMessages(prev =>
        prev.map(msg => {
          const isInList = messageIds.some(
            id => id.toString() === msg._id?.toString()
          );
          return isInList ? { ...msg, status: 'read', readAt } : msg;
        })
      );
    });

    socket.on('error_message', ({ message }) => {
      console.error('Socket error:', message);
    });

    loadConversations();

    return () => {
      disconnectSocket();
    };
  }, [user, navigate, loadConversations, loadMessages]);

  // ── Switch conversation: load messages from DB ──
  useEffect(() => {
    if (activeConversation) {
      loadMessages(activeConversation);
      const socket = getSocket();
      if (socket) {
        socket.emit('switch_conversation', {
          conversationId: activeConversation
        });
      }
    }
  }, [activeConversation, loadMessages]);

  // ── Send message ──
  const handleSendMessage = (content) => {
    const socket = getSocket();
    if (!socket || !connected || !activeConvRef.current) return;

    // Create unique temporary ID
    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Step 1: Add pending message to UI immediately (optimistic update)
    const pendingMessage = {
      tempId,
      conversationId: activeConvRef.current,
      sender: 'user',
      senderName: user.username,
      content,
      status: 'pending',
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, pendingMessage]);

    // Step 2: Send to server with tempId
    socket.emit('send_message', {
      content,
      conversationId: activeConvRef.current,
      tempId
    });
  };

  const handleTyping = () => {
    const socket = getSocket();
    if (socket && connected) socket.emit('typing');
  };

  const handleNewChat = async () => {
    try {
      const { data } = await api.post('/messages/conversations/new');
      setConversations(prev => [data, ...prev]);
      setActiveConversation(data._id);
      setMessages([]);
    } catch (error) {
      console.error('Error creating new chat:', error);
    }
  };

  const handleSelectConversation = (conversationId) => {
    setActiveConversation(conversationId);
  };

  const handleLogout = () => {
    disconnectSocket();
    logout();
    navigate('/login');
  };

  const activeConvTitle =
    conversations.find(c => c._id === activeConversation)?.title || 'Support Chat';

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