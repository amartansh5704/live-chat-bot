import React, { createContext, useState, useContext, useCallback, useEffect } from 'react';
import api from '../services/api';
import { getSocket } from '../services/socket';

const UploadContext = createContext();

export const useUpload = () => useContext(UploadContext);

export const UploadProvider = ({ children }) => {
  const [uploads, setUploads] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [uploadCompleteListeners, setUploadCompleteListeners] = useState([]);

  const addNotification = useCallback((type, message) => {
    const id = Date.now() + Math.random();
    setNotifications(prev => [...prev, { id, type, message, timestamp: Date.now() }]);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);
  }, []);

  const dismissNotification = useCallback((id) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const onUploadComplete = useCallback((callback) => {
    setUploadCompleteListeners(prev => [...prev, callback]);
    return () => {
      setUploadCompleteListeners(prev => prev.filter(cb => cb !== callback));
    };
  }, []);

  // ⭐ Listen for progress events from server
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;

    const handleProgress = (data) => {
      const { uploadId, stage, progress, message, chunkCount, error } = data;

      setUploads(prev => prev.map(u => {
        if (u.id !== uploadId) return u;

        return {
          ...u,
          stage,
          embeddingProgress: progress,
          statusMessage: message,
          status: error ? 'failed' : (stage === 'complete' ? 'success' : 'processing'),
          chunkCount: chunkCount !== undefined ? chunkCount : u.chunkCount
        };
      }));

      // On complete, show notification and cleanup
      if (stage === 'complete') {
        const upload = uploads.find(u => u.id === uploadId);
        if (upload) {
          const msg = chunkCount > 0
            ? `✅ ${upload.fileName} processed (${chunkCount} vectors)`
            : `✅ ${upload.fileName} uploaded`;
          addNotification('success', msg);

          uploadCompleteListeners.forEach(cb => cb(upload));

          setTimeout(() => {
            setUploads(prev => prev.filter(u => u.id !== uploadId));
          }, 3000);
        }
      } else if (stage === 'failed') {
        addNotification('error', `❌ ${message}`);
        setTimeout(() => {
          setUploads(prev => prev.filter(u => u.id !== uploadId));
        }, 5000);
      }
    };

    socket.on('upload_progress', handleProgress);
    return () => socket.off('upload_progress', handleProgress);
  }, [uploads, uploadCompleteListeners, addNotification]);

  // ⭐ Upload file with 2-stage tracking
  const uploadFile = useCallback(async (file) => {
    const uploadId = Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    // Add to uploads list with initial state
    const uploadItem = {
      id: uploadId,
      fileName: file.name,
      fileSize: file.size,
      // Stage 1: Uploading to storage
      uploadProgress: 0,
      // Stage 2: Generating embeddings
      embeddingProgress: 0,
      stage: 'uploading',
      status: 'uploading',
      statusMessage: 'Uploading to storage...',
      chunkCount: 0,
      startTime: Date.now()
    };

    setUploads(prev => [...prev, uploadItem]);

    try {
      const formData = new FormData();
      formData.append('file', file);

      await api.post('/upload/file', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'x-upload-id': uploadId  // ⭐ Send uploadId to backend
        },
        onUploadProgress: (progressEvent) => {
          const percent = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploads(prev => prev.map(u =>
            u.id === uploadId
              ? { ...u, uploadProgress: percent }
              : u
          ));
        }
      });

      // Upload to S3 complete - transitioning to embedding stage
      setUploads(prev => prev.map(u =>
        u.id === uploadId
          ? {
              ...u,
              uploadProgress: 100,
              stage: 'embedding',
              status: 'processing',
              statusMessage: 'Starting content processing...'
            }
          : u
      ));

      // Embedding progress comes via WebSocket
      // (handled in the useEffect above)

    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message || 'Upload failed';
      setUploads(prev => prev.map(u =>
        u.id === uploadId
          ? { ...u, status: 'failed', statusMessage: errorMsg }
          : u
      ));
      addNotification('error', `❌ ${file.name}: ${errorMsg}`);
      setTimeout(() => {
        setUploads(prev => prev.filter(u => u.id !== uploadId));
      }, 5000);
    }
  }, [addNotification]);

  const uploadFiles = useCallback((files) => {
    Array.from(files).forEach(file => uploadFile(file));
  }, [uploadFile]);

  const dismissUpload = useCallback((uploadId) => {
    setUploads(prev => prev.filter(u => u.id !== uploadId));
  }, []);

  const value = {
    uploads,
    notifications,
    uploadFile,
    uploadFiles,
    dismissUpload,
    addNotification,
    dismissNotification,
    onUploadComplete
  };

  return (
    <UploadContext.Provider value={value}>
      {children}
    </UploadContext.Provider>
  );
};