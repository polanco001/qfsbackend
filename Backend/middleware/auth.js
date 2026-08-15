const jwt = require('jsonwebtoken');
const User = require('../models/User'); // <-- ADD THIS (to fetch user from DB)

// 1. Check if user is logged in (this is your existing code, just improved)
exports.protect = async (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // IMPORTANT: Fetch the user from the database to get their latest role
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ error: 'User not found' });
    
    req.user = user; // Now req.user has the full user object (including role)
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// 2. NEW: Check if the logged-in user is an Admin
exports.isAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
