// backend/test-groq.js
require('dotenv').config();
const { isAIEnabled, streamResponse, buildPrompt } = require('./services/llmService');

async function test() {
  console.log('GROQ_API_KEY present:', !!process.env.GROQ_API_KEY);
  console.log('AI_ENABLED value:', process.env.AI_ENABLED);
  console.log('isAIEnabled():', isAIEnabled());

  const prompt = buildPrompt('Hi! Can you introduce yourself briefly?');
  console.log('\nPrompt prepared. Calling Groq...');

  for await (const chunk of streamResponse(prompt)) {
    if (chunk.type === 'token') {
      process.stdout.write(chunk.content);
    } else if (chunk.type === 'complete') {
      console.log('\n\n✅ Done! Groq connection is working perfectly.');
    } else if (chunk.type === 'error') {
      console.error('\n\n❌ Failed:', chunk.error);
    }
  }
}

test();