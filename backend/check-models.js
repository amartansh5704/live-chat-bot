// backend/check-models.js
require('dotenv').config();
const Groq = require('groq-sdk');

async function listModels() {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY?.trim() });
    const models = await groq.models.list();
    console.log('\n✅ Available models on your Groq key:');
    models.data.forEach(m => console.log('  -', m.id));
  } catch (err) {
    console.error('\n❌ Error listing models:', err.message);
  }
}

listModels();