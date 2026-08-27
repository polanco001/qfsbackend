const mongoose = require('mongoose');

const stakingSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  asset: { type: String, required: true },
  amount: { type: Number, required: true },
  startDate: { type: Date, default: Date.now },
  apy: { type: Number, default: 5 }, // Annual percentage yield (5%)
  stakingPeriod: { type: String, enum: ['30', '90', '180', '365'], default: '30' }, // days
  status: { type: String, enum: ['active', 'ended'], default: 'active' },
});

module.exports = mongoose.model('Staking', stakingSchema);