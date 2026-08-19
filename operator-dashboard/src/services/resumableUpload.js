// operator-dashboard/src/services/resumableUpload.js
// Custom chunked upload using S3 Multipart Upload API
// NO external tus library needed
// 
// Resume works by storing upload state in localStorage
// { uploadId, s3UploadId, s3Key, mongoFileId, parts, bytesUploaded }

import api from './api';

const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB - S3 minimum part size
const STORAGE_KEY = 'resumable_uploads';

// ── Save upload state to localStorage ──
// WHY: If network dies or page refreshes,
//      we can resume from where we stopped
const saveUploadState = (uploadId, state) => {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    all[uploadId] = { ...state, savedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('Could not save upload state:', e.message);
  }
};

// ── Get saved upload state ──
const getUploadState = (uploadId) => {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return all[uploadId] || null;
  } catch (e) {
    return null;
  }
};

// ── Clear upload state ──
const clearUploadState = (uploadId) => {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    delete all[uploadId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {}
};

// ── Active upload controllers (for pause/cancel) ──
const activeUploads = new Map();

// ── Main upload function ──
export const startResumableUpload = ({
  file,
  token,
  uploadId,
  onProgress,
  onSuccess,
  onError
}) => {
  // Control flags
  let isPaused = false;
  let isCancelled = false;
  let currentXhr = null;

  const run = async () => {
    try {
      // ── Check for existing upload state ──
      // WHY: If this upload was interrupted before,
      //      we resume from the last completed chunk
      let state = getUploadState(uploadId);
      let s3UploadId, s3Key, mongoFileId, completedParts, startChunk;

      if (state && state.s3UploadId) {
        // RESUME: restore previous state
        console.log(`🔄 Resuming upload: ${file.name}`);
        console.log(`   Resuming from chunk ${state.nextChunk}`);
        s3UploadId = state.s3UploadId;
        s3Key = state.s3Key;
        mongoFileId = state.mongoFileId;
        completedParts = state.parts || [];
        startChunk = state.nextChunk || 0;

        // Show resumed progress
        const resumedBytes = startChunk * CHUNK_SIZE;
        const percent = Math.round((resumedBytes / file.size) * 100);
        onProgress({
          stage: 'uploading',
          progress: percent,
          message: `Resumed from ${percent}%`
        });

      } else {
        // NEW UPLOAD: initialize on server
        console.log(`📤 Starting new upload: ${file.name}`);

        onProgress({
          stage: 'uploading',
          progress: 0,
          message: 'Initializing upload...'
        });

        const initResponse = await api.post('/upload/resumable/init', {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || 'application/octet-stream',
          uploadId
        });

        s3UploadId = initResponse.data.s3UploadId;
        s3Key = initResponse.data.s3Key;
        mongoFileId = initResponse.data.mongoFileId;
        completedParts = [];
        startChunk = 0;

        // Save initial state
        saveUploadState(uploadId, {
          s3UploadId,
          s3Key,
          mongoFileId,
          parts: [],
          nextChunk: 0,
          fileName: file.name,
          fileSize: file.size
        });
      }

      // ── Calculate chunks ──
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      console.log(`   Total chunks: ${totalChunks}, Starting from: ${startChunk}`);

      // ── Upload chunks one by one ──
      for (let chunkIndex = startChunk; chunkIndex < totalChunks; chunkIndex++) {

        // Check pause
        while (isPaused && !isCancelled) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        // Check cancel
        if (isCancelled) {
          // Abort S3 multipart upload
          await api.post('/upload/resumable/abort', {
            s3UploadId, s3Key, mongoFileId
          }).catch(() => {});
          clearUploadState(uploadId);
          return;
        }

        // Slice this chunk from file
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const partNumber = chunkIndex + 1; // S3 parts are 1-indexed

        // Upload chunk with retry logic
        let etag = null;
        let retries = 0;
        const MAX_RETRIES = 3;

        while (retries < MAX_RETRIES && !isCancelled) {
          try {
            const formData = new FormData();
            formData.append('chunk', chunk, `chunk-${partNumber}`);
            formData.append('s3UploadId', s3UploadId);
            formData.append('s3Key', s3Key);
            formData.append('partNumber', partNumber.toString());

            const chunkResponse = await api.post('/upload/resumable/chunk', formData, {
              headers: { 'Content-Type': 'multipart/form-data' },
              onUploadProgress: (e) => {
                // Progress within this chunk
                const chunkProgress = e.total > 0 ? e.loaded / e.total : 0;
                const overallProgress = ((chunkIndex + chunkProgress) / totalChunks) * 100;
                onProgress({
                  stage: 'uploading',
                  progress: Math.round(overallProgress),
                  message: `Uploading chunk ${chunkIndex + 1}/${totalChunks}...`
                });
              },
              // Store xhr ref for cancellation
              onDownloadProgress: () => {}
            });

            etag = chunkResponse.data.etag;
            break; // success, exit retry loop

          } catch (chunkError) {
            retries++;
            console.warn(`   Chunk ${partNumber} failed (attempt ${retries}/${MAX_RETRIES}):`, chunkError.message);

            if (retries >= MAX_RETRIES) throw chunkError;

            // Wait before retry: 2s, 5s, 10s
            const delay = retries * 2000 + (retries - 1) * 3000;
            console.log(`   Retrying in ${delay}ms...`);
            onProgress({
              stage: 'retrying',
              progress: Math.round((chunkIndex / totalChunks) * 100),
              message: `Network error, retrying chunk ${partNumber}... (${retries}/${MAX_RETRIES})`
            });
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }

        if (!etag) throw new Error(`Failed to upload chunk ${partNumber}`);

        // Record completed part
        completedParts.push({ partNumber, etag });

        // Save progress to localStorage
        // WHY: If browser closes NOW, we can resume from next chunk
        saveUploadState(uploadId, {
          s3UploadId,
          s3Key,
          mongoFileId,
          parts: completedParts,
          nextChunk: chunkIndex + 1,
          fileName: file.name,
          fileSize: file.size
        });

        console.log(`   ✅ Chunk ${partNumber}/${totalChunks} complete`);
      }

      // ── All chunks uploaded - complete the upload ──
      if (!isCancelled) {
        onProgress({
          stage: 'uploading',
          progress: 100,
          message: 'Assembling file...'
        });

        await api.post('/upload/resumable/complete', {
          s3UploadId,
          s3Key,
          mongoFileId,
          uploadId,
          parts: completedParts,
          fileName: file.name,
          fileSize: file.size
        });

        // Clear saved state - upload done
        clearUploadState(uploadId);

        console.log(`✅ Upload complete: ${file.name}`);
        onSuccess({ uploadId, mongoFileId });
      }

    } catch (error) {
      if (!isCancelled) {
        console.error(`❌ Upload failed: ${error.message}`);
        onError(error);
      }
    }
  };

  // Start the upload
  run();

  // Return controls
  const controls = {
    pause: () => {
      isPaused = true;
      console.log(`⏸️  Paused: ${file.name}`);
    },
    resume: () => {
      isPaused = false;
      console.log(`▶️  Resumed: ${file.name}`);
    },
    cancel: () => {
      isCancelled = true;
      isPaused = false;
      console.log(`🚫 Cancelled: ${file.name}`);
    }
  };

  activeUploads.set(uploadId, controls);
  return controls;
};

// ── Check if there are resumable uploads ──
export const getPendingUploads = () => {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return Object.entries(all).map(([uploadId, state]) => ({
      uploadId,
      ...state
    }));
  } catch (e) {
    return [];
  }
};

// ── Cancel all active uploads ──
export const cancelAllUploads = () => {
  activeUploads.forEach(controls => controls.cancel());
  activeUploads.clear();
};