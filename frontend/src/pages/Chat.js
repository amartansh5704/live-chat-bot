// frontend/src/pages/Chat.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { initSocket, disconnectSocket, getSocket, isConnected } from '../services/socket';
import api from '../services/api';
import MessageList from '../components/MessageList';
import MessageInput from '../components/MessageInput';
import Sidebar from '../components/Sidebar';
import {
  addToQueue,
  getQueue,
  removeFromQueue,
  savePendingMessages,
  getPendingMessages,
  removePendingMessage
} from '../services/messageQueue';

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConversation, setActiveConversation] = useState(null);
  const [connected, setConnected] = useState(false);
  const [serverOnline, setServerOnline] = useState(true);
  const [operatorTyping, setOperatorTyping] = useState(false);

  // ⭐ NEW: AI streaming and typing states
  const [aiTyping, setAiTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState(null);

  const activeConvRef = useRef(null);
  const messagesRef = useRef([]);
  const processingQueueRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  const aiTypingTimeoutRef = useRef(null);
  const conversationsRef = useRef([]);

  const { user, logout } = useAuth();
  const { isDarkMode } = useTheme();
  const navigate = useNavigate();

  useEffect(() => {
    activeConvRef.current = activeConversation;
  }, [activeConversation]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    if (activeConversation && messages.length > 0) {
      savePendingMessages(activeConversation, messages);
    }
  }, [messages, activeConversation]);

  const loadConversations = useCallback(async () => {
    try {
      const { data } = await api.get('/messages/conversations/all');
      setConversations(data);
      setServerOnline(true);
      if (data.length > 0 && !activeConvRef.current) {
        setActiveConversation(data[0]._id);
        activeConvRef.current = data[0]._id;
      }
      return data;
    } catch (error) {
      console.error('Error loading conversations:', error);
      if (error.code === 'ERR_NETWORK') setServerOnline(false);
      return [];
    }
  }, []);

  const loadMessages = useCallback(async (conversationId) => {
    if (!conversationId) return;
    const pendingMsgs = getPendingMessages(conversationId);
    try {
      const { data } = await api.get(`/messages/${conversationId}`);
      setServerOnline(true);
      const stillPending = pendingMsgs.filter(
        pm => !data.some(
          dbMsg => dbMsg.content === pm.content && dbMsg.senderName === pm.senderName
        )
      );
      setMessages([...data, ...stillPending]);
    } catch (error) {
      console.error('Error loading messages:', error);
      if (error.code === 'ERR_NETWORK') {
        setServerOnline(false);
        setMessages([...pendingMsgs]);
      }
    }
  }, []);

  const processMessageQueue = useCallback(async () => {
    if (processingQueueRef.current) return;
    const queue = getQueue();
    if (queue.length === 0) return;
    processingQueueRef.current = true;
    console.log(`📤 Processing ${queue.length} queued messages...`);
    const socket = getSocket();
    if (!socket?.connected) {
      processingQueueRef.current = false;
      return;
    }
    for (const queuedMsg of queue) {
      try {
        socket.emit('send_message', {
          content: queuedMsg.content,
          conversationId: queuedMsg.conversationId,
          tempId: queuedMsg.tempId
        });
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error('Error sending queued message:', error);
        break;
      }
    }
    processingQueueRef.current = false;
  }, []);

  useEffect(() => {
    if (!user?.token) {
      navigate('/login');
      return;
    }

    const socket = initSocket(user.token);

    socket.on('connect', () => {
      setConnected(true);
      setServerOnline(true);
      setTimeout(() => processMessageQueue(), 1000);
    });

    socket.on('disconnect', (reason) => {
      setConnected(false);
      setOperatorTyping(false);
      setAiTyping(false);
      setStreamingMessage(null);
      if (reason === 'io server disconnect' || reason === 'transport close') {
        setServerOnline(false);
      }
    });

    socket.io.on('reconnect_attempt', () => {
      setServerOnline(false);
    });

    socket.io.on('reconnect', () => {
      setConnected(true);
      setServerOnline(true);
      loadConversations();
      if (activeConvRef.current) loadMessages(activeConvRef.current);
      setTimeout(() => processMessageQueue(), 1500);
    });

    socket.on('connect_error', () => {
      setConnected(false);
      setServerOnline(false);
      setOperatorTyping(false);
      setAiTyping(false);
    });

    socket.on('conversation_info', ({ conversationId }) => {
      if (!activeConvRef.current) {
        setActiveConversation(conversationId);
        activeConvRef.current = conversationId;
        loadMessages(conversationId);
      }
    });

    // ── Human Operator message receive ──
    socket.on('receive_message', (message) => {
      setOperatorTyping(false);
      setAiTyping(false);
      setStreamingMessage(null);

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);

      if (message.conversationId === activeConvRef.current) {
        setMessages(prev => [...prev, message]);
      }
      setConversations(prev =>
        prev.map(conv =>
          conv._id === message.conversationId
            ? { ...conv, lastMessage: message.content, lastMessageAt: message.timestamp }
            : conv
        )
      );
    });

    // ══════════════════════════════════════════════════════
    //  ⭐ NEW: AI STREAMING LISTENERS
    // ══════════════════════════════════════════════════════

    // 1. AI is thinking / generating
    socket.on('ai_typing', ({ conversationId, isTyping }) => {
      if (conversationId === activeConvRef.current) {
        setAiTyping(isTyping);
        if (isTyping) {
          if (aiTypingTimeoutRef.current) clearTimeout(aiTypingTimeoutRef.current);
          aiTypingTimeoutRef.current = setTimeout(() => setAiTyping(false), 8000);
        }
      }
    });

    // 2. Real-time token streaming
    socket.on('ai_message_chunk', ({ conversationId, content, fullText }) => {
      if (conversationId === activeConvRef.current) {
        setAiTyping(false);
        setStreamingMessage({
          conversationId,
          sender: 'operator',
          senderName: 'Support Assistant',
          content: fullText,
          isAI: true,
          isStreaming: true,
          timestamp: new Date().toISOString()
        });
      }
    });

    // 3. AI finished generating
    socket.on('ai_message_complete', ({ conversationId, messageId, fullText, sources }) => {
      if (conversationId === activeConvRef.current) {
        setAiTyping(false);
        setStreamingMessage(null);

        // Add finalized message to history
        setMessages(prev => {
          const alreadyExists = prev.some(m => m._id === messageId);
          if (alreadyExists) return prev;

          return [...prev, {
            _id: messageId,
            conversationId,
            sender: 'operator',
            senderName: 'Support Assistant',
            content: fullText,
            status: 'delivered',
            isAI: true,
            aiSources: sources || [],
            timestamp: new Date().toISOString()
          }];
        });
      }

      setConversations(prev =>
        prev.map(conv =>
          conv._id === conversationId
            ? { ...conv, lastMessage: fullText, lastMessageAt: new Date().toISOString() }
            : conv
        )
      );
    });

    // 4. AI error
    socket.on('ai_message_error', ({ conversationId, error }) => {
      if (conversationId === activeConvRef.current) {
        setAiTyping(false);
        setStreamingMessage(null);
      }
    });

    socket.on('message_confirmed', (confirmedMessage) => {
      if (confirmedMessage.tempId) {
        removeFromQueue(confirmedMessage.tempId);
        removePendingMessage(
          confirmedMessage.conversationId,
          confirmedMessage.tempId
        );
      }
      if (confirmedMessage.conversationId === activeConvRef.current) {
        setMessages(prev => {
          const hasPending = prev.some(
            msg => msg.tempId && msg.tempId === confirmedMessage.tempId
          );
          if (hasPending) {
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
          const alreadyExists = prev.some(msg => msg._id === confirmedMessage._id);
          if (alreadyExists) return prev;
          return [...prev, confirmedMessage];
        });
      }
      setConversations(prev =>
        prev.map(conv =>
          conv._id === confirmedMessage.conversationId
            ? { ...conv, lastMessage: confirmedMessage.content, lastMessageAt: confirmedMessage.timestamp }
            : conv
        )
      );
    });

    socket.on('message_status_update', ({ messageId, status, deliveredAt }) => {
      setMessages(prev =>
        prev.map(msg =>
          msg._id === messageId ? { ...msg, status, deliveredAt } : msg
        )
      );
    });

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

    socket.on('operator_typing', ({ isTyping }) => {
      setOperatorTyping(isTyping);
      if (isTyping) {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = setTimeout(() => setOperatorTyping(false), 4000);
      } else {
        if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      }
    });

    socket.on('message_deleted', ({ messageId, deletedBy, deletedAt, deletedByName }) => {
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

    socket.on('conversation_deleted', ({ conversationId }) => {
      setConversations(prev => prev.filter(c => c._id !== conversationId));

      if (activeConvRef.current === conversationId) {
        const remaining = conversationsRef.current.filter(c => c._id !== conversationId);
        if (remaining.length > 0) {
          setActiveConversation(remaining[0]._id);
        } else {
          setActiveConversation(null);
          setMessages([]);
        }
      }
    });

    socket.on('error_message', ({ message }) => {
      console.error('Socket error:', message);
    });

    loadConversations();

    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (aiTypingTimeoutRef.current) clearTimeout(aiTypingTimeoutRef.current);
      disconnectSocket();
    };
  }, [user, navigate, loadConversations, loadMessages, processMessageQueue]);

  useEffect(() => {
    if (activeConversation) {
      setOperatorTyping(false);
      setAiTyping(false);
      setStreamingMessage(null);
      loadMessages(activeConversation);
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('switch_conversation', { conversationId: activeConversation });
      }
    }
  }, [activeConversation, loadMessages]);

  const handleSendMessage = (content) => {
    if (!activeConvRef.current) return;

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = new Date().toISOString();

    const pendingMessage = {
      tempId,
      conversationId: activeConvRef.current,
      sender: 'user',
      senderName: user.username,
      content,
      status: 'pending',
      timestamp
    };

    setMessages(prev => [...prev, pendingMessage]);

    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('send_message', {
        content,
        conversationId: activeConvRef.current,
        tempId
      });
    } else {
      addToQueue(pendingMessage);
    }
  };

  const handleTyping = () => {
    const socket = getSocket();
    if (socket?.connected) socket.emit('typing');
  };

  const handleNewChat = async () => {
    try {
      const { data } = await api.post('/messages/conversations/new');
      setConversations(prev => [data, ...prev]);
      setActiveConversation(data._id);
      setMessages([]);
      setStreamingMessage(null);
    } catch (error) {
      console.error('Error creating new chat:', error);
    }
  };

  const handleSelectConversation = (conversationId) => {
    setActiveConversation(conversationId);
  };

  const handleDeleteMessage = (messageId) => {
    const confirmed = window.confirm('Delete this message?');
    if (!confirmed) return;

    const socket = getSocket();
    if (socket?.connected) {
      socket.emit('delete_message', { messageId });
    } else {
      alert('Cannot delete: server is offline');
    }
  };

  const handleDeleteConversation = async (conversationId) => {
    const confirmed = window.confirm(
      'Delete this entire chat?\n\nAll messages will be permanently removed. This cannot be undone.'
    );
    if (!confirmed) return;

    try {
      await api.delete(`/messages/conversations/${conversationId}`);
      setConversations(prev => prev.filter(c => c._id !== conversationId));

      if (activeConversation === conversationId) {
        const remaining = conversations.filter(c => c._id !== conversationId);
        if (remaining.length > 0) {
          setActiveConversation(remaining[0]._id);
        } else {
          setActiveConversation(null);
          setMessages([]);
        }
      }

      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('conversation_deleted_notify', { conversationId });
      }
    } catch (err) {
      alert('Failed to delete conversation.');
    }
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
        onDeleteConversation={handleDeleteConversation}
        user={user}
        onLogout={handleLogout}
      />

      <div className={`chat-main ${isDarkMode ? 'dark' : ''}`}>
        <div className={`chat-header ${isDarkMode ? 'dark' : ''}`}>
          <div className="chat-header-info">
            <div className="chat-header-left">
              <h2>🤖 {activeConvTitle}</h2>

              {aiTyping ? (
                <span className="operator-typing-header" style={{ color: '#8b5cf6' }}>
                  AI is searching knowledge base...
                  <span className="header-typing-dots">
                    <span></span><span></span><span></span>
                  </span>
                </span>
              ) : operatorTyping ? (
                <span className="operator-typing-header">
                  Operator is typing
                  <span className="header-typing-dots">
                    <span></span><span></span><span></span>
                  </span>
                </span>
              ) : (
                <span className={`connection-status ${connected ? 'online' : 'offline'}`}>
                  {connected ? '● Connected' : '○ Reconnecting...'}
                </span>
              )}
            </div>
          </div>
        </div>

        {!serverOnline && (
          <div className="offline-banner">
            <span className="offline-icon">📡</span>
            <div className="offline-text">
              <strong>Server is offline</strong>
              <span>Messages will be sent when connection is restored</span>
            </div>
          </div>
        )}

        <MessageList
          messages={messages}
          streamingMessage={streamingMessage}
          isDarkMode={isDarkMode}
          operatorTyping={operatorTyping}
          aiTyping={aiTyping}
          currentUsername={user?.username}
          onDeleteMessage={handleDeleteMessage}
        />

        <MessageInput
          onSendMessage={handleSendMessage}
          onTyping={handleTyping}
          isDarkMode={isDarkMode}
          serverOnline={serverOnline}
        />
      </div>
    </div>
  );
};

export default Chat;