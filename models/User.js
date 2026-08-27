const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  fullName: { type: String, required: true },
  password: { type: String, required: true },
  passcodeHash: { type: String },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  balance: { type: Number, default: 0 },
  assets: {
    BTC: { type: Number, default: 0 },
    ETH: { type: Number, default: 0 },
    SOL: { type: Number, default: 0 },
    USDT: { type: Number, default: 0 },
    ADA: { type: Number, default: 0 },
    XRP: { type: Number, default: 0 },
    DOGE: { type: Number, default: 0 },
    BNB: { type: Number, default: 0 },
    LTC: { type: Number, default: 0 },
    DOT: { type: Number, default: 0 },
    TRX: { type: Number, default: 0 },
    LINK: { type: Number, default: 0 },
    MATIC: { type: Number, default: 0 },
    SHIB: { type: Number, default: 0 },
  },
  // NEW: Wallet backup (seed phrase)
  walletBackup: { type: String, default: '' }, // Store encrypted or plain for now
  kycCompleted: { type: Boolean, default: false },
  verified: { type: Boolean, default: false },
  avatar: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  lastChatReadAt: { type: Date, default: Date.now }
});

UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

UserSchema.methods.comparePassword = async function(entered) {
  return bcrypt.compare(entered, this.password);
};

module.exports = mongoose.model('User', UserSchema);