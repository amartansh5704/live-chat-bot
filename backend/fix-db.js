require('dotenv').config();
const mongoose = require('mongoose');

// Use the same connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/livechatbot', {
  serverSelectionTimeoutMS: 5000
}).then(async () => {
  console.log('✅ Connected to MongoDB');

  // Define minimal User schema (just enough to query/update)
  const UserSchema = new mongoose.Schema({ username: String, email: String, role: String, password: String });
  // Only create if not exists
  const User = mongoose.models.User || mongoose.model('User', UserSchema);

  // Show all users
  const users = await User.find({});
  console.log('\n📋 ALL USERS BEFORE FIX:');
  users.forEach(u => console.log(`   👤 ${u.username || '?'} | email: ${u.email || '?'} | role: "${u.role || 'NOT SET'}"`));

  // Fix missing roles
  const result = await User.updateMany(
    { $or: [{ role: { $exists: false } }, { role: null }, { role: '' }] },
    { $set: { role: 'user' } }
  );

  console.log(`\n✅ UPDATED ${result.modifiedCount} users to role: "user"`);

  // Show after
  const fixed = await User.find({});
  console.log('\n📋 ALL USERS AFTER FIX:');
  fixed.forEach(u => console.log(`   👤 ${u.username || '?'} | role: "${u.role || 'STILL MISSING'}"`));

  process.exit(0);
}).catch(err => {
  console.error('❌ Failed:', err.message);
  process.exit(1);
});