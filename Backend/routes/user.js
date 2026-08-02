const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;      // ← new
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Notification = require('../models/Notification');
const Payment = require('../models/Payment');
const GiftCard = require('../models/GiftCard');
const KYCSubmission = require('../models/KYCSubmission');
const WalletConnection = require('../models/WalletConnection');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const router = express.Router();

// ─── Cloudinary config ─────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Multer with memory storage (files never hit disk) ─────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },   // 20 MB
});

// Helper: upload a single buffer to Cloudinary, return the secure URL
const uploadToCloudinary = (buffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
};

// ─── GET CURRENT USER ───
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password -passcodeHash');
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ─── UPDATE PROFILE (fullName) ─────────────────────────────────────
router.patch('/profile', auth, async (req, res) => {
  try {
    const { fullName } = req.body;

    if (!fullName || !fullName.trim()) {
      return res.status(400).json({ error: 'Full name is required.' });
    }
    if (fullName.trim().length > 100) {
      return res.status(400).json({ error: 'Full name is too long.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { fullName: fullName.trim() } },
      { new: true }
    ).select('-password -passcodeHash');

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(user);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Server error' });
  }
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

// ─── KYC SUBMISSION (3 files) ─────────────────────────────────────
router.post('/kyc/submit', auth, upload.fields([
  { name: 'dlFront', maxCount: 1 },
  { name: 'dlBack', maxCount: 1 },
  { name: 'proofDoc', maxCount: 1 }
]), async (req, res) => {
  try {
    const files = req.files || {};
    const dlFront = files['dlFront']?.[0];
    const dlBack  = files['dlBack']?.[0];
    const proofDoc = files['proofDoc']?.[0];

    if (!dlFront || !dlBack || !proofDoc) {
      return res.status(400).json({ error: 'Please upload all three documents (dlFront, dlBack, proofDoc).' });
    }

    // Upload all three to Cloudinary
    const [frontUrl, backUrl, proofUrl] = await Promise.all([
      uploadToCloudinary(dlFront.buffer, 'qfs-kyc'),
      uploadToCloudinary(dlBack.buffer, 'qfs-kyc'),
      uploadToCloudinary(proofDoc.buffer, 'qfs-kyc'),
    ]);

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
      driverLicenseFront: frontUrl,
      driverLicenseBack: backUrl,
      proofOfResidence: proofUrl,
      status: 'pending'
    });

    await kyc.save();
    await User.findByIdAndUpdate(req.user.id, { kycCompleted: false });
    res.status(201).json({ success: true, msg: 'KYC submitted for review.' });
  } catch (err) {
    console.error('KYC upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GIFT CARD SUBMISSION ──────────────────────────────────────────
router.post('/giftcard/submit', auth, upload.single('image'), async (req, res) => {
  try {
    const { cardType, code } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Image is required.' });

    const imageUrl = await uploadToCloudinary(req.file.buffer, 'qfs-giftcards');

    const giftCard = new GiftCard({
      user: req.user.id,
      cardType: cardType || 'Unknown',
      code: code?.trim() || '',
      image: imageUrl,
      status: 'pending'
    });
    await giftCard.save();
    res.status(201).json({ success: true, msg: 'Gift card submitted.' });
  } catch (err) {
    console.error('Gift card upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── PAYMENT SUBMISSION ────────────────────────────────────────────
router.post('/payment/submit', auth, upload.single('screenshot'), async (req, res) => {
  try {
    const { method, amount } = req.body;
    if (!req.file) return res.status(400).json({ error: 'Please upload a screenshot' });

    const screenshotUrl = await uploadToCloudinary(req.file.buffer, 'qfs-payments');

    const payment = new Payment({
      user: req.user.id,
      method: method || 'Manual Deposit',
      amount: parseFloat(amount) || 0,
      screenshot: screenshotUrl,
      status: 'pending'
    });
    await payment.save();
    res.status(201).json({ success: true, msg: 'Payment submitted.' });
  } catch (err) {
    console.error('Payment upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── WALLET CONNECT (unchanged) ────────────────────────────────────
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

// ─── TRANSACTIONS & BALANCE ────────────────────────────────────────
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

// ─── GET MESSAGES (unchanged) ──────────────────────────────────────
router.get('/messages', auth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [
        { sender: req.user.id },
        { receiver: req.user.id },
       
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
