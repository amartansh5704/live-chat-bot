// backend/test-rag.js (temporary)
require('dotenv').config();
const { processUserMessage, shouldTriggerAI } = require('./services/ragService');
const connectDB = require('./config/db');

const test = async () => {
  await connectDB();

  const question = "What is the refund policy?";
  console.log(`Testing: "${question}"`);
  console.log(`Should trigger AI: ${shouldTriggerAI(question)}`);

  // Mock socket
  const mockSocket = {
    emit: (event, data) => {
      if (event === 'ai_message_chunk') {
        process.stdout.write(data.content); // Print tokens in real-time
      } else {
        console.log(`\n[${event}]`, JSON.stringify(data, null, 2));
      }
    }
  };

  const result = await processUserMessage(
    question,
    'YOUR_CONVERSATION_ID_HERE', // Get from MongoDB
    null,
    mockSocket
  );

  console.log('\n\nResult:', result);
  process.exit(0);
};

test();