import React, { useState } from 'react';
import { useUpload } from '../context/UploadContext';

const UploadWidget = () => {
  const { uploads, notifications, dismissUpload, dismissNotification } = useUpload();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
    <>
      {/* Toast Notifications */}
      <div className="toast-container">
        {notifications.map(notif => (
          <div
            key={notif.id}
            className={`toast toast-${notif.type}`}
            onClick={() => dismissNotification(notif.id)}
          >
            <div className="toast-icon">
              {notif.type === 'success' ? '✅' : notif.type === 'error' ? '❌' : 'ℹ️'}
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

      {/* Upload Widget */}
      {uploads.length > 0 && (
        <div className={`upload-widget ${isCollapsed ? 'collapsed' : ''}`}>
          <div
            className="upload-widget-header"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            <div className="upload-widget-title">
              <span className="upload-widget-icon">📤</span>
              <span>Processing files</span>
              <span className="upload-widget-count">{uploads.length}</span>
            </div>
            <button className="upload-widget-toggle">
              {isCollapsed ? '▲' : '▼'}
            </button>
          </div>

          {!isCollapsed && (
            <div className="upload-widget-body">
              {uploads.map(upload => (
                <div key={upload.id} className={`upload-item status-${upload.status}`}>
                  <div className="upload-item-info">
                    <div className="upload-item-name" title={upload.fileName}>
                      {upload.fileName}
                    </div>
                    <div className="upload-item-meta">
                      <span>{formatSize(upload.fileSize)}</span>
                    </div>
                  </div>

                  {/* ⭐ STAGE 1: Upload to Storage */}
                  <div className="stage-container">
                    <div className="stage-header">
                      <span className={`stage-icon ${upload.uploadProgress === 100 ? 'complete' : ''}`}>
                        {upload.uploadProgress === 100 ? '✅' : '📤'}
                      </span>
                      <span className="stage-label">Uploading to storage</span>
                      <span className="stage-percent">{upload.uploadProgress}%</span>
                    </div>
                    <div className="stage-progress-bar">
                      <div
                        className="stage-progress-fill upload"
                        style={{ width: `${upload.uploadProgress}%` }}
                      />
                    </div>
                  </div>

                  {/* ⭐ STAGE 2: Generating Embeddings */}
                  <div className="stage-container">
                    <div className="stage-header">
                      <span className={`stage-icon ${
                        upload.stage === 'complete' ? 'complete' :
                        upload.uploadProgress === 100 ? 'active' : 'waiting'
                      }`}>
                        {upload.stage === 'complete' ? '✅' :
                         upload.uploadProgress === 100 ? '🧠' : '⏳'}
                      </span>
                      <span className="stage-label">
                        {upload.uploadProgress < 100
                          ? 'Waiting to process...'
                          : upload.statusMessage || 'Generating embeddings'}
                      </span>
                      <span className="stage-percent">
                        {upload.uploadProgress === 100 ? `${upload.embeddingProgress}%` : '—'}
                      </span>
                    </div>
                    <div className="stage-progress-bar">
                      <div
                        className={`stage-progress-fill embedding ${upload.uploadProgress < 100 ? 'waiting' : ''}`}
                        style={{
                          width: upload.uploadProgress < 100 ? '0%' : `${upload.embeddingProgress}%`
                        }}
                      />
                    </div>
                  </div>

                  {/* Chunk count when complete */}
                  {upload.stage === 'complete' && upload.chunkCount > 0 && (
                    <div className="upload-item-complete">
                      💾 {upload.chunkCount} vectors saved
                    </div>
                  )}

                  {/* Error */}
                  {upload.status === 'failed' && (
                    <div className="upload-item-error">
                      {upload.statusMessage}
                    </div>
                  )}

                  <button
                    className="upload-item-dismiss"
                    onClick={() => dismissUpload(upload.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
};

export default UploadWidget;