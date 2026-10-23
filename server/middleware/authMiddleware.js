const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authenticateToken = async (token, req, res, next) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id).select('-password +tokenVersion');
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }
    if ((decoded.tokenVersion ?? 0) !== (req.user.tokenVersion ?? 0)) {
      return res.status(401).json({ success: false, message: 'Not authorized — session expired' });
    }
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Not authorized — invalid token' });
  }
};

const protect = async (req, res, next) => {
  const authorization = req.headers.authorization;
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized — no token' });
  }
  return authenticateToken(token, req, res, next);
};

const protectPdfPreview = async (req, res, next) => {
  const authorization = req.headers.authorization;
  const bearerToken = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null;
  if (bearerToken) return authenticateToken(bearerToken, req, res, next);

  const cookieName = `jt_pdf_preview_${req.params.attachmentId}`;
  const cookie = (req.headers.cookie || '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`));
  const token = cookie?.slice(cookieName.length + 1);
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized — preview session required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (
      decoded.purpose !== 'pdf-preview' ||
      decoded.attachmentId !== req.params.attachmentId ||
      decoded.applicationId !== req.params.id
    ) {
      return res.status(401).json({ success: false, message: 'Not authorized — invalid preview session' });
    }
    return authenticateToken(token, req, res, next);
  } catch {
    return res.status(401).json({ success: false, message: 'Not authorized — invalid preview session' });
  }
};

const preventDemoWrites = (req, res, next) => {
  if (req.user.isDemo && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(403).json({ success: false, message: 'The demo account is read-only.' });
  }
  return next();
};

module.exports = { protect, protectPdfPreview, preventDemoWrites };
