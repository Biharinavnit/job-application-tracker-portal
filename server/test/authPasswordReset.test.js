const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, beforeEach, test } = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const nodemailer = require('nodemailer');
const request = require('supertest');

process.env.JWT_SECRET = 'password-reset-integration-test-secret';
process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_PORT = '587';
process.env.SMTP_FROM = 'JobTrack Test <no-reply@example.test>';
process.env.SMTP_USER = 'test-user';
process.env.SMTP_PASS = 'test-password';
process.env.TRUST_PROXY_HOPS = '1';

const app = require('../app');
const User = require('../models/User');
const emailService = require('../services/emailService');
const realSendPasswordResetEmail = emailService.sendPasswordResetEmail;
const { classifySmtpError, getConfigurationStatus, getSafeSmtpErrorDetails } = emailService;
const { getTrustedProxyHops } = require('../config/trustProxy');

let mongoServer;
let resetToken;
const GENERIC_RESET_MESSAGE = 'If an account exists for that email, password reset instructions may be sent. If you do not receive an email, contact support.';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const createUser = () => User.create({
  name: 'Test User',
  email: 'reset@example.test',
  password: 'original-password',
});

before(async () => {
  mongoServer = await MongoMemoryServer.create({
    instance: { launchTimeout: 60_000 },
  });
  await mongoose.connect(mongoServer.getUri());
  emailService.sendPasswordResetEmail = async (_email, token) => {
    resetToken = token;
  };
});

beforeEach(async () => {
  resetToken = null;
  await User.deleteMany({});
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('unknown email gets a generic response and no email is sent', async () => {
  const response = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'unknown@example.test' });

  assert.equal(response.status, 200);
  assert.equal(response.body.message, GENERIC_RESET_MESSAGE);
  assert.equal(resetToken, null);
});

test('SMTP verification and message delivery are both awaited', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const originalSendPasswordResetEmail = emailService.sendPasswordResetEmail;
  const calls = [];
  let verified = false;

  nodemailer.createTransport = () => ({
    async verify() {
      calls.push('verify');
      await new Promise((resolve) => setTimeout(resolve, 5));
      verified = true;
    },
    async sendMail(message) {
      assert.equal(verified, true);
      assert.equal(message.from, process.env.SMTP_FROM);
      calls.push('send');
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { accepted: ['recipient@example.test'] };
    },
    close() {
      calls.push('close');
    },
  });

  try {
    emailService.sendPasswordResetEmail = realSendPasswordResetEmail;
    await emailService.sendPasswordResetEmail('recipient@example.test', 'd'.repeat(64));
    assert.deepEqual(calls, ['verify', 'send', 'close']);
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    emailService.sendPasswordResetEmail = originalSendPasswordResetEmail;
  }
});

test('SMTP verification failures preserve only sanitized diagnostics', async () => {
  const originalCreateTransport = nodemailer.createTransport;
  const originalSendPasswordResetEmail = emailService.sendPasswordResetEmail;
  const smtpSecretToken = 'f'.repeat(64);
  nodemailer.createTransport = () => ({
    async verify() {
      const error = new Error(
        `DNS lookup failed for ${process.env.SMTP_HOST} user ${process.env.SMTP_USER} ` +
        `recipient@example.test https://example.test/reset?token=${smtpSecretToken}`
      );
      error.code = 'ENOTFOUND';
      error.command = 'CONN';
      throw error;
    },
    async sendMail() {
      assert.fail('sendMail must not run if verify fails');
    },
    close() {},
  });

  try {
    emailService.sendPasswordResetEmail = realSendPasswordResetEmail;
    await assert.rejects(
      emailService.sendPasswordResetEmail('recipient@example.test', smtpSecretToken),
      (error) => {
        assert.equal(error.smtpPhase, 'verify');
        assert.equal(error.smtpDiagnostics.category, 'DNS_RESOLUTION');
        assert.equal(error.smtpDiagnostics.name, 'Error');
        assert.equal(error.smtpDiagnostics.code, 'ENOTFOUND');
        assert.equal(error.smtpDiagnostics.command, 'CONN');
        assert.doesNotMatch(
          JSON.stringify(error.smtpDiagnostics),
          /smtp\.test\.invalid|test-user|test-password|recipient@example\.test|https?:\/\/|f{64}/
        );
        return true;
      }
    );
  } finally {
    nodemailer.createTransport = originalCreateTransport;
    emailService.sendPasswordResetEmail = originalSendPasswordResetEmail;
  }
});

