const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const User = require('./models/User');

async function addBalance() {
  await mongoose.connect(process.env.MONGO_URI);
  const email = 'qfsvaultledger01@gmail.com';
  const amount = 1000;
  const result = await User.updateOne({ email }, { $inc: { balance: amount } });
  console.log(result);
  await mongoose.disconnect();
}

addBalance();