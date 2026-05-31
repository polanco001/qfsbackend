const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const User = require('./models/User');

async function listUsers() {
  await mongoose.connect(process.env.MONGO_URI);
  const users = await User.find().select('email role');
  console.log(users);
  await mongoose.disconnect();
}

listUsers();
