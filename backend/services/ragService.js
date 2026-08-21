// backend/services/ragService.js
require('dotenv').config();
const { generateEmbedding } = require('./embeddingService');
const { searchHybrid } = require('./postgresService');
const { buildPrompt, streamResponse, isAIEnabled } = require('./llmService');
const Message = require('../models/Message');
const UploadedFile = require('../models/UploadedFile');

// Always inject top N chunks into the prompt (hybrid search already ranks them)
const MAX_CONTEXT_CHUNKS = parseInt(process.env.AI_MAX_CONTEXT_CHUNKS) || 6;

const getFileInventory = async () => {
  try {
    const files = await UploadedFile.find({ embeddingStatus: 'success' })
      .select('originalName fileType chunkCount uploadedAt uploaderName')
      .sort({ uploadedAt: -1 })
      .limit(30)
      .lean();

    if (!files || files.length === 0) return null;

    const inventory = files
      .map((f, i) => {
        const date = new Date(f.uploadedAt).toLocaleDateString();
        return `${i + 1}. "${f.originalName}" (${f.fileType}, ${f.chunkCount || 0} chunks, ${date})`;
      })
      .join('\n');

    return { count: files.length, list: inventory };
  } catch (error) {
    console.warn('   ⚠️ File inventory error:', error.message);
    return null;
  }
};

const processUserMessage = async function (
  userMessage,
  conversationId,
  io,
  userSocket
) {
  try {
    const content = userMessage.trim();
    if (content.length < 2) return { success: false, reason: 'Too short' };

    console.log(`\n🤖 [Hybrid RAG] "${content}"`);

    if (userSocket) {
      userSocket.emit('ai_typing', { conversationId, isTyping: true });
    }

    // 1. Live file inventory
    const fileInventory = await getFileInventory();
    if (fileInventory) {
      console.log(`   📁 Inventory: ${fileInventory.count} file(s)`);
    }

    // 2. ALWAYS run vector + keyword hybrid search
    let relevantChunks = [];
    try {
      const queryEmbedding = await generateEmbedding(content);
      if (queryEmbedding?.length) {
        // No aggressive threshold filter — take top ranked results
        relevantChunks = await searchHybrid(
          queryEmbedding,
          content,
          MAX_CONTEXT_CHUNKS
        );
        console.log(`   🔍 Top ${relevantChunks.length} chunk(s) for hybrid answer:`);
        relevantChunks.forEach((c, i) => {
          console.log(
            `      [${i + 1}] ${c.match_type || 'vector'} ${(c.similarity * 100).toFixed(0)}% | ${c.file_name}: "${(c.chunk_text || '').substring(0, 70)}..."`
          );
        });
      }
    } catch (err) {
      console.warn('   ⚠️ Search failed:', err.message);
    }

    // 3. Conversation history
    let conversationHistory = [];
    try {
      conversationHistory = await Message.find({ conversationId })
        .sort({ timestamp: -1 })
        .limit(8)
        .select('sender content timestamp isAI')
        .lean();
      conversationHistory.reverse();
    } catch (err) {
      console.warn('   ⚠️ History failed:', err.message);
    }

    // 4. Hybrid prompt = docs + model knowledge
    const messages = buildPrompt(
      content,
      relevantChunks,
      conversationHistory,
      fileInventory
    );

    // 5. Stream
    let fullText = '';
    let isFirstToken = true;

    for await (const chunk of streamResponse(messages)) {
      if (chunk.type === 'token') {
        if (isFirstToken) {
          if (userSocket) {
            userSocket.emit('ai_typing', {
              conversationId,
              isTyping: false
            });
          }
          isFirstToken = false;
        }
        fullText = chunk.fullText;
        if (userSocket) {
          userSocket.emit('ai_message_chunk', {
            conversationId,
            content: chunk.content,
            fullText: chunk.fullText
          });
        }
      } else if (chunk.type === 'complete') {
        fullText = chunk.fullText;
        if (fullText?.trim()) {
          const aiMessage = await Message.create({
            conversationId,
            sender: 'operator',
            senderName: process.env.AI_SYSTEM_NAME || 'Support Assistant',
            content: fullText.trim(),
            status: 'delivered',
            isAI: true,
            aiSources: relevantChunks.map((c) => ({
              fileName: c.file_name,
              similarity: Math.round((c.similarity || 0) * 100),
              chunkIndex: c.chunk_index
            }))
          });

          console.log(`   💾 Hybrid reply saved (${aiMessage._id})`);

          if (userSocket) {
            userSocket.emit('ai_message_complete', {
              conversationId,
              messageId: aiMessage._id.toString(),
              fullText: fullText.trim(),
              sources: relevantChunks.map((c) => ({
                fileName: c.file_name,
                similarity: Math.round((c.similarity || 0) * 100)
              }))
            });
          }
        }
      } else if (chunk.type === 'error') {
        if (userSocket) {
          userSocket.emit('ai_typing', { conversationId, isTyping: false });
          userSocket.emit('ai_message_error', {
            conversationId,
            error: chunk.error
          });
        }
      }
    }

    return { success: true, fullText };
  } catch (error) {
    console.error('❌ Hybrid RAG error:', error.message);
    if (userSocket) {
      userSocket.emit('ai_typing', { conversationId, isTyping: false });
    }
    return { success: false, error: error.message };
  }
};

const shouldTriggerAI = (messageContent) => {
  if (!isAIEnabled()) return false;
  const content = messageContent ? messageContent.trim().toLowerCase() : '';
  if (content.length < 2) return false;

  const humanKeywords = [
    'human',
    'real person',
    'talk to agent',
    'speak to operator'
  ];
  if (humanKeywords.some((kw) => content.includes(kw))) {
    console.log('   👤 Human requested — skip AI');
    return false;
  }
  return true;
};

module.exports = {
  processUserMessage,
  shouldTriggerAI
};