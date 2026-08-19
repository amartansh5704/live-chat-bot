// backend/services/tusService.js
require('dotenv').config();
const { Server: TusServer } = require('@tus/server');
const { S3Store } = require('@tus/s3-store');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const UploadedFile = require('../models/UploadedFile');
const { addFileProcessingJob } = require('./jobQueue');
const { getFileType } = require('../utils/fileParser');

// ── Auth inside tus ──
// WHY: tus creates its own req object, Express middleware
//      req.user never reaches tus hooks
//      We must verify JWT ourselves inside onUploadCreate
const authenticateFromTusRequest = async (req) => {
  try {
    // Get raw Authorization header value
    const authHeader = req.headers?.get
      ? req.headers.get('authorization')   // tus Headers object
      : req.headers?.authorization;         // Express req.headers

    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Extract token - handle duplicated "Bearer token, Bearer token"
    // WHY: tus-js-client duplicates headers when both
    //      'headers' option and onBeforeRequest both set Authorization
    let token = authHeader;

    // Remove "Bearer " prefix
    if (token.startsWith('Bearer ')) {
      token = token.substring(7);
    }

    // Handle duplicate: "token123, Bearer token456" → take first token
    if (token.includes(',')) {
      token = token.split(',')[0];
    }

    // Clean the token
    token = token.trim().replace(/,+$/, '').replace(/;+$/, '');

    console.log(`   🔑 Tus auth token: ${token.substring(0, 20)}... (len: ${token.length})`);

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from DB
    const user = await User.findById(decoded.id).select('-password');
    if (!user) throw new Error('User not found');
    if (user.role !== 'operator') throw new Error('Operator access only');

    console.log(`   ✅ Tus auth success: ${user.username}`);
    return user;

  } catch (error) {
    console.error('   ❌ Tus auth failed:', error.message);
    throw error;
  }
};

// ── Parse tus upload metadata ──
// WHY: tus sends metadata as base64 encoded key-value pairs
//      "filename abc123==,filetype xyz=="
const parseMetadata = (metadataHeader) => {
  if (!metadataHeader) return {};

  const metadata = {};
  try {
    // Handle both string and Headers object
    const raw = typeof metadataHeader === 'string'
      ? metadataHeader
      : metadataHeader;

    raw.split(',').forEach(pair => {
      const parts = pair.trim().split(' ');
      if (parts.length === 2) {
        const key = parts[0].trim();
        const value = Buffer.from(parts[1].trim(), 'base64').toString('utf8');
        metadata[key] = value;
      }
    });
  } catch (e) {
    console.error('Metadata parse error:', e.message);
  }
  return metadata;
};

const createTusServer = () => {
  const tusServer = new TusServer({
    path: '/api/upload/resumable',

    datastore: new S3Store({
      s3ClientConfig: {
        bucket: process.env.AWS_S3_BUCKET,
        region: process.env.AWS_REGION,
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
      }
    }),

    // ── Called when upload is CREATED ──
    onUploadCreate: async (req, res, upload) => {
      try {
        console.log(`\n📤 Tus upload create: ${upload.id}`);

        // ⭐ Auth inside tus hook directly
        const user = await authenticateFromTusRequest(req);

        // ⭐ Parse metadata from tus format
        // WHY: upload.metadata might be undefined in some tus versions
        //      Parse it ourselves from the header
        const rawMetadata = req.headers?.get
          ? req.headers.get('upload-metadata')
          : req.headers?.['upload-metadata'];

        const metadata = parseMetadata(rawMetadata);

        console.log(`   File: ${metadata.filename}`);
        console.log(`   Type: ${metadata.filetype}`);
        console.log(`   Size: ${(upload.size / 1024).toFixed(1)} KB`);
        console.log(`   User: ${user.username}`);

        const originalName = metadata.filename || 'unknown';
        const uploadId = metadata.uploadId || upload.id;
        const fileType = getFileType(originalName);

        // Create MongoDB record
        const fileRecord = await UploadedFile.create({
          uploadedBy: user._id,
          uploaderName: user.username,
          originalName,
          storedName: upload.id,
          s3Bucket: process.env.AWS_S3_BUCKET,
          s3Key: '',
          s3Url: '',
          fileType,
          mimeType: metadata.filetype || 'application/octet-stream',
          size: upload.size || 0,
          parseStatus: 'pending',
          embeddingStatus: 'pending',
          uploadStatus: 'uploading'
        });

        console.log(`   💾 MongoDB record: ${fileRecord._id}`);

        // Store in upload metadata for onUploadFinish
        // WHY: tus passes upload object between hooks
        upload.metadata = upload.metadata || {};
        upload.metadata.mongoFileId = fileRecord._id.toString();
        upload.metadata.userId = user._id.toString();
        upload.metadata.uploadId = uploadId;
        upload.metadata.filename = originalName;
        upload.metadata.filetype = metadata.filetype;

        return res;

      } catch (error) {
        console.error('onUploadCreate error:', error.message);
        throw { status_code: 401, body: error.message };
      }
    },

    // ── Called when ALL chunks received ──
    onUploadFinish: async (req, res, upload) => {
      try {
        console.log(`\n✅ Tus upload finish: ${upload.id}`);

        const mongoFileId = upload.metadata?.mongoFileId;
        const userId = upload.metadata?.userId;
        const uploadId = upload.metadata?.uploadId || upload.id;
        const originalName = upload.metadata?.filename || 'unknown';

        if (!mongoFileId || !userId) {
          throw new Error('Missing metadata: mongoFileId or userId');
        }

        // S3 key where tus stored the file
        const s3Key = upload.id;
        const s3Url = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

        // Update MongoDB
        await UploadedFile.findByIdAndUpdate(mongoFileId, {
          s3Key,
          s3Url,
          uploadStatus: 'complete',
          size: upload.size
        });

        console.log(`   💾 MongoDB updated: s3Key=${s3Key}`);

        // Queue processing job
        await addFileProcessingJob({
          mongoFileId,
          userId,
          uploadId,
          s3Key,
          originalName,
          fileSize: upload.size
        });

        console.log(`   📋 Job queued for: ${originalName}`);

        return res;

      } catch (error) {
        console.error('onUploadFinish error:', error.message);
        throw error;
      }
    }
  });

  return tusServer;
};

let tusServerInstance = null;

const getTusServer = () => {
  if (!tusServerInstance) {
    tusServerInstance = createTusServer();
  }
  return tusServerInstance;
};

module.exports = { getTusServer };