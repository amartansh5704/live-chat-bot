const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false  // Required for Supabase
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

// Test connection on startup
pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err);
});

// Test PostgreSQL connection
const testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL ready at', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    console.error('   Make sure PostgreSQL is running and DATABASE_URL is correct');
    return false;
  }
};

// Save file chunks with embeddings to PostgreSQL
const saveFileChunks = async (mongoFileId, fileName, chunks) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const chunk of chunks) {
      // Convert embedding array to PostgreSQL vector format: '[0.1,0.2,...]'
      const vectorString = `[${chunk.embedding.join(',')}]`;

      await client.query(
        `INSERT INTO file_chunks 
         (mongo_file_id, file_name, chunk_index, chunk_text, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [
          mongoFileId.toString(),
          fileName,
          chunk.chunkIndex,
          chunk.chunkText,
          vectorString,
          JSON.stringify({ length: chunk.chunkText.length })
        ]
      );
    }

    const { sanitizeText } = require('./embeddingService');

const saveFileChunks = async (mongoFileId, fileName, chunks) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let insertedCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const cleanText = sanitizeText(chunk.chunkText);
      if (!cleanText || cleanText.length === 0) continue;

      const vectorString = `[${chunk.embedding.join(',')}]`;
      const cleanFileName = sanitizeText(fileName);

      await client.query(
        `INSERT INTO file_chunks 
         (mongo_file_id, file_name, chunk_index, chunk_text, embedding, metadata)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [
          mongoFileId.toString(),
          cleanFileName,
          chunk.chunkIndex,
          cleanText,
          vectorString,
          JSON.stringify({ length: cleanText.length })
        ]
      );

      insertedCount++;

      // ⭐ Yield every 20 inserts to keep API responsive
      if (i % 20 === 0 && i > 0) {
        await new Promise(resolve => setImmediate(resolve));
      }
    }

    await client.query('COMMIT');
    console.log(`   💾 Saved ${insertedCount} chunks to Supabase`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Save chunks error:', error);
    return false;
  } finally {
    client.release();
  }
};

    await client.query('COMMIT');
    console.log(`   💾 Saved ${chunks.length} chunks to PostgreSQL`);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Save chunks error:', error);
    return false;
  } finally {
    client.release();
  }
};

// Search similar chunks using cosine similarity
// WHY: Finds text chunks most semantically similar to the query
const searchSimilar = async (queryEmbedding, limit = 5) => {
  try {
    const vectorString = `[${queryEmbedding.join(',')}]`;

    // Cosine distance: lower = more similar
    // 1 - (embedding <=> $1) gives similarity score (higher = more similar)
    const result = await pool.query(
      `SELECT 
         id,
         mongo_file_id,
         file_name,
         chunk_index,
         chunk_text,
         1 - (embedding <=> $1::vector) AS similarity
       FROM file_chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorString, limit]
    );

    return result.rows;
  } catch (error) {
    console.error('Search error:', error);
    return [];
  }
};

// Delete all chunks for a specific file
const deleteFileChunks = async (mongoFileId) => {
  try {
    const result = await pool.query(
      'DELETE FROM file_chunks WHERE mongo_file_id = $1',
      [mongoFileId.toString()]
    );
    console.log(`   🗑️  Deleted ${result.rowCount} chunks from PostgreSQL`);
    return result.rowCount;
  } catch (error) {
    console.error('Delete chunks error:', error);
    return 0;
  }
};

// Get stats
const getStats = async () => {
  try {
    const totalChunks = await pool.query('SELECT COUNT(*) FROM file_chunks');
    const totalFiles = await pool.query(
      'SELECT COUNT(DISTINCT mongo_file_id) FROM file_chunks'
    );

    return {
      totalChunks: parseInt(totalChunks.rows[0].count),
      totalFiles: parseInt(totalFiles.rows[0].count)
    };
  } catch (error) {
    console.error('Stats error:', error);
    return { totalChunks: 0, totalFiles: 0 };
  }
};

module.exports = {
  pool,
  testConnection,
  saveFileChunks,
  searchSimilar,
  deleteFileChunks,
  getStats
};