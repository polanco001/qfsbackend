const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
const WalletConnection = require('../models/WalletConnection');
const Payment = require('../models/Payment');
const GiftCard = require('../models/GiftCard');
const KYCSubmission = require('../models/KYCSubmission');
const { protect } = require('../middleware/auth');   // ✅ fixed: destructure protect
const Message = require('../models/Message');

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ─── GET ALL USERS ───
router.get('/users', protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select('-password -passcodeHash');
    res.json(users);
  } catch (err) {
    console.error('GET /admin/users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── TOP‑UP (Add Balance) ───
router.post('/topup', protect, adminOnly, async (req, res) => {
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
router.post('/deduct', protect, adminOnly, async (req, res) => {
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
router.post('/notify', protect, adminOnly, async (req, res) => {
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
router.get('/dashboard-data', protect, adminOnly, async (req, res) => {
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
router.patch('/payment/:id', protect, adminOnly, async (req, res) => {
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

router.patch('/giftcard/:id', protect, adminOnly, async (req, res) => {
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

router.patch('/kyc/:id', protect, adminOnly, async (req, res) => {
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
router.get('/messages/:targetId?', protect, async (req, res) => {
  try {
    const targetId = req.params.targetId;
    let query;

    if (req.user.role === 'admin') {
      query = targetId ?
        { $or: [{ sender: targetId }, { receiver: targetId }] } :
        { receiver: null };
    } else {
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

// ─── ADMIN RESET PASSWORD (email‑free fallback) ───
router.post('/reset-password', protect, adminOnly, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) {
      return res.status(400).json({ error: 'Missing userId or newPassword' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.password = newPassword; // Hashed automatically by the User model pre‑save hook
    await user.save();

    console.log(`✅ Admin reset password for ${user.email}`);
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── MARK CHAT AS READ ────────────────────────────────────────────────
router.put('/chat-read', protect, adminOnly, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, {
      lastChatReadAt: new Date()
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── GET UNREAD CHAT COUNT ────────────────────────────────────────────
router.get('/unread-count', protect, adminOnly, async (req, res) => {
  try {
    const admin = await User.findById(req.user.id).select('lastChatReadAt');
    const lastRead = admin.lastChatReadAt || new Date(0);

    const count = await Message.countDocuments({
      receiver: null,                     // public messages
      sender: { $ne: req.user.id },       // not sent by me
      createdAt: { $gt: lastRead }        // newer than last time I read
    });

    res.json({ unreadCount: count });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
