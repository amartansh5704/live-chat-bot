import React, { useState } from 'react';
import { useUpload } from '../context/UploadContext';

const UploadWidget = () => {
  const {
    uploads,
    notifications,
    dismissUpload,
    dismissNotification,
    pauseUpload,
    resumeUpload,
    cancelUpload
  } = useUpload();

  const [isCollapsed, setIsCollapsed] = useState(false);

  const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  // ⭐ Single source of truth for status display
  const getStatusInfo = (upload) => {
    switch (upload.status) {
      case 'uploading':
        return { label: '📤 Uploading to S3', color: '#3b82f6' };
      case 'retrying':
        return { label: '🔄 Retrying...', color: '#f59e0b' };
      case 'paused':
        return { label: '⏸️ Paused', color: '#6b7280' };
      case 'processing':
        return { label: '🧠 Processing...', color: '#8b5cf6' };
      case 'success':
        return { label: '✅ Complete', color: '#10b981' };
      case 'failed':
        return { label: '❌ Failed', color: '#ef4444' };
      default:
        return { label: '⏳ Waiting', color: '#6b7280' };
    }
  };

  // ⭐ FIX: Derive stage 1 progress correctly
  // uploadProgress comes from onProgress in resumableUpload.js
  // After S3 upload done → uploadProgress = 100, status = 'processing'
  const getStage1Progress = (upload) => {
    if (upload.status === 'processing' || upload.status === 'success') return 100;
    if (upload.status === 'failed' && upload.uploadProgress === 100) return 100;
    return upload.uploadProgress || 0;
  };

  // ⭐ FIX: Derive stage 2 progress correctly
  // embeddingProgress comes from socket upload_progress events
  const getStage2Progress = (upload) => {
    if (upload.status === 'success') return 100;
    if (upload.status === 'processing') return upload.embeddingProgress || 0;
    return 0;
  };

  // ⭐ FIX: Stage 2 status icon
  const getStage2Icon = (upload) => {
    if (upload.status === 'success') return '✅';
    if (upload.status === 'processing') return '🧠';
    if (upload.status === 'failed') return '❌';
    return '⏳'; // still uploading
  };

  // ⭐ FIX: Stage 2 label
  const getStage2Label = (upload) => {
    if (upload.status === 'success') {
      return upload.chunkCount > 0
        ? `Done! ${upload.chunkCount} vectors saved`
        : 'Complete';
    }
    if (upload.status === 'processing') {
      return upload.statusMessage || 'Generating embeddings...';
    }
    if (upload.status === 'failed') {
      return upload.statusMessage || 'Failed';
    }
    // Still uploading to S3
    if (upload.uploadProgress < 100) {
      return 'Waiting for upload...';
    }
    return upload.statusMessage || 'Processing...';
  };

  return (
    <>
      {/* ── Toast Notifications ── */}
      <div className="toast-container">
        {notifications.map(notif => (
          <div
            key={notif.id}
            className={`toast toast-${notif.type}`}
            onClick={() => dismissNotification(notif.id)}
          >
            <div className="toast-icon">
              {notif.type === 'success' ? '✅' :
               notif.type === 'error' ? '❌' :
               notif.type === 'info' ? '🔄' : 'ℹ️'}
            </div>
            <div className="toast-message">{notif.message}</div>
            <button
              className="toast-close"
              onClick={(e) => {
                e.stopPropagation();
                dismissNotification(notif.id);
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {/* ── Upload Widget ── */}
      {uploads.length > 0 && (
        <div className={`upload-widget ${isCollapsed ? 'collapsed' : ''}`}>
          <div
            className="upload-widget-header"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            <div className="upload-widget-title">
              <span className="upload-widget-icon">📤</span>
              <span>Uploads</span>
              <span className="upload-widget-count">{uploads.length}</span>
            </div>
            <button
              className="upload-widget-toggle"
              onClick={(e) => {
                e.stopPropagation();
                setIsCollapsed(!isCollapsed);
              }}
            >
              {isCollapsed ? '▲' : '▼'}
            </button>
          </div>

          {!isCollapsed && (
            <div className="upload-widget-body">
              {uploads.map(upload => {
                const statusInfo = getStatusInfo(upload);
                const stage1Progress = getStage1Progress(upload);
                const stage2Progress = getStage2Progress(upload);
                const isUploading = upload.status === 'uploading';
                const isPaused = upload.status === 'paused';
                const isDone = upload.status === 'success' || upload.status === 'failed';
                const canPauseResume = (isUploading || isPaused) && upload.uploadProgress < 100;

                return (
                  <div
                    key={upload.id}
                    className={`upload-item status-${upload.status}`}
                  >
                    {/* File info row */}
                    <div className="upload-item-info">
                      <div className="upload-item-name" title={upload.fileName}>
                        {upload.fileName}
                      </div>
                      <div className="upload-item-meta">
                        <span style={{ color: statusInfo.color, fontWeight: 600, fontSize: '11px' }}>
                          {statusInfo.label}
                        </span>
                        <span style={{ color: '#888', fontSize: '11px' }}>
                          {' '}• {formatSize(upload.fileSize)}
                        </span>
                      </div>
                    </div>

                    {/* Stage 1: Upload to S3 */}
                    <div className="stage-container">
                      <div className="stage-header">
                        <span className="stage-icon">
                          {stage1Progress >= 100 ? '✅' : '📤'}
                        </span>
                        <span className="stage-label">Upload to storage</span>
                        <span className="stage-percent">{stage1Progress}%</span>
                      </div>
                      <div className="stage-progress-bar">
                        <div
                          className="stage-progress-fill upload"
                          style={{ width: `${stage1Progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Stage 2: Process + Embed */}
                    <div className="stage-container">
                      <div className="stage-header">
                        <span className="stage-icon">
                          {getStage2Icon(upload)}
                        </span>
                        <span className="stage-label">
                          {getStage2Label(upload)}
                        </span>
                        <span className="stage-percent">
                          {stage1Progress >= 100 ? `${stage2Progress}%` : '—'}
                        </span>
                      </div>
                      <div className="stage-progress-bar">
                        <div
                          className={`stage-progress-fill embedding ${
                            stage1Progress < 100 ? 'waiting' : ''
                          }`}
                          style={{ width: `${stage2Progress}%` }}
                        />
                      </div>
                    </div>

                    {/* Vectors saved (success) */}
                    {upload.status === 'success' && upload.chunkCount > 0 && (
                      <div className="upload-item-complete">
                        💾 {upload.chunkCount} vectors saved to Supabase
                      </div>
                    )}

                    {/* Retry message */}
                    {upload.status === 'retrying' && (
                      <div style={{ fontSize: '11px', color: '#f59e0b', padding: '2px 0' }}>
                        🔄 {upload.statusMessage}
                      </div>
                    )}

                    {/* Error message */}
                    {upload.status === 'failed' && (
                      <div className="upload-item-error">
                        {upload.statusMessage}
                      </div>
                    )}

                    {/* Controls row */}
                    <div className="upload-item-controls">
                      {/* Pause/Resume - only during S3 upload phase */}
                      {canPauseResume && (
                        <button
                          className="upload-ctrl-btn"
                          title={isPaused ? 'Resume' : 'Pause'}
                          onClick={() => isPaused
                            ? resumeUpload(upload.id)
                            : pauseUpload(upload.id)
                          }
                        >
                          {isPaused ? '▶️' : '⏸️'}
                        </button>
                      )}

                      {/* Cancel - during upload or processing */}
                      {!isDone && (
                        <button
                          className="upload-ctrl-btn cancel"
                          title="Cancel"
                          onClick={() => cancelUpload(upload.id)}
                        >
                          🚫
                        </button>
                      )}

                      {/* Dismiss - when done */}
                      {isDone && (
                        <button
                          className="upload-item-dismiss"
                          title="Dismiss"
                          onClick={() => dismissUpload(upload.id)}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default UploadWidget;