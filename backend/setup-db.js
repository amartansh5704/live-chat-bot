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

async function setupDatabase() {
  const client = await pool.connect();

  try {
    console.log('🔄 Setting up PostgreSQL database...\n');

    // Step 1: Enable pgvector extension
    console.log('Step 1: Enabling pgvector extension...');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
    console.log('✅ pgvector extension enabled\n');

    // Step 2: Create table
    console.log('Step 2: Creating file_chunks table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS file_chunks (
        id SERIAL PRIMARY KEY,
        mongo_file_id VARCHAR(255) NOT NULL,
        file_name VARCHAR(500) NOT NULL,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding vector(384),
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Table created\n');

    // Step 3: Create indexes
    console.log('Step 3: Creating indexes...');
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_embedding
      ON file_chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);
    console.log('✅ Vector similarity index created');

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mongo_file_id
      ON file_chunks(mongo_file_id)
    `);
    console.log('✅ File ID index created\n');

    // Step 4: Verify
    console.log('Step 4: Verifying setup...');
    const check = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'file_chunks'
      ORDER BY ordinal_position
    `);

    console.log('\n📋 Table structure:');
    console.table(check.rows);

    // Step 5: Check pgvector version
    const version = await client.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );
    console.log(`\n🎯 pgvector version: ${version.rows[0].extversion}`);

    console.log('\n✅ SETUP COMPLETE - Ready to upload files!\n');
  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);

    if (error.message.includes('extension "vector"')) {
      console.error('\n💡 pgvector extension is not installed');
      console.error('   For Docker: Use pgvector/pgvector:pg16 image');
      console.error('   For native: Install pgvector separately');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

setupDatabase();