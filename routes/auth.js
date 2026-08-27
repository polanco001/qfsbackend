const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const EmailVerification = require('../models/EmailVerification');
const { sendEmail } = require('../utils/email'); // <-- changed to ../utils/email

// ─── Generate 6-digit code ────────────────────────────────────────────
const generateCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// ─── Middleware (also exported for other routes) ──────────────────────
const protect = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ─── Auth Routes ──────────────────────────────────────────────────────

// Register (with email verification)
router.post('/register', async (req, res) => {
  try {
    const { email, fullName, password, phone, country } = req.body;

    if (!email || !fullName || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'User already exists' });

    const user = new User({ email, fullName, password, phone, country, verified: false });
    await user.save();

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await EmailVerification.findOneAndUpdate(
      { email },
      { code, expiresAt },
      { upsert: true, new: true }
    );

    const subject = 'Verify your QFS Wallet email';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #eee;border-radius:10px">
        <h2 style="color:#0e4fa5">QFS Wallet Verification</h2>
        <p>Hello ${fullName},</p>
        <p>Your verification code is:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:5px;color:#0e4fa5">${code}</p>
        <p>This code expires in 15 minutes.</p>
      </div>
    `;

    try {
      await sendEmail(email, subject, html);
    } catch (emailErr) {
      console.error('Email send error (continuing):', emailErr);
    }

    res.status(201).json({ code });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// Verify Email
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) return res.status(400).json({ error: 'Email and code are required' });

    const verification = await EmailVerification.findOne({ email });
    if (!verification) return res.status(400).json({ error: 'No verification request found' });
    if (verification.expiresAt < new Date()) return res.status(400).json({ error: 'Code has expired' });
    if (verification.code !== code) return res.status(400).json({ error: 'Invalid code' });

    const user = await User.findOneAndUpdate({ email }, { verified: true }, { new: true });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await EmailVerification.deleteOne({ email });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        balance: user.balance,
        kycCompleted: user.kycCompleted,
        hasPasscode: !!user.passcodeHash,
      },
    });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Resend verification code
router.post('/resend-code', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await EmailVerification.findOneAndUpdate(
      { email },
      { code, expiresAt },
      { upsert: true, new: true }
    );

    const subject = 'Resend: QFS Wallet verification code';
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:20px;border:1px solid #eee;border-radius:10px">
        <h2 style="color:#0e4fa5">QFS Wallet Verification</h2>
        <p>Your new verification code is:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:5px;color:#0e4fa5">${code}</p>
        <p>This code expires in 15 minutes.</p>
      </div>
    `;

    try {
      await sendEmail(email, subject, html);
    } catch (emailErr) {
      console.error('Email send error (continuing):', emailErr);
    }

    res.json({ success: true, message: 'New code sent' });
  } catch (err) {
    console.error('Resend code error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.verified) {
      return res.status(401).json({ error: 'Email not verified' });
    }

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({
      token,
      user: {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        balance: user.balance,
        kycCompleted: user.kycCompleted,
        hasPasscode: !!user.passcodeHash,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Export the router (default) and the middleware as properties ──
module.exports = router;
module.exports.protect = protect;
module.exports.isAdmin = isAdmin;