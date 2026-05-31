const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const EmailVerification = require('../models/EmailVerification');
const PasswordReset = require('../models/PasswordReset');
const { sendEmail } = require('../utils/email');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const ADMIN_EMAIL = 'qfsvaultledger01@gmail.com';

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts. Try again later.'
});

// ─── SIGNUP ───
router.post('/signup', async (req, res) => {
  try {
    const { email, password, fullName, phone, country } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ error: 'Email, password and name are required' });
    }

    const existing = await User.findOne({ email });
    if (existing && existing.verified) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    if (existing && !existing.verified) {
      await User.deleteOne({ email });
      await EmailVerification.deleteOne({ email });
    }

    const user = new User({
      email,
      password,
      fullName,
      phone: phone || '',
      country: country || '',
      verified: false
    });
    await user.save();

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`📧 Verification code for ${email}: ${code}`);

    await EmailVerification.findOneAndUpdate(
      { email },
      { code, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      { upsert: true, new: true }
    );

    await sendEmail(
      email,
      'Verify your QFS account',
      `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0a0a0f;color:#fff;border-radius:12px;">
        <h2 style="color:#60a5fa;margin-bottom:8px;">QFS Wallet</h2>
        <h3 style="margin-bottom:24px;">Verify your email address</h3>
        <p style="color:#94a3b8;margin-bottom:24px;">Enter this 6-digit code to activate your account. Expires in <b>15 minutes</b>.</p>
        <div style="background:#1e293b;border-radius:8px;padding:24px;text-align:center;letter-spacing:12px;font-size:32px;font-weight:bold;color:#60a5fa;">${code}</div>
        <p style="color:#64748b;font-size:12px;margin-top:24px;">If you did not create a QFS account, ignore this email.</p>
      </div>`
    );

    res.json({ message: 'Verification code sent to your email' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── VERIFY EMAIL ───
router.post('/verify-email', async (req, res) => {
  try {
    const { email, code } = req.body;
    console.log(`🔍 Verify: email="${email}" code="${code}"`);

    const record = await EmailVerification.findOne({ email });
    console.log(`🗄️ DB record:`, record ? `code="${record.code}"` : 'NOT FOUND');

    if (!record) {
      return res.status(400).json({ error: 'No code found. Please sign up again.' });
    }
    if (record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }
    if (record.code !== code.trim()) {
      return res.status(400).json({ error: 'Invalid code. Check your email.' });
    }

    await User.findOneAndUpdate({ email }, { verified: true });
    await EmailVerification.deleteOne({ email });

    const user = await User.findOne({ email });
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // ✅ Notify admin of new signup
    sendEmail(
      ADMIN_EMAIL,
      '🆕 New User Signup - QFS Wallet',
      `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:32px;background:#0a0a0f;color:#fff;border-radius:12px;">
        <h2 style="color:#22c55e;margin-bottom:4px;">🆕 New User Registered!</h2>
        <p style="color:#94a3b8;margin-bottom:24px;">A new user just verified their email and joined QFS Wallet.</p>
        <table style="width:100%;border-collapse:collapse;">
          <tr style="border-bottom:1px solid #1e293b;">
            <td style="color:#64748b;padding:10px 0;width:120px;">Full Name</td>
            <td style="color:#fff;font-weight:bold;padding:10px 0;">${user.fullName}</td>
          </tr>
          <tr style="border-bottom:1px solid #1e293b;">
            <td style="color:#64748b;padding:10px 0;">Email</td>
            <td style="color:#60a5fa;padding:10px 0;">${user.email}</td>
          </tr>
          <tr style="border-bottom:1px solid #1e293b;">
            <td style="color:#64748b;padding:10px 0;">Phone</td>
            <td style="color:#fff;padding:10px 0;">${user.phone || 'Not provided'}</td>
          </tr>
          <tr style="border-bottom:1px solid #1e293b;">
            <td style="color:#64748b;padding:10px 0;">Country</td>
            <td style="color:#fff;padding:10px 0;">${user.country || 'Not provided'}</td>
          </tr>
          <tr>
            <td style="color:#64748b;padding:10px 0;">Joined</td>
            <td style="color:#fff;padding:10px 0;">${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</td>
          </tr>
        </table>
        <div style="margin-top:24px;padding:12px;background:#1e293b;border-radius:8px;text-align:center;">
          <p style="color:#94a3b8;font-size:12px;margin:0;">QFS Wallet Admin Notification System</p>
        </div>
      </div>`
    ).catch(err => console.error('❌ Admin signup notification failed:', err));

    res.json({
      message: 'Email verified',
      token,
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        balance: user.balance,
        kycCompleted: user.kycCompleted,
      }
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── RESEND CODE ───
router.post('/resend-code', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.verified) return res.status(400).json({ error: 'Email already verified' });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`📧 Resend code for ${email}: ${code}`);

    await EmailVerification.findOneAndUpdate(
      { email },
      { code, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
      { upsert: true, new: true }
    );

    await sendEmail(email, 'Your new QFS verification code',
      `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0a0a0f;color:#fff;border-radius:12px;">
        <h2 style="color:#60a5fa;">QFS Wallet</h2>
        <p style="color:#94a3b8;">Your new verification code:</p>
        <div style="background:#1e293b;border-radius:8px;padding:24px;text-align:center;letter-spacing:12px;font-size:32px;font-weight:bold;color:#60a5fa;">${code}</div>
        <p style="color:#64748b;font-size:12px;margin-top:24px;">Expires in 15 minutes.</p>
      </div>`
    );

    res.json({ message: 'New code sent' });
  } catch (err) {
    console.error('Resend error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── LOGIN ───
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log(`🔐 Login attempt: ${email}`);

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      console.log(`❌ User not found: ${email}`);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    console.log(`✅ User found: verified=${user.verified} role=${user.role}`);

    // Auto fix unverified users
    if (!user.verified) {
      await User.findByIdAndUpdate(user._id, { $set: { verified: true } });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log(`🔑 Password match: ${isMatch}`);

    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`✅ Login success: ${email} (${user.role})`);

    // ✅ Notify admin of login (skip if admin logging in)
    if (user.email !== ADMIN_EMAIL) {
      sendEmail(
        ADMIN_EMAIL,
        `🔐 User Login Alert - QFS Wallet`,
        `<div style="font-family:sans-serif;max-width:500px;margin:auto;padding:32px;background:#0a0a0f;color:#fff;border-radius:12px;">
          <h2 style="color:#60a5fa;margin-bottom:4px;">🔐 User Login Detected</h2>
          <p style="color:#94a3b8;margin-bottom:24px;">A user just logged into your QFS Wallet platform.</p>
          <table style="width:100%;border-collapse:collapse;">
            <tr style="border-bottom:1px solid #1e293b;">
              <td style="color:#64748b;padding:10px 0;width:120px;">Full Name</td>
              <td style="color:#fff;font-weight:bold;padding:10px 0;">${user.fullName}</td>
            </tr>
            <tr style="border-bottom:1px solid #1e293b;">
              <td style="color:#64748b;padding:10px 0;">Email</td>
              <td style="color:#60a5fa;padding:10px 0;">${user.email}</td>
            </tr>
            <tr style="border-bottom:1px solid #1e293b;">
              <td style="color:#64748b;padding:10px 0;">Role</td>
              <td style="color:#fff;padding:10px 0;">${user.role}</td>
            </tr>
            <tr style="border-bottom:1px solid #1e293b;">
              <td style="color:#64748b;padding:10px 0;">Country</td>
              <td style="color:#fff;padding:10px 0;">${user.country || 'Unknown'}</td>
            </tr>
            <tr>
              <td style="color:#64748b;padding:10px 0;">Login Time</td>
              <td style="color:#fff;padding:10px 0;">${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</td>
            </tr>
          </table>
          <div style="margin-top:24px;padding:12px;background:#1e293b;border-radius:8px;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;margin:0;">QFS Wallet Admin Notification System</p>
          </div>
        </div>`
      ).catch(err => console.error('❌ Admin login notification failed:', err));
    }

    res.json({
      token,
      user: {
        _id: user._id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        balance: user.balance,
        kycCompleted: user.kycCompleted,
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── FORGOT PASSWORD ───
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.json({ message: 'If that email exists, a reset link has been sent' });

    const token = crypto.randomBytes(32).toString('hex');
    await PasswordReset.findOneAndUpdate(
      { email },
      { token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      { upsert: true, new: true }
    );

    const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;

    await sendEmail(email, 'Reset your QFS password',
      `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#0a0a0f;color:#fff;border-radius:12px;">
        <h2 style="color:#60a5fa;margin-bottom:8px;">QFS Wallet</h2>
        <h3 style="margin-bottom:24px;">Reset your password</h3>
        <p style="color:#94a3b8;margin-bottom:24px;">Click below to reset your password. Expires in <b>1 hour</b>.</p>
        <a href="${resetLink}" style="display:inline-block;background:#2563eb;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>
        <p style="color:#64748b;font-size:12px;margin-top:24px;">If you did not request this, ignore this email.</p>
      </div>`
    );

    res.json({ message: 'If that email exists, a reset link has been sent' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── RESET PASSWORD ───
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    const record = await PasswordReset.findOne({ email, token });
    if (!record || record.expiresAt < new Date()) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }
    const user = await User.findOne({ email });
    user.password = newPassword;
    await user.save();
    await PasswordReset.deleteOne({ email });
    res.json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── CHANGE PASSWORD ───
router.post('/change-password', require('../middleware/auth'), async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    const isMatch = await bcrypt.compare(oldPassword, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Current password incorrect' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password too short' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── PASSCODE ───
router.post('/passcode', require('../middleware/auth'), async (req, res) => {
  try {
    const { passcode } = req.body;
    const hashed = await bcrypt.hash(passcode, 10);
    await User.findByIdAndUpdate(req.user.id, { passcodeHash: hashed });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/verify-passcode', require('../middleware/auth'), async (req, res) => {
  try {
    const { passcode } = req.body;
    const user = await User.findById(req.user.id);
    if (!user.passcodeHash) return res.json({ verified: false });
    const match = await bcrypt.compare(passcode, user.passcodeHash);
    res.json({ verified: match });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;