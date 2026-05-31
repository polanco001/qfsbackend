const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
const WalletConnection = require('../models/WalletConnection');
const Payment = require('../models/Payment');
const GiftCard = require('../models/GiftCard');
const KYCSubmission = require('../models/KYCSubmission');
const auth = require('../middleware/auth');
const Message = require('../models/Message');
const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ─── GET ALL USERS ───
router.get('/users', auth, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select('-password -passcodeHash');
    res.json(users);
  } catch (err) {
    console.error('GET /admin/users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── TOP‑UP (Add Balance) ───
router.post('/topup', auth, adminOnly, async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) {
      return res.status(400).json({ error: 'Missing userId or amount' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.balance = (user.balance || 0) + parseFloat(amount);
    await user.save();

    console.log(`✅ Top‑up: ${user.email} new balance = ${user.balance}`);
    res.json({ success: true, newBalance: user.balance });
  } catch (err) {
    console.error('Top‑up error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DEDUCT (Reduce Balance) ───
router.post('/deduct', auth, adminOnly, async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) {
      return res.status(400).json({ error: 'Missing userId or amount' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const deductAmount = parseFloat(amount);
    if (deductAmount > (user.balance || 0)) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    user.balance -= deductAmount;
    await user.save();

    console.log(`✅ Deduct: ${user.email} new balance = ${user.balance}`);
    res.json({ success: true, newBalance: user.balance });
  } catch (err) {
    console.error('Deduct error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── SEND NOTIFICATION ───
router.post('/notify', auth, adminOnly, async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) {
      return res.status(400).json({ error: 'Missing userId or message' });
    }
    const notification = new Notification({ userId, message });
    await notification.save();
    res.json({ success: true });
  } catch (err) {
    console.error('Notify error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── DASHBOARD DATA (payments, giftcards, KYC, wallets) ───
router.get('/dashboard-data', auth, adminOnly, async (req, res) => {
  try {
    const payments = await Payment.find()
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });
    const giftCards = await GiftCard.find()
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });
    const kycDocs = await KYCSubmission.find()
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });
    const walletConnections = await WalletConnection.find()
      .populate('user', 'fullName email')
      .sort({ createdAt: -1 });

    console.log(`📊 Dashboard: ${payments.length} payments, ${giftCards.length} giftcards, ${kycDocs.length} KYC, ${walletConnections.length} wallets`);
    res.json({ payments, giftCards, kycDocs, walletConnections });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── UPDATE STATUSES ───
router.patch('/payment/:id', auth, adminOnly, async (req, res) => {
  try {
    const updated = await Payment.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/giftcard/:id', auth, adminOnly, async (req, res) => {
  try {
    const updated = await GiftCard.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/kyc/:id', auth, adminOnly, async (req, res) => {
  try {
    const updated = await KYCSubmission.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ─── GET ALL MESSAGES (admin chat panel) ───
router.get('/messages/:targetId?', auth, async (req, res) => {
  try {
    const targetId = req.params.targetId;
    let query;

    if (req.user.role === 'admin') {
      // If admin, show messages for selected user or public messages
      query = targetId ? 
        { $or: [{ sender: targetId }, { receiver: targetId }] } : 
        { receiver: null };
    } else {
      // If user, show their own messages or public admin messages
      query = { $or: [{ sender: req.user.id }, { receiver: req.user.id }, { receiver: null }] };
    }

    const messages = await Message.find(query)
      .populate('sender', 'fullName email role')
      .sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
module.exports = router;