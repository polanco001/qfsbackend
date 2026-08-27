const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['buy', 'sell', 'swap', 'card', 'medbed', 'giftcard', 'topup', 'withdraw', 'stake', 'unstake'], 
    required: true 
  },
  amount: { type: Number, required: true },
  currency: { type: String },
  details: { type: String },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transaction', TransactionSchema);