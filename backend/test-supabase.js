require('dotenv').config();
const { Pool } = require('pg');

async function testSupabase() {
  console.log('🔄 Testing Supabase connection...\n');
  console.log('DATABASE_URL:', process.env.DATABASE_URL
    ? process.env.DATABASE_URL.substring(0, 40) + '...'
    : 'MISSING!');
  console.log('');

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000
  });

  try {
    // Test 1: Connect
    console.log('Test 1: Connecting to Supabase...');
    const time = await pool.query('SELECT NOW()');
    console.log('✅ Connected at:', time.rows[0].now);

    // Test 2: Check pgvector
    console.log('\nTest 2: Checking pgvector extension...');
    const ext = await pool.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );
    if (ext.rows.length > 0) {
      console.log('✅ pgvector version:', ext.rows[0].extversion);
    } else {
      console.log('❌ pgvector NOT enabled - run CREATE EXTENSION vector;');
      process.exit(1);
    }

    // Test 3: Check table
    console.log('\nTest 3: Checking file_chunks table...');
    const table = await pool.query(
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'file_chunks'"
    );
    if (parseInt(table.rows[0].count) > 0) {
      console.log('✅ file_chunks table exists');
    } else {
      console.log('❌ file_chunks table missing - run the CREATE TABLE SQL');
      process.exit(1);
    }

    // Test 4: Insert a test vector
    console.log('\nTest 4: Testing vector insertion...');
    const testVector = Array(384).fill(0).map(() => Math.random());
    const vectorStr = `[${testVector.join(',')}]`;

    await pool.query(
      `INSERT INTO file_chunks 
       (mongo_file_id, file_name, chunk_index, chunk_text, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)`,
      ['test_id_123', 'test.txt', 0, 'test chunk text', vectorStr]
    );
    console.log('✅ Test vector inserted');

    // Test 5: Search
    console.log('\nTest 5: Testing similarity search...');
    const search = await pool.query(
      `SELECT id, chunk_text, 1 - (embedding <=> $1::vector) AS similarity
       FROM file_chunks
       WHERE mongo_file_id = 'test_id_123'
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [vectorStr]
    );
    console.log('✅ Search works! Result:', search.rows[0]);

    // Cleanup
    await pool.query("DELETE FROM file_chunks WHERE mongo_file_id = 'test_id_123'");
    console.log('✅ Cleanup complete');

    // Get stats
    const stats = await pool.query('SELECT COUNT(*) FROM file_chunks');
    console.log('\n📊 Current chunks in database:', stats.rows[0].count);

    console.log('\n🎉 SUPABASE IS FULLY WORKING! Ready to upload files.\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ TEST FAILED:', error.message);

    if (error.message.includes('password authentication')) {
      console.error('\n💡 Fix: Wrong password in DATABASE_URL');
      console.error('   Check your Supabase dashboard for the correct password');
    } else if (error.message.includes('ETIMEDOUT') || error.message.includes('ENOTFOUND')) {
      console.error('\n💡 Fix: Wrong hostname in DATABASE_URL');
      console.error('   Get the correct connection string from Supabase');
    } else if (error.message.includes('does not exist')) {
      console.error('\n💡 Fix: Table or extension not created');
      console.error('   Run the CREATE TABLE SQL in Supabase SQL Editor');
    }

    process.exit(1);
  }
}

testSupabase();