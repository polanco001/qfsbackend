// backend/resetPassword.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
dotenv.config();
const User = require('./models/User');

async function reset() {
  await mongoose.connect(process.env.MONGO_URI);
  const email = 'qfsvaultledger01@gmail.com';
  const newPassword = '123456789';
  const hashed = await bcrypt.hash(newPassword, 10);
  await User.updateOne({ email }, { $set: { password: hashed } });
  console.log('Password updated');
  await mongoose.disconnect();
}
reset();