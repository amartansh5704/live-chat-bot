// operator-dashboard/src/components/FileUploader.js
// No changes needed here - it calls uploadFiles from context
// which now uses tus internally
import React, { useState, useRef } from 'react';
import { useUpload } from '../context/UploadContext';

const FileUploader = () => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const { uploadFiles } = useUpload();

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
    if (files.length > 0) uploadFiles(files);
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      uploadFiles(files);
      e.target.value = null;
    }
  };

  return (
    <div className="file-uploader-wrapper">
      <div
        className={`file-uploader ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.csv,.json,.xml,.png,.jpg,.jpeg,.gif,.webp,.svg,.js,.py,.html,.css"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <div className="uploader-icon">📁</div>
        <h3>Drop files here or click to browse</h3>
        <p>Supports: PDF, DOCX, TXT, CSV, JSON, Images and more</p>
        <p className="uploader-limit">
          Max 20 MB per file • Resumable upload • Auto-resumes on network failure
        </p>
      </div>
    </div>
  );
};

export default FileUploader;