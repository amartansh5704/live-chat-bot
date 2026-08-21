// backend/services/postgresService.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err);
});

const testConnection = async () => {
  try {
    const result = await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL ready at', result.rows[0].now);
    return true;
  } catch (error) {
    console.error('❌ PostgreSQL connection failed:', error.message);
    return false;
  }
};

// ── Save file chunks with embeddings ──
const saveFileChunks = async (mongoFileId, fileName, chunks) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let insertedCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk.chunkText || chunk.chunkText.trim().length === 0) continue;

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
      insertedCount++;

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

// ══════════════════════════════════════════════════════════
//  HYBRID SEARCH: Vector Similarity + Keyword Match + Fallback
// ══════════════════════════════════════════════════════════
const searchHybrid = async (queryEmbedding, queryText, limit = 5) => {
  try {
    const vectorString = `[${queryEmbedding.join(',')}]`;

    // 1. Vector Search (Cosine Similarity)
    const vectorResult = await pool.query(
      `SELECT 
         id,
         mongo_file_id,
         file_name,
         chunk_index,
         chunk_text,
         1 - (embedding <=> $1::vector) AS similarity,
         'vector' AS match_type
       FROM file_chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vectorString, limit]
    );

    let chunks = vectorResult.rows || [];

    // 2. Keyword Search (Extract meaningful words from query)
    const keywords = (queryText || '')
      .replace(/[^a-zA-Z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 3 && !['what', 'when', 'where', 'which', 'about', 'this', 'that', 'have', 'does', 'tell'].includes(w.toLowerCase()));

    if (keywords.length > 0) {
      const keywordClauses = keywords.map((_, idx) => `chunk_text ILIKE $${idx + 1}`).join(' OR ');
      const keywordParams = keywords.map(k => `%${k}%`);

      const keywordResult = await pool.query(
        `SELECT 
           id,
           mongo_file_id,
           file_name,
           chunk_index,
           chunk_text,
           0.65 AS similarity,
           'keyword' AS match_type
         FROM file_chunks
         WHERE ${keywordClauses}
         LIMIT 3`,
        keywordParams
      );

      // Merge results avoiding duplicate chunks by ID
      const existingIds = new Set(chunks.map(c => c.id));
      (keywordResult.rows || []).forEach(kr => {
        if (!existingIds.has(kr.id)) {
          chunks.push(kr);
          existingIds.add(kr.id);
        }
      });
    }

    // 3. Document Summary Fallback:
    // If the query asks for broad info or vector match is weak, include first chunk of each file
    const isBroadQuery = /(what|tell|summarize|summary|content|information|all|about|files?|document)/i.test(queryText);
    if (isBroadQuery && chunks.length < limit) {
      const fallbackResult = await pool.query(
        `SELECT DISTINCT ON (mongo_file_id)
           id,
           mongo_file_id,
           file_name,
           chunk_index,
           chunk_text,
           0.50 AS similarity,
           'overview' AS match_type
         FROM file_chunks
         ORDER BY mongo_file_id, chunk_index ASC
         LIMIT 3`
      );

      const existingIds = new Set(chunks.map(c => c.id));
      (fallbackResult.rows || []).forEach(fr => {
        if (!existingIds.has(fr.id)) {
          chunks.push(fr);
          existingIds.add(fr.id);
        }
      });
    }

    return chunks.slice(0, limit);

  } catch (error) {
    console.error('Hybrid search error:', error.message);
    return [];
  }
};

const deleteFileChunks = async (mongoFileId) => {
  try {
    const result = await pool.query(
      'DELETE FROM file_chunks WHERE mongo_file_id = $1',
      [mongoFileId.toString()]
    );
    console.log(`   🗑️ Deleted ${result.rowCount} chunks from PostgreSQL`);
    return result.rowCount;
  } catch (error) {
    console.error('Delete chunks error:', error);
    return 0;
  }
};

const getStats = async () => {
  try {
    const totalChunks = await pool.query('SELECT COUNT(*) FROM file_chunks');
    const totalFiles = await pool.query('SELECT COUNT(DISTINCT mongo_file_id) FROM file_chunks');

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
  searchSimilar: searchHybrid,
  searchHybrid,
  deleteFileChunks,
  getStats
};