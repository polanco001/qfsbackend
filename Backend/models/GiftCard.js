const mongoose = require('mongoose');

const giftCardSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cardType: {
    type: String,
    required: true
  },
  code: {
    type: String,
    trim: true
  },
  image: {
    type: String
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('GiftCard', giftCardSchema);