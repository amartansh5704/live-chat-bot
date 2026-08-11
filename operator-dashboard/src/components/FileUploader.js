import React, { useState, useRef } from 'react';
import api from '../services/api';

const FileUploader = ({ onUploadComplete }) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      uploadFiles(files);
    }
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      uploadFiles(files);
    }
  };

  const uploadFiles = async (files) => {
    setUploading(true);
    setError('');
    setProgress(0);

    try {
      // Single file
      if (files.length === 1) {
        const formData = new FormData();
        formData.append('file', files[0]);

        const { data } = await api.post('/upload/file', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setProgress(percent);
          }
        });

        onUploadComplete(data.file);
      } else {
        // Multiple files
        const formData = new FormData();
        files.forEach(file => formData.append('files', file));

        const { data } = await api.post('/upload/multiple', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (progressEvent) => {
            const percent = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            setProgress(percent);
          }
        });

        data.files.forEach(file => onUploadComplete(file));
      }

      setProgress(100);
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
      }, 500);

    } catch (err) {
      setError(err.response?.data?.message || 'Upload failed');
      setUploading(false);
      setProgress(0);
    }
  };

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="file-uploader-wrapper">
      <div
        className={`file-uploader ${isDragging ? 'dragging' : ''} ${uploading ? 'uploading' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={!uploading ? openFileDialog : undefined}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.csv,.json,.xml,.png,.jpg,.jpeg,.gif,.webp,.svg,.js,.py,.html,.css"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />

        {!uploading ? (
          <>
            <div className="uploader-icon">📁</div>
            <h3>Drop files here or click to browse</h3>
            <p>Supports: PDF, DOCX, TXT, CSV, JSON, Images and more</p>
            <p className="uploader-limit">Max size: 20 MB per file</p>
          </>
        ) : (
          <>
            <div className="uploader-icon uploading-icon">⬆️</div>
            <h3>Uploading & Parsing...</h3>
            <div className="upload-progress-bar">
              <div
                className="upload-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p>{progress}%</p>
          </>
        )}
      </div>

      {error && (
        <div className="upload-error">
          ⚠️ {error}
        </div>
      )}
    </div>
  );
};

export default FileUploader;