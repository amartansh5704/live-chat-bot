// fix-users.js
require('dotenv').config();
const mongoose = require('mongoose');

async function fixUsers() {
  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/livechatbot');

    const User = mongoose.models.User || mongoose.model('User', require('./models/User').schema || new mongoose.Schema({}));

    // Show ALL users before fix
    console.log('\n📋 CURRENT USERS IN DATABASE:');
    const allUsers = await User.find({}).lean();
    for (const u of allUsers) {
      console.log(`   👤 ${u.username} | email: ${u.email} | role: "${u.role || 'NOT SET'}"`);
    }

    // Fix users with missing/null role
    const result = await User.updateMany(
      { $or: [{ role: { $exists: false } }, { role: null }, { role: '' }] },
      { $set: { role: 'user' } }
    );

    console.log(`\n✅ FIXED ${result.modifiedCount} users — set role to "user"`);

    // Show after fix
    console.log('\n📋 USERS AFTER FIX:');
    const fixedUsers = await User.find({}).lean();
    for (const u of fixedUsers) {
      console.log(`   👤 ${u.username} | role: "${u.role}"`);
    }

    console.log('\n✅ Done. You can now restart the backend.');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fixUsers();