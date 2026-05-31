// node fix.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config();

async function fix() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db;

  // 1. Set ALL users to verified: true
  const r1 = await db.collection('users').updateMany({}, { $set: { verified: true } });
  console.log(`✅ Set verified:true for ${r1.modifiedCount} users`);

  // 2. Clear all stuck verification codes
  const r2 = await db.collection('emailverifications').deleteMany({});
  console.log(`🗑️  Cleared ${r2.deletedCount} verification codes`);

  // 3. Reset admin password to: Admin@12345
  const hashed = await bcrypt.hash('Admin@12345', 10);
  const r3 = await db.collection('users').updateOne(
    { email: 'qfsvaultledger01@gmail.com' },
    { $set: { password: hashed, verified: true, role: 'admin' } }
  );
  console.log(`🔑 Admin password reset: ${r3.modifiedCount ? 'SUCCESS' : 'admin not found'}`);

  // 4. Show all users
  const users = await db.collection('users')
    .find({}, { projection: { email: 1, role: 1, verified: 1, balance: 1 } })
    .toArray();
  console.log('\n👥 All users:');
  users.forEach(u => {
    console.log(`  📧 ${u.email} | role: ${u.role} | verified: ${u.verified} | balance: $${u.balance ?? 0}`);
  });

  console.log('\n✅ All done! Admin password is now: Admin@12345');
  console.log('✅ All users are verified and can log in.');
  await mongoose.disconnect();
}

fix().catch(console.error);