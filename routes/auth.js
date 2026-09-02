const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto'); // <-- ADD THIS FOR RANDOM TOKENS
const User = require('../models/User');
const EmailVerification = require('../models/EmailVerification');
const PasswordReset = require('../models/PasswordReset'); // <-- ADD THIS
const { sendEmail } = require('../utils/email');

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

// ─── FORGOT PASSWORD ──────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      // For security, don't reveal if email exists or not
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    // Generate a secure random token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour

    // Delete any existing reset requests for this email
    await PasswordReset.deleteMany({ email: user.email });

    // Save the new token
    await PasswordReset.create({
      email: user.email,
      token: resetToken,
      expiresAt
    });

    // Build the reset link (frontend URL)
    const frontendUrl = process.env.FRONTEND_URL || 'https://qfsworldvault.site';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

    // Send the email
    await sendEmail(
      user.email,
      'Reset your QFS Wallet password',
      `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #2563eb;">QFS Wallet</h2>
          <p>Hello ${user.fullName || 'User'},</p>
          <p>We received a request to reset your password. Click the link below to set a new password:</p>
          <p style="margin: 30px 0;">
            <a href="${resetLink}" style="background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; display: inline-block;">
              Reset Password
            </a>
          </p>
          <p>This link will expire in <strong>1 hour</strong>.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <hr style="border: 1px solid #e5e7eb; margin: 30px 0;" />
          <p style="color: #6b7280; font-size: 12px;">QFS Wallet – Secure digital wallet</p>
        </div>
      `
    );

    res.json({ message: 'If that email exists, a reset link has been sent.' });

  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ─── RESET PASSWORD ──────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Find the token in the database
    const resetRecord = await PasswordReset.findOne({ token });
    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    // Check if token is expired
    if (resetRecord.expiresAt < new Date()) {
      await PasswordReset.deleteOne({ token });
      return res.status(400).json({ error: 'Token has expired. Please request a new one.' });
    }

    // Verify the email matches
    if (resetRecord.email !== email) {
      return res.status(400).json({ error: 'Invalid token for this email' });
    }

    // Find the user
    const user = await User.findOne({ email: resetRecord.email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Update the password (this triggers the pre-save hook to hash it)
    user.password = newPassword;
    await user.save();

    // Delete the token so it can't be used again
    await PasswordReset.deleteOne({ token });

    // Send a confirmation email (optional, but nice)
    try {
      await sendEmail(
        user.email,
        'Your QFS Wallet password has been reset',
        `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">QFS Wallet</h2>
            <p>Hello ${user.fullName || 'User'},</p>
            <p>Your password has been successfully reset.</p>
            <p>If you didn't do this, please contact support immediately.</p>
            <hr style="border: 1px solid #e5e7eb; margin: 30px 0;" />
            <p style="color: #6b7280; font-size: 12px;">QFS Wallet – Secure digital wallet</p>
          </div>
        `
      );
    } catch (emailErr) {
      // Don't fail if confirmation email doesn't send
      console.log('Confirmation email skipped (optional)');
    }

    res.json({ message: 'Password reset successfully. You can now log in.' });

  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ─── Export the router (default) and the middleware as properties ──
module.exports = router;
module.exports.protect = protect;
module.exports.isAdmin = isAdmin;