// backend/services/llmService.js
require('dotenv').config();
const Groq = require('groq-sdk');

let groqClient = null;

const getClient = () => {
  if (groqClient) return groqClient;
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  groqClient = new Groq({ apiKey });
  return groqClient;
};

const isAIEnabled = () => {
  const envVal = process.env.AI_ENABLED
    ? String(process.env.AI_ENABLED).trim().toLowerCase()
    : '';
  const isEnabled = envVal === 'true' || envVal === '1' || envVal === 'yes';
  const hasKey =
    !!process.env.GROQ_API_KEY &&
    process.env.GROQ_API_KEY.trim().startsWith('gsk_');
  return isEnabled && hasKey;
};

// ══════════════════════════════════════════════════════════
//  HYBRID PROMPT
//  1. Always use retrieved document chunks when available
//  2. Combine with model knowledge for complete answers
//  3. Prefer documents when they conflict with general knowledge
// ══════════════════════════════════════════════════════════
const buildPrompt = (
  userQuestion,
  contextChunks = [],
  conversationHistory = [],
  fileInventory = null
) => {
  const modelName = process.env.AI_SYSTEM_NAME || 'Support Assistant';

  // File inventory
  let inventorySection = '';
  if (fileInventory && fileInventory.count > 0) {
    inventorySection = `
KNOWLEDGE BASE FILES (${fileInventory.count} uploaded):
${fileInventory.list}

You can search and use these files. When the user asks about files or topics that may be in them, use the document excerpts below.`;
  } else {
    inventorySection = `
KNOWLEDGE BASE FILES: None uploaded yet.`;
  }

  // Document excerpts
  let contextSection = '';
  if (contextChunks.length > 0) {
    const passages = contextChunks
      .map((chunk, i) => {
        const source = chunk.file_name || 'document';
        const sim = chunk.similarity
          ? ` | relevance ${Math.round(chunk.similarity * 100)}%`
          : '';
        return `【PASSAGE ${i + 1} | source: ${source}${sim}】
${chunk.chunk_text}`;
      })
      .join('\n\n');

    contextSection = `
RETRIEVED DOCUMENT EXCERPTS (from vector + keyword search):
${passages}`;
  } else {
    contextSection = `
RETRIEVED DOCUMENT EXCERPTS: None matched this query closely.`;
  }

  // History
  const historyText =
    conversationHistory.length > 0
      ? conversationHistory
          .slice(-8)
          .map((msg) => {
            const role = msg.sender === 'user' ? 'User' : 'Assistant';
            return `${role}: ${msg.content}`;
          })
          .join('\n')
      : '';

  const systemPrompt = `You are ${modelName}, an intelligent hybrid support assistant.

YOUR ANSWERING STRATEGY (HYBRID RAG):

1. DOCUMENT-FIRST WHEN RELEVANT
   - If the retrieved document excerpts below contain facts that answer the question, USE them as the primary source.
   - Cite the source file name when you use document content.
   - Prefer document facts over your general knowledge when they conflict.

2. COMBINE WITH YOUR KNOWLEDGE
   - You MAY use your general knowledge to:
     • Explain concepts (e.g. what RAG means, technical definitions)
     • Clarify jargon found in documents
     • Give helpful structure, examples, or context
     • Answer greetings and general questions
   - When combining: lead with document facts if any, then add helpful explanation from your knowledge.
   - Clearly separate when helpful: e.g. "From your documents: ..." vs "In general: ..."

3. WHEN DOCUMENTS ARE EMPTY OR WEAK
   - Still answer helpfully using your knowledge.
   - If the user asked something that might be in their files but excerpts are empty, say you checked the knowledge base and didn't find a strong match, then still give a useful general answer if possible.
   - Do NOT refuse with only "I don't have enough information" unless the question is company-specific and truly has no document support AND you cannot help generally.

4. NEVER HALLUCINATE DOCUMENT CONTENT
   - Do not invent policies, personal details, or facts and claim they came from the files.
   - Only attribute something to a file if it appears in the excerpts.

5. STYLE
   - Be clear, concise, and professional.
   - Use bullet points for multi-part answers.
   - Keep most answers under 250 words unless detail is needed.
${inventorySection}
${contextSection}`;

  const messages = [{ role: 'system', content: systemPrompt }];

  if (historyText) {
    messages.push({
      role: 'system',
      content: `Recent conversation:\n${historyText}`
    });
  }

  messages.push({ role: 'user', content: userQuestion });
  return messages;
};

const streamResponse = async function* (messages) {
  try {
    const client = getClient();
    const model = process.env.GROQ_MODEL?.trim() || 'openai/gpt-oss-120b';

    console.log(`   🤖 Calling Groq (${model})...`);

    const stream = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.35, // balanced: grounded + natural hybrid answers
      max_tokens: 1200,
      top_p: 0.9,
      stream: true
    });

    let fullText = '';
    let tokenCount = 0;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullText += content;
        tokenCount++;
        yield { type: 'token', content, fullText, tokenCount };
      }
      if (chunk.choices[0]?.finish_reason === 'stop') break;
    }

    yield {
      type: 'complete',
      content: '',
      fullText: fullText.trim(),
      tokenCount
    };
    console.log(`   ✅ Groq: ${tokenCount} tokens, ${fullText.length} chars`);
  } catch (error) {
    console.error('   ❌ Groq error:', error.message);
    yield { type: 'error', content: '', fullText: '', error: error.message };
  }
};

module.exports = {
  getClient,
  isAIEnabled,
  buildPrompt,
  streamResponse
};