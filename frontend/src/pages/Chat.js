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

  const activeConvRef = useRef(null);
  const messagesRef = useRef([]);
  const processingQueueRef = useRef(false);
  const typingTimeoutRef = useRef(null);
  // ── NEW: Keep conversations in a ref so socket handlers see the latest list ──
  // WHY: When deleting active conversation, we need to know what to switch to
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
    });

    socket.on('conversation_info', ({ conversationId }) => {
      if (!activeConvRef.current) {
        setActiveConversation(conversationId);
        activeConvRef.current = conversationId;
        loadMessages(conversationId);
      }
    });

    socket.on('receive_message', (message) => {
      setOperatorTyping(false);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }

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
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
        typingTimeoutRef.current = setTimeout(() => {
          setOperatorTyping(false);
        }, 4000);
      } else {
        if (typingTimeoutRef.current) {
          clearTimeout(typingTimeoutRef.current);
        }
      }
    });

    // ══════════════════════════════════════════════════════
    //  NEW: MESSAGE DELETED EVENT
    // ══════════════════════════════════════════════════════
    // WHY: When someone (user's other tab, or operator) deletes a message,
    //      update this message in state to show the "deleted" placeholder
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
    //  NEW: CONVERSATION DELETED EVENT
    // ══════════════════════════════════════════════════════
    // WHY: Sync deletion across user's own tabs
    //      If another tab deleted a conversation, remove it here too
    socket.on('conversation_deleted', ({ conversationId }) => {
      console.log(`🗑️ Conversation ${conversationId} was deleted`);

      setConversations(prev => prev.filter(c => c._id !== conversationId));

      // If we were viewing the deleted conversation
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
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      disconnectSocket();
    };
  }, [user, navigate, loadConversations, loadMessages, processMessageQueue]);

  useEffect(() => {
    if (activeConversation) {
      setOperatorTyping(false);
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
      console.log('📦 Server offline - message queued');
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
    } catch (error) {
      console.error('Error creating new chat:', error);
    }
  };

  const handleSelectConversation = (conversationId) => {
    setActiveConversation(conversationId);
  };

  // ══════════════════════════════════════════════════════
  //  NEW: DELETE MESSAGE HANDLER
  // ══════════════════════════════════════════════════════
  // WHY: Sends WebSocket event to backend to soft-delete the message
  //      Backend will broadcast to all tabs + operators
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

  // ══════════════════════════════════════════════════════
  //  NEW: DELETE CONVERSATION HANDLER
  // ══════════════════════════════════════════════════════
  // WHY: Uses REST API (DELETE endpoint) to hard-delete the conversation
  //      and all its messages, then notifies operators via socket
  const handleDeleteConversation = async (conversationId) => {
    const confirmed = window.confirm(
      'Delete this entire chat?\n\nAll messages will be permanently removed. This cannot be undone.'
    );
    if (!confirmed) return;

    try {
      // Call REST API to delete
      await api.delete(`/messages/conversations/${conversationId}`);

      // Remove from local list
      setConversations(prev => prev.filter(c => c._id !== conversationId));

      // If it was the active conversation, switch to another
      if (activeConversation === conversationId) {
        const remaining = conversations.filter(c => c._id !== conversationId);
        if (remaining.length > 0) {
          setActiveConversation(remaining[0]._id);
        } else {
          setActiveConversation(null);
          setMessages([]);
        }
      }

      // Notify operators via socket so dashboards refresh
      const socket = getSocket();
      if (socket?.connected) {
        socket.emit('conversation_deleted_notify', { conversationId });
      }

      console.log(`✅ Deleted conversation: ${conversationId}`);
    } catch (err) {
      console.error('Delete conversation error:', err);
      alert('Failed to delete conversation. Please try again.');
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

              {operatorTyping ? (
                <span className="operator-typing-header">
                  Operator is typing
                  <span className="header-typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
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
            <div className="offline-dot-animation">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}

        <MessageList
          messages={messages}
          isDarkMode={isDarkMode}
          operatorTyping={operatorTyping}
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