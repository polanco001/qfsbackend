const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Notification = require('../models/Notification');
const WalletConnection = require('../models/WalletConnection');
const Payment = require('../models/Payment');
const GiftCard = require('../models/GiftCard');
const KYCSubmission = require('../models/KYCSubmission');
const Transaction = require('../models/Transaction');
const { protect } = require('../middleware/auth');
const Message = require('../models/Message');
const { sendEmail } = require('../utils/email'); // ✅ import sendEmail

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

router.get('/users', protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find().select('-password -passcodeHash');
    res.json(users);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/topup', protect, adminOnly, async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing userId or amount' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.balance = (user.balance || 0) + parseFloat(amount);
    await user.save();
    await Transaction.create({ userId: user._id, type: 'topup', amount: parseFloat(amount), currency: 'USD', details: 'Admin top-up via panel' });
    res.json({ success: true, newBalance: user.balance });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/deduct', protect, adminOnly, async (req, res) => {
  try {
    const { userId, amount } = req.body;
    if (!userId || !amount) return res.status(400).json({ error: 'Missing userId or amount' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const deductAmount = parseFloat(amount);
    if (deductAmount > (user.balance || 0)) return res.status(400).json({ error: 'Insufficient balance' });
    user.balance -= deductAmount;
    await user.save();
    await Transaction.create({ userId: user._id, type: 'withdraw', amount: deductAmount, currency: 'USD', details: 'Admin deduction via panel' });
    res.json({ success: true, newBalance: user.balance });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/notify', protect, adminOnly, async (req, res) => {
  try {
    const { userId, message } = req.body;
    if (!userId || !message) return res.status(400).json({ error: 'Missing userId or message' });
    await Notification.create({ userId, message });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/dashboard-data', protect, adminOnly, async (req, res) => {
  try {
    const payments = await Payment.find().populate('user', 'fullName email').sort({ createdAt: -1 });
    const giftCards = await GiftCard.find().populate('user', 'fullName email').sort({ createdAt: -1 });
    const kycDocs = await KYCSubmission.find().populate('user', 'fullName email').select('+ssn ssnLast4 fullName email phoneNumber address city state postalCode country dateOfBirth driverLicenseFront driverLicenseBack proofOfResidence status createdAt').sort({ createdAt: -1 });
    const walletConnections = await WalletConnection.find().populate('user', 'fullName email').sort({ createdAt: -1 });
    res.json({ payments, giftCards, kycDocs, walletConnections });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.patch('/payment/:id', protect, adminOnly, async (req, res) => {
  try {
    const payment = await Payment.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    ).populate('user');

    if (req.body.status === 'completed' && payment) {
      await Transaction.create({
        userId: payment.user._id,
        type: 'topup',
        amount: payment.amount,
        currency: payment.method || 'USD',
        details: `Payment via ${payment.method} approved`
      });
      // ✅ Email notification
      await sendEmail(
        payment.user.email,
        'Payment Approved',
        `<p>Your payment of $${payment.amount.toFixed(2)} has been approved.</p>`
      );
    }

    res.json(payment);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/giftcard/:id', protect, adminOnly, async (req, res) => {
  try {
    const updated = await GiftCard.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/kyc/:id', protect, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    const kyc = await KYCSubmission.findById(req.params.id).populate('user');
    if (!kyc) return res.status(404).json({ error: 'KYC submission not found' });
    kyc.status = status;
    kyc.reviewedAt = new Date();
    await kyc.save();

    if (status === 'approved') {
      await User.findByIdAndUpdate(kyc.user._id, { kycCompleted: true });
      // ✅ Email notification
      await sendEmail(
        kyc.user.email,
        'KYC Approved',
        `<p>Your KYC verification has been approved. You now have full access to all features.</p>`
      );
    }

    res.json(kyc);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/messages/:targetId?', protect, async (req, res) => {
  try {
    const targetId = req.params.targetId;
    let query;
    if (req.user.role === 'admin') query = targetId ? { $or: [{ sender: targetId }, { receiver: targetId }] } : { receiver: null };
    else query = { $or: [{ sender: req.user.id }, { receiver: req.user.id }, { receiver: null }] };
    const messages = await Message.find(query).populate('sender', 'fullName email role').sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.post('/reset-password', protect, adminOnly, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: 'Missing userId or newPassword' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password reset successfully' });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.put('/chat-read', protect, adminOnly, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { lastChatReadAt: new Date() });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

router.get('/unread-count', protect, adminOnly, async (req, res) => {
  try {
    const admin = await User.findById(req.user.id).select('lastChatReadAt');
    const lastRead = admin.lastChatReadAt || new Date(0);
    const count = await Message.countDocuments({ receiver: null, sender: { $ne: req.user.id }, createdAt: { $gt: lastRead } });
    res.json({ unreadCount: count });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;