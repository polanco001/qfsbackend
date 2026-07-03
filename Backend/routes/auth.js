const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const EmailVerification = require('../models/EmailVerification');
const PasswordReset = require('../models/PasswordReset');
const { sendEmail } = require('../utils/email');
const rateLimit = require('express-rate-limit');
const auth = require('../middleware/auth');   // ✅ needed for protected passcode routes

const router = express.Router();

const ADMIN_EMAIL = 'qfsvaultledger01@gmail.com';

// safe email wrapper (prevents crash)
const safeEmail = async (fn) => {
  try {
    await fn();
  } catch (err) {
    console.log("Email failed:", err.message);
  }
};

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts. Try again later.'
});

// ================= SIGNUP =================
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName, phone, country } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await User.findOne({ email });

    if (existing && existing.verified) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    if (existing && !existing.verified) {
      await User.deleteOne({ email });
      await EmailVerification.deleteOne({ email });
    }

    const user = await User.create({
      email: email.trim().toLowerCase(),
      password,
      fullName: fullName.trim(),
      phone: phone || '',
      country: country || '',
      verified: false
    });

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await EmailVerification.findOneAndUpdate(
      { email },
      { code, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      { upsert: true }
    );

    // Fire-and-forget email (no await)
    safeEmail(() =>
      sendEmail(
        email,
        'Verify your QFS account',
        `<div style="font-family:sans-serif;color:#fff;">
          <h2>QFS Wallet</h2>
          <p>Your verification code:</p>
          <h1 style="letter-spacing:6px;">${code}</h1>
        </div>`
      )
    );

    // ✅ Return the code so the frontend can show it as backup
    return res.json({
      message: 'Verification code sent',
      email: email,
      code: code
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ================= VERIFY EMAIL =================
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body;

    const record = await EmailVerification.findOne({ email });

    if (!record) return res.status(400).json({ error: 'No code found' });

    if (record.expiresAt < new Date())
      return res.status(400).json({ error: 'Code expired' });

    if (record.code !== code)
      return res.status(400).json({ error: 'Invalid code' });

    const user = await User.findOneAndUpdate(
      { email },
      { verified: true },
      { new: true }
    );

    await EmailVerification.deleteOne({ email });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Notification to admin (fire-and-forget)
    safeEmail(() =>
      sendEmail(
        ADMIN_EMAIL,
        'New User Signup',
        `<p>${user.fullName} just signed up</p>`
      )
    );

    return res.json({ token, user });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ================= RESEND CODE =================
router.post('/resend-code', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();

    await EmailVerification.findOneAndUpdate(
      { email },
      { code, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      { upsert: true }
    );

    // Fire-and-forget email
    safeEmail(() =>
      sendEmail(
        email,
        'New verification code',
        `<h2>Your code: ${code}</h2>`
      )
    );

    return res.json({ message: 'Code sent' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ================= LOGIN =================
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);

    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ token, user });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ================= SET PASSCODE (create/update) =================
// Protected route — requires a valid JWT (auth middleware attaches req.user.id)
router.post('/passcode', auth, async (req, res) => {
  try {
    const { passcode } = req.body;

    if (!passcode || !/^\d{6}$/.test(passcode)) {
      return res.status(400).json({ error: 'Passcode must be exactly 6 digits' });
    }

    const salt = await bcrypt.genSalt(10);
    const passcodeHash = await bcrypt.hash(passcode, salt);

    await User.findByIdAndUpdate(req.user.id, { passcodeHash });

    return res.json({ success: true, message: 'Passcode saved' });

  } catch (err) {
    console.error('Set passcode error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ================= VERIFY PASSCODE =================
router.post('/verify-passcode', auth, async (req, res) => {
  try {
    const { passcode } = req.body;

    if (!passcode) {
      return res.status(400).json({ error: 'Passcode is required' });
    }

    const user = await User.findById(req.user.id);
    if (!user || !user.passcodeHash) {
      return res.status(400).json({ error: 'No passcode set for this account' });
    }

    const match = await bcrypt.compare(passcode, user.passcodeHash);

    return res.json({ verified: match });

  } catch (err) {
    console.error('Verify passcode error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
