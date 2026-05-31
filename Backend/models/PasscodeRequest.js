const mongoose = require('mongoose');

const PasscodeRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  action: { type: String, enum: ['set', 'change'], required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('PasscodeRequest', PasscodeRequestSchema);