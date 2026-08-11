import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import api from '../services/api';
import FileUploader from '../components/FileUploader';

const FilesPage = ({ operator, onLogout }) => {
  const [files, setFiles] = useState([]);
  const [stats, setStats] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);

  const { isDarkMode, toggleDarkMode } = useTheme();
  const navigate = useNavigate();

  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterType !== 'all') params.fileType = filterType;
      if (searchQuery) params.search = searchQuery;

      const { data } = await api.get('/upload/files', { params });
      setFiles(data);
    } catch (err) {
      console.error('Error loading files:', err);
    } finally {
      setLoading(false);
    }
  }, [filterType, searchQuery]);

  const loadStats = useCallback(async () => {
    try {
      const { data } = await api.get('/upload/stats');
      setStats(data);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }, []);

  useEffect(() => {
    loadFiles();
    loadStats();
  }, [loadFiles, loadStats]);

  const handleUploadComplete = (file) => {
    setFiles(prev => [file, ...prev]);
    loadStats();
  };

  const handleViewFile = async (fileId) => {
    try {
      const { data } = await api.get(`/upload/files/${fileId}`);
      setSelectedFile(data);
    } catch (err) {
      console.error('Error loading file:', err);
    }
  };

  const handleDownload = async (fileId, filename) => {
    try {
      const response = await api.get(`/upload/download/${fileId}`, {
        responseType: 'blob'
      });
      // Create blob URL and trigger download
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      alert('Download failed');
    }
  };

  const handleDelete = async (fileId) => {
    if (!window.confirm('Delete this file permanently?')) return;

    try {
      await api.delete(`/upload/files/${fileId}`);
      setFiles(prev => prev.filter(f => f._id !== fileId));
      loadStats();
      if (selectedFile?._id === fileId) setSelectedFile(null);
    } catch (err) {
      console.error('Delete error:', err);
      alert('Delete failed');
    }
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const formatDate = (date) => {
    const d = new Date(date);
    const diff = Math.floor((new Date() - d) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return d.toLocaleDateString();
  };

  const getFileIcon = (type) => {
    const icons = {
      pdf: '📕',
      docx: '📘',
      doc: '📘',
      txt: '📄',
      markdown: '📝',
      csv: '📊',
      json: '📋',
      xml: '📃',
      image: '🖼️',
      code: '💻',
      other: '📎'
    };
    return icons[type] || '📎';
  };

  const fileTypes = ['all', 'pdf', 'docx', 'txt', 'csv', 'json', 'image', 'code', 'other'];

  return (
    <div className="files-page">
      {/* ── TOP BAR ── */}
      <div className="fp-topbar">
        <div className="fp-brand">
          <button
            className="fp-back-btn"
            onClick={() => navigate('/')}
          >
            ← Back
          </button>
          <div className="fp-logo">📁</div>
          <h1>File Management</h1>
        </div>

        <div className="fp-stats-quick">
          <div className="fp-stat">
            <strong>{stats.totalFiles || 0}</strong>
            <span>Files</span>
          </div>
          <div className="fp-stat">
            <strong>{formatSize(stats.totalSize || 0)}</strong>
            <span>Total Size</span>
          </div>
        </div>

        <div className="fp-topbar-actions">
          <button className="fp-theme-btn" onClick={toggleDarkMode}>
            {isDarkMode ? '☀️' : '🌙'}
          </button>
          <button className="fp-logout" onClick={onLogout}>Logout</button>
        </div>
      </div>

      {/* ── UPLOAD SECTION ── */}
      <div className="fp-upload-section">
        <FileUploader onUploadComplete={handleUploadComplete} />
      </div>

      {/* ── FILTERS ── */}
      <div className="fp-filters">
        <div className="fp-filter-tabs">
          {fileTypes.map(type => (
            <button
              key={type}
              className={`fp-filter-tab ${filterType === type ? 'active' : ''}`}
              onClick={() => setFilterType(type)}
            >
              {type === 'all' ? '📂 All' : `${getFileIcon(type)} ${type.toUpperCase()}`}
              {stats.byType?.[type] > 0 && type !== 'all' && (
                <span className="fp-filter-count">{stats.byType[type]}</span>
              )}
            </button>
          ))}
        </div>

        <div className="fp-search-wrapper">
          <span className="fp-search-icon">🔍</span>
          <input
            type="text"
            className="fp-search"
            placeholder="Search filename or content..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* ── FILES GRID ── */}
      <div className="fp-content">
        {loading ? (
          <div className="fp-loading">Loading files...</div>
        ) : files.length === 0 ? (
          <div className="fp-empty">
            <div className="fp-empty-icon">📁</div>
            <h2>No files yet</h2>
            <p>Upload files above to get started</p>
          </div>
        ) : (
          <div className="fp-files-grid">
            {files.map(file => (
              <div
                key={file._id}
                className="file-card"
                onClick={() => handleViewFile(file._id)}
              >
                <div className="file-card-icon">
                  {getFileIcon(file.fileType)}
                </div>
                <div className="file-card-body">
                  <div className="file-card-name">{file.originalName}</div>
                  <div className="file-card-meta">
                    <span className="file-card-type">{file.fileType.toUpperCase()}</span>
                    <span className="file-card-size">{formatSize(file.size)}</span>
                  </div>
                  <div className="file-card-date">
                    Uploaded by {file.uploaderName} • {formatDate(file.uploadedAt)}
                  </div>
                  <div className={`file-card-status status-${file.parseStatus}`}>
                    {file.parseStatus === 'success' && '✅ Parsed'}
                    {file.parseStatus === 'pending' && '⏳ Parsing...'}
                    {file.parseStatus === 'failed' && '❌ Parse failed'}
                    {file.parseStatus === 'unsupported' && '⚠️ Not parseable'}
                  </div>
                </div>
                <div className="file-card-actions">
                  <button
                    className="fc-btn"
                    title="Download"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDownload(file._id, file.originalName);
                    }}
                  >
                    ⬇️
                  </button>
                  <button
                    className="fc-btn fc-delete"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(file._id);
                    }}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── FILE DETAIL MODAL ── */}
      {selectedFile && (
        <div className="file-modal-overlay" onClick={() => setSelectedFile(null)}>
          <div className="file-modal" onClick={(e) => e.stopPropagation()}>
            <div className="file-modal-header">
              <div className="file-modal-title">
                <span className="file-modal-icon">{getFileIcon(selectedFile.fileType)}</span>
                <div>
                  <h2>{selectedFile.originalName}</h2>
                  <p>
                    {selectedFile.fileType.toUpperCase()} • {formatSize(selectedFile.size)} •
                    Uploaded by {selectedFile.uploaderName} • {formatDate(selectedFile.uploadedAt)}
                  </p>
                </div>
              </div>
              <button
                className="file-modal-close"
                onClick={() => setSelectedFile(null)}
              >
                ✕
              </button>
            </div>

            <div className="file-modal-body">
              <h3>📄 Parsed Content</h3>
              {selectedFile.parseStatus === 'success' && selectedFile.parsedContent ? (
                <pre className="file-content-preview">{selectedFile.parsedContent}</pre>
              ) : selectedFile.parseStatus === 'failed' ? (
                <div className="file-parse-error">
                  ❌ Parse failed: {selectedFile.parseError}
                </div>
              ) : selectedFile.parseStatus === 'unsupported' ? (
                <div className="file-parse-warning">
                  ⚠️ This file type doesn't support text extraction
                </div>
              ) : (
                <div>⏳ Parsing in progress...</div>
              )}
            </div>

            <div className="file-modal-footer">
              <button
                className="file-modal-btn download"
                onClick={() => handleDownload(selectedFile._id, selectedFile.originalName)}
              >
                ⬇️ Download Original
              </button>
              <button
                className="file-modal-btn delete"
                onClick={() => handleDelete(selectedFile._id)}
              >
                🗑️ Delete File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FilesPage;