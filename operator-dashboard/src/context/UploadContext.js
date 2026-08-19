import React, {
  createContext,
  useState,
  useContext,
  useCallback,
  useEffect,
  useRef
} from 'react';
import { getSocket } from '../services/socket';
import { startResumableUpload } from '../services/resumableUpload';

const UploadContext = createContext();
export const useUpload = () => useContext(UploadContext);

export const UploadProvider = ({ children }) => {
  const [uploads, setUploads] = useState([]);
  const [notifications, setNotifications] = useState([]);

  const uploadCompleteListenersRef = useRef([]);
  const uploadsRef = useRef([]);
  const socketListenerAttached = useRef(false);

  // Keep ref in sync
  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

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
    uploadCompleteListenersRef.current.push(callback);
    return () => {
      uploadCompleteListenersRef.current =
        uploadCompleteListenersRef.current.filter(cb => cb !== callback);
    };
  }, []);

  // ⭐ FIX: The progress handler defined once and reused
  const handleProgressRef = useRef(null);

  handleProgressRef.current = (data) => {
    const { uploadId, stage, progress, message, chunkCount, error, willRetry } = data;

    console.log('📊 Progress event:', { uploadId, stage, progress, chunkCount });

    setUploads(prev => {
      const exists = prev.find(u => u.id === uploadId);
      if (!exists) {
        console.warn('⚠️ Progress for unknown upload:', uploadId);
        console.warn('   Known uploads:', prev.map(u => u.id));
        return prev;
      }

      return prev.map(u => {
        if (u.id !== uploadId) return u;

        const newStatus = error
          ? (willRetry ? 'retrying' : 'failed')
          : stage === 'complete'
          ? 'success'
          : 'processing';

        return {
          ...u,
          stage,
          embeddingProgress: typeof progress === 'number' ? progress : u.embeddingProgress,
          statusMessage: message || u.statusMessage,
          status: newStatus,
          chunkCount: chunkCount !== undefined ? chunkCount : u.chunkCount,
          willRetry: willRetry || false
        };
      });
    });

    // Handle completion
    if (stage === 'complete') {
      const upload = uploadsRef.current.find(u => u.id === uploadId);
      const fileName = upload?.fileName || 'File';
      const finalChunkCount = chunkCount !== undefined ? chunkCount : 0;

      const msg = finalChunkCount > 0
        ? `✅ ${fileName} processed (${finalChunkCount} vectors)`
        : `✅ ${fileName} uploaded`;

      // Use setTimeout to avoid setState during render
      setTimeout(() => {
        setNotifications(prev => [...prev, {
          id: Date.now() + Math.random(),
          type: 'success',
          message: msg,
          timestamp: Date.now()
        }]);
      }, 100);

      // Notify FilesPage to refresh
      uploadCompleteListenersRef.current.forEach(cb => {
        try { cb(upload); } catch (e) { console.error('Listener error:', e); }
      });

      // Auto-remove from widget after 4s
      setTimeout(() => {
        setUploads(prev => prev.filter(u => u.id !== uploadId));
      }, 4000);
    }

    if (stage === 'failed' && !willRetry) {
      setTimeout(() => {
        setNotifications(prev => [...prev, {
          id: Date.now() + Math.random(),
          type: 'error',
          message: `❌ Processing failed: ${message}`,
          timestamp: Date.now()
        }]);
      }, 100);

      setTimeout(() => {
        setUploads(prev => prev.filter(u => u.id !== uploadId));
      }, 8000);
    }
  };

  // ⭐ FIX: Attach socket listener with retry
  // WHY: Socket might not exist yet when UploadProvider mounts
  //      Check every 500ms until socket is available
  useEffect(() => {
    let intervalId = null;
    let currentSocket = null;

    const wrappedHandler = (data) => {
      if (handleProgressRef.current) {
        handleProgressRef.current(data);
      }
    };

    const tryAttach = () => {
      const socket = getSocket();

      if (socket && !socketListenerAttached.current) {
        // Remove any old listener first
        socket.off('upload_progress', wrappedHandler);

        // Attach new listener
        socket.on('upload_progress', wrappedHandler);
        currentSocket = socket;
        socketListenerAttached.current = true;

        console.log('✅ upload_progress listener attached to socket:', socket.id);

        // Stop checking
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      }
    };

    // Try immediately
    tryAttach();

    // If not found, keep trying every 500ms
    if (!socketListenerAttached.current) {
      console.log('⏳ Socket not ready, will retry...');
      intervalId = setInterval(tryAttach, 500);
    }

    // Also listen for socket reconnection
    const checkReconnect = () => {
      const socket = getSocket();
      if (socket && socket !== currentSocket) {
        console.log('🔄 Socket changed, re-attaching upload_progress listener');
        if (currentSocket) {
          currentSocket.off('upload_progress', wrappedHandler);
        }
        socket.on('upload_progress', wrappedHandler);
        currentSocket = socket;
        socketListenerAttached.current = true;
      }
    };

    const reconnectInterval = setInterval(checkReconnect, 2000);

    return () => {
      if (intervalId) clearInterval(intervalId);
      clearInterval(reconnectInterval);
      if (currentSocket) {
        currentSocket.off('upload_progress', wrappedHandler);
      }
      socketListenerAttached.current = false;
    };
  }, []);

  const uploadFile = useCallback((file) => {
    const uploadId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const operatorInfo = localStorage.getItem('operatorInfo');
    if (!operatorInfo) {
      addNotification('error', '❌ Not authenticated');
      return;
    }
    const { token } = JSON.parse(operatorInfo);

    console.log('📤 Starting upload:', file.name, 'uploadId:', uploadId);

    const uploadItem = {
      id: uploadId,
      fileName: file.name,
      fileSize: file.size,
      uploadProgress: 0,
      embeddingProgress: 0,
      stage: 'uploading',
      status: 'uploading',
      statusMessage: 'Starting upload...',
      chunkCount: 0,
      startTime: Date.now(),
      controls: null
    };

    setUploads(prev => [...prev, uploadItem]);

    const controls = startResumableUpload({
      file,
      token,
      uploadId,

      onProgress: ({ stage: pStage, progress, message }) => {
        setUploads(prev => prev.map(u => {
          if (u.id !== uploadId) return u;
          if (pStage === 'retrying') {
            return { ...u, statusMessage: message, status: 'retrying' };
          }
          return {
            ...u,
            uploadProgress: typeof progress === 'number' ? progress : u.uploadProgress,
            statusMessage: message,
            status: 'uploading'
          };
        }));
      },

      onSuccess: ({ mongoFileId }) => {
        console.log('✅ S3 upload complete:', file.name, 'uploadId:', uploadId);
        console.log('   Waiting for worker progress via socket...');
        setUploads(prev => prev.map(u =>
          u.id === uploadId
            ? {
                ...u,
                uploadProgress: 100,
                stage: 'embedding',
                status: 'processing',
                statusMessage: 'Queued for processing...',
                mongoFileId
              }
            : u
        ));
      },

      onError: (error) => {
        const errorMsg = error.message || 'Upload failed';
        console.error('❌ Upload error:', errorMsg);
        setUploads(prev => prev.map(u =>
          u.id === uploadId
            ? { ...u, status: 'failed', statusMessage: errorMsg }
            : u
        ));
        addNotification('error', `❌ ${file.name}: ${errorMsg}`);
        setTimeout(() => {
          setUploads(prev => prev.filter(u => u.id !== uploadId));
        }, 8000);
      }
    });

    if (controls) {
      setUploads(prev => prev.map(u =>
        u.id === uploadId ? { ...u, controls } : u
      ));
    }
  }, [addNotification]);

  const uploadFiles = useCallback((files) => {
    Array.from(files).forEach(file => uploadFile(file));
  }, [uploadFile]);

  const pauseUpload = useCallback((uploadId) => {
    setUploads(prev => prev.map(u => {
      if (u.id !== uploadId) return u;
      u.controls?.pause();
      return { ...u, status: 'paused', statusMessage: 'Paused' };
    }));
  }, []);

  const resumeUpload = useCallback((uploadId) => {
    setUploads(prev => prev.map(u => {
      if (u.id !== uploadId) return u;
      u.controls?.resume();
      return { ...u, status: 'uploading', statusMessage: 'Resuming...' };
    }));
  }, []);

  const cancelUpload = useCallback((uploadId) => {
    setUploads(prev => {
      const upload = prev.find(u => u.id === uploadId);
      upload?.controls?.cancel();
      return prev.filter(u => u.id !== uploadId);
    });
  }, []);

  const dismissUpload = useCallback((uploadId) => {
    setUploads(prev => prev.filter(u => u.id !== uploadId));
  }, []);

  const value = {
    uploads,
    notifications,
    uploadFile,
    uploadFiles,
    pauseUpload,
    resumeUpload,
    cancelUpload,
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