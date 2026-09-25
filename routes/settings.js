const express = require('express');
const router = express.Router();
const Settings = require('../models/settings');
const { protect, isAdmin } = require('../middleware/auth');

// ─── Get settings (public – modals + user site read this) ──────────────
router.get('/', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) settings = await Settings.create({});
    res.json({
      supportLink:  settings.supportLink,
      supportPhone: settings.supportPhone,
      wallets:      settings.wallets,
    });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─── Update settings (admin only) ──────────────────────────────────────
router.put('/', protect, isAdmin, async (req, res) => {
  try {
    const { supportLink, supportPhone, wallets } = req.body;

    let settings = await Settings.findOne();
    if (!settings) settings = new Settings();

    if (typeof supportLink === 'string')  settings.supportLink  = supportLink.trim();
    if (typeof supportPhone === 'string') settings.supportPhone = supportPhone.trim();
    if (wallets && typeof wallets === 'object') {
      for (const key of Object.keys(wallets)) {
        settings.wallets[key] = String(wallets[key] || '').trim();
      }
    }

    await settings.save();

    res.json({
      success: true,
      settings: {
        supportLink:  settings.supportLink,
        supportPhone: settings.supportPhone,
        wallets:      settings.wallets,
      },
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;