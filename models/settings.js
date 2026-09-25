const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
  supportLink:  { type: String, default: '' },
  supportPhone: { type: String, default: '' },
  wallets: {
    BTC:  { type: String, default: '' },
    ETH:  { type: String, default: '' },
    XRP:  { type: String, default: '' },
    XLM:  { type: String, default: '' },
    SOL:  { type: String, default: '' },
    ADA:  { type: String, default: '' },
    USDT: { type: String, default: '' },
    RAVE: { type: String, default: '' },
  },
}, { timestamps: true });

module.exports = mongoose.model('Settings', SettingsSchema);