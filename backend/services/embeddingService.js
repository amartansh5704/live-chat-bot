const { pipeline } = require('@xenova/transformers');

let embedder = null;
let embedderLoading = null;

const getEmbedder = async () => {
  if (embedder) return embedder;
  if (embedderLoading) return embedderLoading;

  console.log('🧠 Loading embedding model (first time ~30s)...');
  embedderLoading = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  embedder = await embedderLoading;
  console.log('✅ Embedding model ready');
  return embedder;
};

// ── Sanitize text: remove invalid characters that break UTF-8 or PostgreSQL ──
const sanitizeText = (text) => {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\u0000/g, '')                                        // null bytes
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // control chars
    .replace(/\uFFFD/g, '')                                        // replacement char
    .replace(/[\u200B-\u200D\uFEFF]/g, '')                         // zero-width chars
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, (match) => {
      return match.length === 2 ? match : '';                      // broken surrogates
    })
    .replace(/[ \t]+/g, ' ')                                       // normalize spaces
    .replace(/\n{3,}/g, '\n\n')                                    // reduce newlines
    .trim();
};

// ── Generate embedding for a text chunk ──
const generateEmbedding = async (text) => {
  try {
    const cleanText = sanitizeText(text);
    if (!cleanText || cleanText.length === 0) return null;

    // Truncate very long chunks to avoid model errors
    const truncated = cleanText.length > 1500 ? cleanText.substring(0, 1500) : cleanText;

    const model = await getEmbedder();
    const output = await model(truncated, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (error) {
    console.error('Embedding generation error:', error.message);
    return null;
  }
};

// ══════════════════════════════════════════════════════════════
//  SMART CHUNKING - split by paragraphs, respect boundaries
// ══════════════════════════════════════════════════════════════
// WHY: Blindly chunking every N words breaks sentences mid-way
//      This version keeps related content together
const smartChunkText = async (text, maxChunkSize = 1500, minChunkSize = 300) => {
  if (!text) return [];

  const cleanText = sanitizeText(text);
  if (!cleanText) return [];

  // Split by paragraphs (double newlines) or sentence breaks
  const sections = cleanText
    .split(/\n\n+|(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const chunks = [];
  let currentChunk = '';
  let processedCount = 0;

  for (const section of sections) {
    // Section fits in current chunk - append it
    if ((currentChunk + ' ' + section).length <= maxChunkSize) {
      currentChunk = currentChunk ? currentChunk + '\n\n' + section : section;
    }
    // Section too big for current chunk
    else {
      // Save current chunk if it has enough content
      if (currentChunk.length >= minChunkSize) {
        chunks.push(currentChunk.trim());
        currentChunk = section;
      }
      // Section itself is huge - split it forcibly
      else if (section.length > maxChunkSize) {
        if (currentChunk) {
          currentChunk = currentChunk + '\n\n' + section.substring(0, maxChunkSize - currentChunk.length);
          chunks.push(currentChunk.trim());
        } else {
          chunks.push(section.substring(0, maxChunkSize));
        }
        currentChunk = section.substring(maxChunkSize);
      }
      // Small current + normal section - just append
      else {
        currentChunk = currentChunk ? currentChunk + '\n\n' + section : section;
      }
    }

    // ⭐ Yield control every 50 sections to keep API responsive
    processedCount++;
    if (processedCount % 50 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length >= minChunkSize / 2) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
};

// ── Fallback simple chunking (if smart chunking produces nothing) ──
const simpleChunkText = (text, chunkSize = 500, overlap = 50) => {
  if (!text) return [];
  const cleanText = sanitizeText(text);
  if (!cleanText) return [];

  const chunks = [];
  const words = cleanText.split(/\s+/).filter(w => w.length > 0);

  for (let i = 0; i < words.length; i += (chunkSize - overlap)) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    if (chunk.trim().length > 0) {
      chunks.push(chunk);
    }
  }
  return chunks;
};

// ══════════════════════════════════════════════════════════════
//  PROCESS DOCUMENT - main function called by upload route
// ══════════════════════════════════════════════════════════════
// ⭐ Processes text into chunks + embeddings with yields to keep API responsive
const processDocument = async (fullText) => {
  if (!fullText || fullText.trim().length === 0) {
    console.log('   ⚠️  No content to process');
    return [];
  }

  const cleanText = sanitizeText(fullText);
  if (!cleanText || cleanText.length < 20) {
    console.log('   ⚠️  Text too short after sanitization');
    return [];
  }

  console.log(`   📝 Processing ${cleanText.length} characters`);

  // Try smart chunking first
  let chunks = await smartChunkText(cleanText);

  // Fallback to simple chunking if smart failed
  if (chunks.length === 0) {
    console.log('   ⚠️  Smart chunking produced no chunks, trying simple...');
    chunks = simpleChunkText(cleanText);
  }

  if (chunks.length === 0) {
    console.log('   ❌ Could not create any chunks');
    return [];
  }

  console.log(`   📊 Created ${chunks.length} chunks`);

  const results = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk || chunk.trim().length < 10) {
      failCount++;
      continue;
    }

    try {
      const embedding = await generateEmbedding(chunk);
      if (embedding && embedding.length > 0) {
        results.push({
          chunkIndex: i,
          chunkText: chunk,
          embedding: embedding
        });
        successCount++;
      } else {
        failCount++;
      }
    } catch (err) {
      failCount++;
      console.error(`   ❌ Chunk ${i} failed:`, err.message);
    }

    // ⭐ CRITICAL: Yield control every 3 chunks
    // WHY: Allows API requests (like /operator/users) to be processed
    //      Without this, backend is blocked during long uploads
    if (i % 3 === 0 && i > 0) {
      await new Promise(resolve => setImmediate(resolve));
    }

    // Progress log every 10 chunks
    if ((i + 1) % 10 === 0) {
      console.log(`   📊 Progress: ${i + 1}/${chunks.length} chunks processed`);
    }
  }

  console.log(`   ✅ Generated ${successCount} embeddings (${failCount} failed/skipped)`);
  return results;
};

module.exports = {
  generateEmbedding,
  processDocument,
  smartChunkText,
  simpleChunkText,
  sanitizeText
};