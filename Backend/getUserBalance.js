const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();
const User = require('./models/User');

async function getBalance() {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne({ email: 'qfsvaultledger01@gmail.com' }).select('email balance');
  console.log(user);
  await mongoose.disconnect();
}

getBalance();