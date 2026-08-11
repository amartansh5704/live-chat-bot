const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    console.log('🔄 Attempting MongoDB connection...');
    console.log('🔍 URI:', process.env.MONGODB_URI);

    if (!process.env.MONGODB_URI) {
      throw new Error(
        'MONGODB_URI is undefined! Check your .env file exists in backend folder'
      );
    }

    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // These options prevent buffering timeout issues
      serverSelectionTimeoutMS: 5000,  // Fail fast if MongoDB not reachable
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      maxPoolSize: 10
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    console.log(`📂 Database: ${conn.connection.name}`);

    // Listen for connection events
    mongoose.connection.on('disconnected', () => {
      console.log('⚠️  MongoDB disconnected!');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected!');
    });

    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB error:', err.message);
    });

  } catch (error) {
    console.error('❌ MongoDB Connection Failed!');
    console.error('   Error:', error.message);
    console.error('\n   Possible fixes:');
    console.error('   1. Start MongoDB: Start-Service MongoDB');
    console.error('   2. Run: mongod --dbpath C:\\data\\db');
    console.error('   3. Check .env file has correct MONGODB_URI');
    process.exit(1);
  }
};

module.exports = connectDB;