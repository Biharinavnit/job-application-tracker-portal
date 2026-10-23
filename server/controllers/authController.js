// controllers/authController.js — Register & Login logic

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const emailService = require('../services/emailService');

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;
const GENERIC_RESET_MESSAGE = 'If an account exists for that email, password reset instructions may be sent. If you do not receive an email, contact support.';

const publicUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  isDemo: user.isDemo,
});

// ── Helper: Generate JWT ──────────────────────────────────────
const generateToken = (id, tokenVersion = 0) =>
  jwt.sign({ id, tokenVersion }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

const hashResetToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

// ── @POST /api/auth/register ──────────────────────────────────
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string' ||
      !name.trim() || !email.trim() || !password) {
      return res.status(400).json({ success: false, message: 'Please provide name, email, and password' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (name.trim().length < 2 || name.trim().length > 80 || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid name and email address.' });
    }

    const existingUser = await User.findOne({ email: normalizedEmail }).collation({ locale: 'en', strength: 2 });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }

    const user = await User.create({ name, email: normalizedEmail, password });

    res.status(201).json({
      success: true,
      token: generateToken(user._id, user.tokenVersion),
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email already registered' });
    }
    res.status(500).json({ success: false, message: 'Unable to register your account. Please try again later.' });
  }
};

// ── @POST /api/auth/login ─────────────────────────────────────
const login = async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password } = req.body;

    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email }).select('+password +tokenVersion');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    res.json({
      success: true,
      token: generateToken(user._id, user.tokenVersion),
      user: publicUser(user),
    });
  } catch {
    res.status(500).json({ success: false, message: 'Unable to sign in. Please try again later.' });
  }
};

// ── @POST /api/auth/demo ─────────────────────────────────────
const loginDemo = async (req, res) => {
  const email = process.env.DEMO_USER_EMAIL?.trim().toLowerCase();
  if (!email) {
    return res.status(503).json({ success: false, message: 'The demo account is not configured.' });
  }

  try {
    const user = await User.findOne({ email, isDemo: true }).select('+tokenVersion');
    if (!user) {
      return res.status(503).json({ success: false, message: 'The demo account is not available.' });
    }

    return res.json({
      success: true,
      token: generateToken(user._id, user.tokenVersion),
      user: publicUser(user),
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to start the demo session. Please try again later.' });
  }
};

// ── @POST /api/auth/forgot-password ───────────────────────────
const forgotPassword = async (req, res) => {
  const smtpConfiguration = emailService.getConfigurationStatus();
  if (!smtpConfiguration.configured) {
    console.error('Password reset SMTP configuration is incomplete.', {
      category: 'MISSING_CONFIGURATION',
      missingOrInvalid: smtpConfiguration.issues,
    });
    return res.status(503).json({
      success: false,
      message: 'Password reset email is not configured. Please contact the administrator.',
    });
  }

  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
  }

  try {
    const user = await User.findOne({ email, isDemo: { $ne: true } });
    if (!user) {
      return res.json({ success: true, message: GENERIC_RESET_MESSAGE });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashResetToken(resetToken);
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

    user.passwordResetTokenHash = tokenHash;
    user.passwordResetExpires = expiresAt;
    await user.save();

    try {
      await emailService.sendPasswordResetEmail(email, resetToken);
    } catch (error) {
      try {
        await User.updateOne(
          { _id: user._id, passwordResetTokenHash: tokenHash },
          { $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 } }
        );
      } catch {
        console.error('Password reset token cleanup failed after email delivery failure.');
      }
      const details = error.smtpDiagnostics || emailService.getSafeSmtpErrorDetails(error);
      console.error('Password reset email delivery failed.', {
        phase: error.smtpPhase || 'unknown',
        category: details.category,
        name: details.name,
        code: details.code,
        command: details.command,
        ...(details.responseCode ? { responseCode: details.responseCode } : {}),
        message: details.message,
        response: details.response,
      });
      return res.status(202).json({ success: true, message: GENERIC_RESET_MESSAGE });
    }

    return res.json({ success: true, message: GENERIC_RESET_MESSAGE });
  } catch {
    return res.status(500).json({
      success: false,
      message: 'Unable to process the password reset request. Please try again later.',
    });
  }
};

// ── @POST /api/auth/reset-password ────────────────────────────
const resetPassword = async (req, res) => {
  const { token, password } = req.body;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) {
    return res.status(400).json({ success: false, message: 'This password reset link is invalid or has expired.' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
  }

  try {
    const tokenHash = hashResetToken(token);
    const eligibleUser = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: { $gt: new Date() },
      isDemo: { $ne: true },
    }).select('_id');
    if (!eligibleUser) {
      return res.status(400).json({ success: false, message: 'This password reset link is invalid or has expired.' });
    }

    const passwordHash = await User.hashPassword(password);
    const user = await User.findOneAndUpdate(
      {
        _id: eligibleUser._id,
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: { $gt: new Date() },
        isDemo: { $ne: true },
      },
      {
        $set: { password: passwordHash },
        $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 },
        $inc: { tokenVersion: 1 },
      },
      { new: true, runValidators: true }
    );

    if (!user) {
      return res.status(400).json({ success: false, message: 'This password reset link is invalid or has expired.' });
    }

    return res.json({ success: true, message: 'Your password has been reset. Please sign in with your new password.' });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to reset your password. Please try again later.' });
  }
};

// ── @GET /api/auth/me ─────────────────────────────────────────
const getMe = async (req, res) => {
  res.json({ success: true, user: publicUser(req.user) });
};

module.exports = { register, login, loginDemo, forgotPassword, resetPassword, getMe, publicUser };