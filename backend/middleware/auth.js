const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // ⭐ THE FIX: Strip any trailing commas, spaces, or junk characters
      // WHY: Tus-js-client concatenates headers and adds trailing comma
      // "eyJ...E4," → "eyJ...E4"
      token = token
        .trim()
        .replace(/,+$/, '')    // remove trailing commas
        .replace(/;+$/, '')    // remove trailing semicolons
        .replace(/\s+/g, ''); // remove any whitespace

      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = await User.findById(decoded.id).select('-password');

      if (!req.user) {
        return res.status(401).json({ message: 'User not found' });
      }

      return next();

    } catch (error) {
      console.error('Auth middleware error:', error.message);
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  return res.status(401).json({ message: 'Not authorized, no token provided' });
};

module.exports = { protect };