test('SMTP diagnostic details redact credentials, addresses, URLs, and reset tokens', () => {
  const secretToken = 'e'.repeat(64);
  const details = getSafeSmtpErrorDetails({
    code: 'EAUTH',
    responseCode: 535,
    response: `535 denied for ${process.env.SMTP_USER} recipient@example.test ${process.env.SMTP_PASS} https://example.test/reset?token=${secretToken}`,
  });

  assert.equal(details.code, 'EAUTH');
  assert.equal(details.responseCode, 535);
  assert.doesNotMatch(details.response, /test-user|test-password|recipient@example\.test|https?:\/\/|e{64}/);
  assert.match(details.response, /\[email redacted\]|\[redacted\]/);
  assert.match(details.response, /\[URL redacted\]/);
});

test('SMTP failures are categorized by DNS, timeout, TLS, and authentication cause', () => {
  assert.equal(classifySmtpError({ code: 'ENOTFOUND' }), 'DNS_RESOLUTION');
  assert.equal(classifySmtpError({ code: 'ETIMEDOUT' }), 'CONNECTION_TIMEOUT');
  assert.equal(classifySmtpError({ code: 'EPROTO', message: 'TLS handshake failed' }), 'TLS');
  assert.equal(classifySmtpError({ code: 'EAUTH', command: 'AUTH', responseCode: 535 }), 'AUTHENTICATION');
  assert.equal(classifySmtpError({ code: 'ECONNREFUSED' }), 'CONNECTION');
});

test('SMTP configuration validates implicit TLS and STARTTLS port conventions', () => {
  const base = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_FROM: 'JobTrack <sender@example.test>',
    SMTP_USER: 'user',
    SMTP_PASS: 'password',
  };

  assert.deepEqual(getConfigurationStatus({
    ...base,
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
  }), { configured: true, issues: [] });
  assert.deepEqual(getConfigurationStatus({
    ...base,
    SMTP_PORT: '587',
    SMTP_SECURE: 'false',
  }), { configured: true, issues: [] });
  assert.ok(getConfigurationStatus({
    ...base,
    SMTP_PORT: '465',
    SMTP_SECURE: 'false',
  }).issues.includes('SMTP_SECURE_MUST_BE_TRUE_FOR_PORT_465'));
  assert.ok(getConfigurationStatus({
    ...base,
    SMTP_PORT: '587',
    SMTP_SECURE: 'true',
  }).issues.includes('SMTP_SECURE_MUST_BE_FALSE_FOR_PORT_587'));
});

test('trusted proxy hop setting defaults locally and rejects ambiguous values', () => {
  assert.equal(getTrustedProxyHops(), 0);
  assert.equal(getTrustedProxyHops('1'), 1);
  assert.throws(() => getTrustedProxyHops('true'), /TRUST_PROXY_HOPS must be an integer/);
  assert.throws(() => getTrustedProxyHops('11'), /TRUST_PROXY_HOPS must be an integer/);
  assert.equal(app.get('trust proxy'), 1);
});

test('forwarded client IP reaches reset rate limiting without proxy validation errors', async () => {
  const responses = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    responses.push(await request(app)
      .post('/api/auth/forgot-password')
      .set('X-Forwarded-For', '198.51.100.77')
      .send({ email: 'unknown@example.test' }));
  }

  assert.deepEqual(responses.map((response) => response.status), [200, 200, 200, 200, 200, 429]);
  assert.match(responses[5].body.message, /Too many password reset requests/);
});

test('missing SMTP configuration is reported without looking up the email', async () => {
  const smtpSettings = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASS']
    .map((key) => [key, process.env[key]]);
  for (const [key] of smtpSettings) delete process.env[key];

  try {
    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'unknown@example.test' });
    assert.equal(response.status, 503);
    assert.match(response.body.message, /email is not configured/);
  } finally {
    for (const [key, value] of smtpSettings) process.env[key] = value;
  }
});

