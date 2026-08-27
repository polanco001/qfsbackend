const mongoose = require('mongoose');

const withdrawalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  method: {
    type: String,
    enum: ['crypto', 'bank', 'cashapp', 'paypal', 'applepay', 'zelle'],
    required: true,
  },
  // Common fields
  cryptoType: String,
  walletAddress: String,
  bankDetails: {
    accountName: String,
    accountNumber: String,
    routingNumber: String,
  },
  cashAppTag: String,
  paypalEmail: String,
  applePayEmail: String,
  zelleEmail: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'failed'], default: 'pending' },
  createdAt: { type: Date, default: Date.now },
  processedAt: Date,
});

module.exports = mongoose.model('Withdrawal', withdrawalSchema);