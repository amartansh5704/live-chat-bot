// backend/debug-rag-search.js
require('dotenv').config();
const { pool } = require('./services/postgresService');
const { generateEmbedding } = require('./embeddingService');

async function debug() {
  try {
    console.log('🔍 Checking Supabase `file_chunks` table...');

    // 1. Total chunk count
    const countRes = await pool.query('SELECT COUNT(*) FROM file_chunks');
    const total = parseInt(countRes.rows[0].count);
    console.log(`📊 Total chunks in database: ${total}`);

    if (total === 0) {
      console.log('❌ No chunks found in Supabase! Make sure a file has been uploaded and processed.');
      process.exit(0);
    }

    // 2. Sample chunks
    const sample = await pool.query('SELECT id, file_name, chunk_index, chunk_text FROM file_chunks LIMIT 3');
    console.log('\n📄 Sample stored chunks:');
    sample.rows.forEach(r => {
      console.log(`   - [${r.file_name} chunk #${r.chunk_index}]: "${r.chunk_text.substring(0, 80)}..."`);
    });

    // 3. Test query vector search
    const testQuery = "What is this document about?";
    console.log(`\n🧠 Testing vector search with query: "${testQuery}"`);
    const embedding = await generateEmbedding(testQuery);

    const vectorString = `[${embedding.join(',')}]`;
    const searchRes = await pool.query(
      `SELECT 
         file_name,
         chunk_index,
         chunk_text,
         (embedding <=> $1::vector) AS distance,
         1 - (embedding <=> $1::vector) AS similarity
       FROM file_chunks
       ORDER BY embedding <=> $1::vector
       LIMIT 5`,
      [vectorString]
    );

    console.log('\n🎯 Raw Vector Search Results (Top 5):');
    searchRes.rows.forEach((r, i) => {
      console.log(`   [${i + 1}] Similarity: ${(r.similarity * 100).toFixed(1)}% (Distance: ${parseFloat(r.distance).toFixed(4)}) | File: ${r.file_name}`);
      console.log(`       "${r.chunk_text.substring(0, 90)}..."`);
    });

    process.exit(0);
  } catch (err) {
    console.error('❌ Debug error:', err);
    process.exit(1);
  }
}

debug();