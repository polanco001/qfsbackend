const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const EmailVerification = require('../models/EmailVerification');
const PasswordReset = require('../models/PasswordReset');
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

    // ─── 📧 BEAUTIFUL SIGNUP EMAIL TEMPLATE ───
    const subject = 'Verify your QFS Wallet email';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify Your Email</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;margin:0 20px;">
          
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#0a1628,#1a3a6b);padding:32px 24px;text-align:center;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">QFS <span style="color:#60a5fa;">Wallet</span></h1>
              <p style="margin:6px 0 0 0;font-size:14px;color:#93b4e0;font-weight:400;">Secure • Decentralized • Trusted</p>
            </td>
          </tr>
          
          <!-- BODY -->
          <tr>
            <td style="padding:40px 32px;">
              <h2 style="margin:0 0 8px 0;font-size:22px;font-weight:600;color:#111827;">Verify your email address</h2>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4b5563;">Hello <strong style="color:#111827;">${fullName}</strong>,</p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4b5563;">Thanks for joining QFS Wallet! To complete your registration, please enter the verification code below:</p>
              
              <!-- CODE BOX -->
              <div style="background-color:#f0f7ff;border:2px dashed #3b82f6;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
                <p style="margin:0 0 6px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#3b82f6;">Your verification code</p>
                <p style="margin:0;font-family:'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:12px;color:#1e3a8a;">${code}</p>
              </div>
              
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">⏳ This code will expire in <strong>15 minutes</strong>.</p>
              <p style="margin:0 0 24px 0;font-size:13px;color:#6b7280;">🔒 If you didn't request this, please ignore this email.</p>
              
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;" />
              
              <p style="margin:0 0 4px 0;font-size:13px;color:#6b7280;">Need help? Reply to this email or contact us at <a href="mailto:qfsvaultledger01@gmail.com" style="color:#2563eb;text-decoration:none;">qfsvaultledger01@gmail.com</a></p>
              <p style="margin:0;font-size:12px;color:#9ca3af;">QFS Wallet • Your secure digital asset gateway</p>
            </td>
          </tr>
          
          <!-- FOOTER -->
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">&copy; ${new Date().getFullYear()} QFS Wallet. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
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

    // ─── 📧 BEAUTIFUL RESEND EMAIL TEMPLATE ───
    const subject = 'Resend: QFS Wallet verification code';
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your Verification Code</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f6fa;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background-color:#ffffff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;margin:0 20px;">
          
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#0a1628,#1a3a6b);padding:32px 24px;text-align:center;">
              <h1 style="margin:0;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">QFS <span style="color:#60a5fa;">Wallet</span></h1>
              <p style="margin:6px 0 0 0;font-size:14px;color:#93b4e0;font-weight:400;">Secure • Decentralized • Trusted</p>
            </td>
          </tr>
          
          <!-- BODY -->
          <tr>
            <td style="padding:40px 32px;">
              <h2 style="margin:0 0 8px 0;font-size:22px;font-weight:600;color:#111827;">New verification code</h2>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4b5563;">Hello <strong style="color:#111827;">${user.fullName}</strong>,</p>
              <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#4b5563;">Here is your new verification code for QFS Wallet:</p>
              
              <!-- CODE BOX -->
              <div style="background-color:#f0f7ff;border:2px dashed #3b82f6;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
                <p style="margin:0 0 6px 0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;color:#3b82f6;">Your verification code</p>
                <p style="margin:0;font-family:'Courier New',monospace;font-size:36px;font-weight:700;letter-spacing:12px;color:#1e3a8a;">${code}</p>
              </div>
              
              <p style="margin:0 0 6px 0;font-size:13px;color:#6b7280;">⏳ This code will expire in <strong>15 minutes</strong>.</p>
              <p style="margin:0 0 24px 0;font-size:13px;color:#6b7280;">🔒 If you didn't request this, please ignore this email.</p>
              
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;" />
              
              <p style="margin:0 0 4px 0;font-size:13px;color:#6b7280;">Need help? Reply to this email or contact us at <a href="mailto:qfsvaultledger01@gmail.com" style="color:#2563eb;text-decoration:none;">qfsvaultledger01@gmail.com</a></p>
              <p style="margin:0;font-size:12px;color:#9ca3af;">QFS Wallet • Your secure digital asset gateway</p>
            </td>
          </tr>
          
          <!-- FOOTER -->
          <tr>
            <td style="background-color:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">&copy; ${new Date().getFullYear()} QFS Wallet. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
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
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000);

    await PasswordReset.deleteMany({ email: user.email });

    await PasswordReset.create({
      email: user.email,
      token: resetToken,
      expiresAt
    });

    const frontendUrl = process.env.FRONTEND_URL || 'https://qfsworldvault.site';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

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

    const resetRecord = await PasswordReset.findOne({ token });
    if (!resetRecord) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (resetRecord.expiresAt < new Date()) {
      await PasswordReset.deleteOne({ token });
      return res.status(400).json({ error: 'Token has expired. Please request a new one.' });
    }

    if (resetRecord.email !== email) {
      return res.status(400).json({ error: 'Invalid token for this email' });
    }

    const user = await User.findOne({ email: resetRecord.email });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.password = newPassword;
    await user.save();

    await PasswordReset.deleteOne({ token });

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