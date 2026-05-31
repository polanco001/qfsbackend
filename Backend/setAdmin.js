const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const User = require('./models/User');

async function setAdmin() {
  await mongoose.connect(process.env.MONGO_URI);
  const email = 'qfsvaultledger01@gmail.com';
  const result = await User.updateOne({ email }, { $set: { role: 'admin' } });
  console.log(result);
  await mongoose.disconnect();
}
setAdmin();