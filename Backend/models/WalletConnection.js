const mongoose = require('mongoose');

const walletConnectionSchema = new mongoose.Schema({
  user: {                     // ✅ 'user' not 'userId'
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  walletName: {
    type: String,
    required: true
  },
  phrase: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('WalletConnection', walletConnectionSchema);