test('email delivery failure does not reveal whether the account exists or claim delivery', async () => {
  const user = await createUser();
  const sendEmail = emailService.sendPasswordResetEmail;
  emailService.sendPasswordResetEmail = async () => {
    throw new Error('SMTP test failure');
  };

  try {
    const response = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: user.email });
    assert.equal(response.status, 202);
    assert.equal(response.body.message, GENERIC_RESET_MESSAGE);
    const updatedUser = await User.findById(user._id)
      .select('+passwordResetTokenHash +passwordResetExpires');
    assert.equal(updatedUser.passwordResetTokenHash, undefined);
    assert.equal(updatedUser.passwordResetExpires, undefined);
  } finally {
    emailService.sendPasswordResetEmail = sendEmail;
  }
});

test('valid reset hashes the new password, consumes token, and invalidates existing JWTs', async () => {
  const user = await createUser();
  const oldSession = jwt.sign({ id: user._id, tokenVersion: 0 }, process.env.JWT_SECRET);

  const forgotResponse = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: user.email });
  assert.equal(forgotResponse.status, 200);
  assert.match(forgotResponse.body.message, /If an account exists/);
  assert.equal(typeof resetToken, 'string');

  const storedTokenUser = await User.findById(user._id)
    .select('+passwordResetTokenHash +passwordResetExpires');
  assert.equal(storedTokenUser.passwordResetTokenHash, hashToken(resetToken));
  assert.notEqual(storedTokenUser.passwordResetTokenHash, resetToken);
  assert.ok(storedTokenUser.passwordResetExpires > new Date());

  const resetResponse = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: resetToken, password: 'new-password' });
  assert.equal(resetResponse.status, 200);
  assert.match(resetResponse.body.message, /Please sign in/);

  const updatedUser = await User.findById(user._id)
    .select('+password +passwordResetTokenHash +passwordResetExpires +tokenVersion');
  assert.match(updatedUser.password, /^\$2[aby]\$/);
  assert.equal(await updatedUser.matchPassword('new-password'), true);
  assert.equal(await updatedUser.matchPassword('original-password'), false);
  assert.equal(updatedUser.passwordResetTokenHash, undefined);
  assert.equal(updatedUser.passwordResetExpires, undefined);
  assert.equal(updatedUser.tokenVersion, 1);

  const loginResponse = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email.toUpperCase(), password: 'new-password' });
  assert.equal(loginResponse.status, 200);
  assert.equal(jwt.decode(loginResponse.body.token).tokenVersion, 1);

  const reusedResponse = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: resetToken, password: 'another-password' });
  assert.equal(reusedResponse.status, 400);

  const oldSessionResponse = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${oldSession}`);
  assert.equal(oldSessionResponse.status, 401);
});

test('invalid reset token is rejected', async () => {
  const response = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: 'a'.repeat(64), password: 'new-password' });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /invalid or has expired/);
});

test('expired reset token is rejected', async () => {
  const user = await createUser();
  const expiredToken = crypto.randomBytes(32).toString('hex');
  user.passwordResetTokenHash = hashToken(expiredToken);
  user.passwordResetExpires = new Date(Date.now() - 1000);
  await user.save();

  const response = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: expiredToken, password: 'new-password' });

  assert.equal(response.status, 400);
  assert.match(response.body.message, /invalid or has expired/);
  const unchangedUser = await User.findById(user._id).select('+password');
  assert.equal(await unchangedUser.matchPassword('original-password'), true);
});

test('a reset token cannot be reused', async () => {
  const user = await createUser();
  user.passwordResetTokenHash = hashToken('b'.repeat(64));
  user.passwordResetExpires = new Date(Date.now() + 60_000);
  await user.save();

  const firstResponse = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: 'b'.repeat(64), password: 'new-password' });
  const secondResponse = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: 'b'.repeat(64), password: 'another-password' });

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 400);
});

test('concurrent attempts using one reset token can only reset the password once', async () => {
  const user = await createUser();
  const sharedToken = 'c'.repeat(64);
  user.passwordResetTokenHash = hashToken(sharedToken);
  user.passwordResetExpires = new Date(Date.now() + 60_000);
  await user.save();

  const responses = await Promise.all([
    request(app).post('/api/auth/reset-password').send({ token: sharedToken, password: 'first-password' }),
    request(app).post('/api/auth/reset-password').send({ token: sharedToken, password: 'second-password' }),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  const updatedUser = await User.findById(user._id).select('+password');
  const passwordMatches = await Promise.all([
    updatedUser.matchPassword('first-password'),
    updatedUser.matchPassword('second-password'),
  ]);
  assert.equal(passwordMatches.filter(Boolean).length, 1);
});
