const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Initialize S3 client with credentials from .env
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const BUCKET = process.env.AWS_S3_BUCKET;

// Delete file from S3
const deleteFromS3 = async (s3Key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: s3Key
    });
    await s3Client.send(command);
    console.log(`🗑️  Deleted from S3: ${s3Key}`);
    return true;
  } catch (error) {
    console.error('S3 delete error:', error);
    return false;
  }
};

// Generate a signed URL for temporary access (expires in 1 hour)
// WHY: Files in S3 can be private. Signed URLs give time-limited access
const getSignedFileUrl = async (s3Key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: s3Key
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('Signed URL error:', error);
    return null;
  }
};

// Get file content from S3 (for re-parsing)
const getS3FileBuffer = async (s3Key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET,
      Key: s3Key
    });
    const response = await s3Client.send(command);
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) {
    console.error('S3 get error:', error);
    return null;
  }
};

module.exports = {
  s3Client,
  BUCKET,
  deleteFromS3,
  getSignedFileUrl,
  getS3FileBuffer
};