const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { after, before, beforeEach, test } = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

process.env.JWT_SECRET = 'jobtrack-demo-integration-test-secret';
process.env.DEMO_USER_EMAIL = 'demo@example.test';
process.env.DEMO_USER_PASSWORD = 'demo-seed-test-password';

const app = require('../app');
const User = require('../models/User');
const JobApplication = require('../models/JobApplication');
const ApplicationAttachment = require('../models/ApplicationAttachment');
const emailService = require('../services/emailService');
const { seedDemoData } = require('../config/seedData');

let mongoServer;

const createUser = (email, isDemo = false) => User.create({
  name: isDemo ? 'JobTrack Demo' : 'Regular User',
  email,
  password: 'valid-test-password',
  isDemo,
});

const tokenFor = (user) => jwt.sign(
  { id: user._id, tokenVersion: 0 },
  process.env.JWT_SECRET,
  { expiresIn: '1h' }
);

before(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  process.env.DEMO_USER_EMAIL = 'demo@example.test';
  process.env.DEMO_USER_PASSWORD = 'demo-seed-test-password';
  await Promise.all([
    User.deleteMany({}),
    JobApplication.deleteMany({}),
    ApplicationAttachment.deleteMany({}),
  ]);
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test('demo login returns the normal JWT response and authenticates protected routes', async () => {
  const demo = await createUser(process.env.DEMO_USER_EMAIL, true);
  const response = await request(app).post('/api/auth/demo').send({});

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.user.id, demo._id.toString());
  assert.equal(response.body.user.isDemo, true);
  assert.equal(response.body.user.email, demo.email);
  assert.equal(typeof response.body.token, 'string');
  assert.equal(Object.hasOwn(response.body, 'password'), false);
  assert.equal(Object.hasOwn(response.body.user, 'password'), false);
  assert.equal(jwt.verify(response.body.token, process.env.JWT_SECRET).id, demo._id.toString());

  const currentUser = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${response.body.token}`);
  assert.equal(currentUser.status, 200);
  assert.equal(currentUser.body.user.isDemo, true);
});

test('demo login reports missing configuration and an unprovisioned account clearly', async () => {
  const email = process.env.DEMO_USER_EMAIL;
  delete process.env.DEMO_USER_EMAIL;
  const unconfigured = await request(app).post('/api/auth/demo').send({});
  assert.equal(unconfigured.status, 503);
  assert.match(unconfigured.body.message, /not configured/);

  process.env.DEMO_USER_EMAIL = email;
  const unavailable = await request(app).post('/api/auth/demo').send({});
  assert.equal(unavailable.status, 503);
  assert.match(unavailable.body.message, /not available/);

  await createUser(email, false);
  const regularAccountIsNotDemo = await request(app).post('/api/auth/demo').send({});
  assert.equal(regularAccountIsNotDemo.status, 503);
});

test('normal login keeps its response and rejects invalid or missing credentials', async () => {
  const user = await createUser('regular@example.test');
  const valid = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: 'valid-test-password' });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.success, true);
  assert.equal(valid.body.user.isDemo, false);
  assert.equal(jwt.verify(valid.body.token, process.env.JWT_SECRET).id, user._id.toString());

  const invalid = await request(app)
    .post('/api/auth/login')
    .send({ email: user.email, password: 'incorrect-password' });
  assert.equal(invalid.status, 401);
  assert.equal(invalid.body.message, 'Invalid credentials');

  const missing = await request(app).post('/api/auth/login').send({ email: user.email });
  assert.equal(missing.status, 400);
});

test('demo sessions see only their own applications and cannot change applications or documents', async () => {
  const demo = await createUser(process.env.DEMO_USER_EMAIL, true);
  const regular = await createUser('regular@example.test');
  const demoApplication = await JobApplication.create({
    user: demo._id,
    company: 'Sample Demo Company',
    role: 'Engineer',
    stage: 'Applied',
  });
  const regularApplication = await JobApplication.create({
    user: regular._id,
    company: 'Private Company',
    role: 'Designer',
  });
  const privateAttachment = await ApplicationAttachment.create({
    user: regular._id,
    application: regularApplication._id,
    originalName: 'private-resume.pdf',
    storedName: 'private.pdf',
    documentType: 'pdf',
    mimeType: 'application/pdf',
    size: 10,
    sha256: 'a'.repeat(64),
  });
  const demoToken = tokenFor(demo);
  const regularToken = tokenFor(regular);

  const demoList = await request(app)
    .get('/api/applications')
    .set('Authorization', `Bearer ${demoToken}`);
  assert.equal(demoList.status, 200);
  assert.deepEqual(demoList.body.data.map(({ _id }) => _id), [demoApplication._id.toString()]);

  const privateApplication = await request(app)
    .get(`/api/applications/${regularApplication._id}`)
    .set('Authorization', `Bearer ${demoToken}`);
  assert.equal(privateApplication.status, 404);
  const privateDocuments = await request(app)
    .get(`/api/applications/${regularApplication._id}/attachments`)
    .set('Authorization', `Bearer ${demoToken}`);
  assert.equal(privateDocuments.status, 404);

  const privateDocument = await request(app)
    .get(`/api/applications/${regularApplication._id}/attachments/${privateAttachment._id}`)
    .set('Authorization', `Bearer ${demoToken}`);
  assert.equal(privateDocument.status, 404);

  const demoApplicationNotVisibleToOtherUser = await request(app)
    .get(`/api/applications/${demoApplication._id}`)
    .set('Authorization', `Bearer ${regularToken}`);
  assert.equal(demoApplicationNotVisibleToOtherUser.status, 404);

  const paths = [
    request(app).post('/api/applications').send({ company: 'Another Co', role: 'Engineer' }),
    request(app).put(`/api/applications/${demoApplication._id}`).send({ notes: 'Changed' }),
    request(app).patch(`/api/applications/${demoApplication._id}/stage`).send({ stage: 'Offer' }),
    request(app).delete(`/api/applications/${demoApplication._id}`),
    request(app).post(`/api/applications/${demoApplication._id}/attachments`),
    request(app).delete(`/api/applications/${demoApplication._id}/attachments/${new mongoose.Types.ObjectId()}`),
  ];
  const mutations = await Promise.all(paths.map((call) => call.set('Authorization', `Bearer ${demoToken}`)));
  assert.deepEqual(mutations.map(({ status }) => status), [403, 403, 403, 403, 403, 403]);
  assert.ok(mutations.every(({ body }) => body.message === 'The demo account is read-only.'));

  const unchangedDemo = await JobApplication.findById(demoApplication._id);
  const unchangedRegular = await JobApplication.findById(regularApplication._id);
  assert.equal(unchangedDemo.stage, 'Applied');
  assert.equal(unchangedDemo.notes, '');
  assert.ok(unchangedRegular);
  assert.equal(await JobApplication.countDocuments({}), 2);
});

test('password reset cannot change the demo account password', async () => {
  const demo = await createUser(process.env.DEMO_USER_EMAIL, true);
  const originalConfigurationStatus = emailService.getConfigurationStatus;
  const originalSendPasswordResetEmail = emailService.sendPasswordResetEmail;
  let emailSent = false;
  emailService.getConfigurationStatus = () => ({ configured: true, issues: [] });
  emailService.sendPasswordResetEmail = async () => {
    emailSent = true;
  };

  try {
    const forgotResponse = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: demo.email });
    assert.equal(forgotResponse.status, 200);
    assert.equal(emailSent, false);
  } finally {
    emailService.getConfigurationStatus = originalConfigurationStatus;
    emailService.sendPasswordResetEmail = originalSendPasswordResetEmail;
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  demo.passwordResetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
  demo.passwordResetExpires = new Date(Date.now() + 60_000);
  await demo.save();

  const response = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: resetToken, password: 'new-test-password' });
  assert.equal(response.status, 400);

  const unchangedDemo = await User.findById(demo._id).select('+password');
  assert.equal(await unchangedDemo.matchPassword('valid-test-password'), true);
  assert.equal(await unchangedDemo.matchPassword('new-test-password'), false);
});

test('demo seeding is idempotent and preserves existing sample edits', async () => {
  const first = await seedDemoData();
  const demo = await User.findOne({ email: first.email });
  const firstCount = await JobApplication.countDocuments({ user: demo._id });
  assert.equal(first.createdUser, true);
  assert.equal(first.applicationsInserted, 10);
  assert.equal(firstCount, 10);

  process.env.DEMO_USER_PASSWORD = 'changed-seed-password';
  const second = await seedDemoData();
  assert.equal(second.createdUser, false);
  assert.equal(second.applicationsInserted, 0);

  const sample = await JobApplication.findOne({ user: demo._id, demoSeedKey: 'northstar-platform-engineer' }).select('+demoSeedKey');
  await JobApplication.updateOne({ _id: sample._id }, { $set: { notes: 'Demo visitor edited this note.' } });
  const third = await seedDemoData();
  assert.equal(third.applicationsInserted, 0);
  assert.equal(await JobApplication.countDocuments({ user: demo._id }), 10);
  assert.equal((await JobApplication.findById(sample._id)).notes, 'Demo visitor edited this note.');
  assert.equal(await User.countDocuments({ email: process.env.DEMO_USER_EMAIL }), 1);
  const retainedPassword = await User.findById(demo._id).select('+password');
  assert.equal(await retainedPassword.matchPassword('demo-seed-test-password'), true);
  assert.equal(await retainedPassword.matchPassword('changed-seed-password'), false);
});

test('demo seed refuses to adopt or alter a non-demo account', async () => {
  const regular = await createUser(process.env.DEMO_USER_EMAIL);
  await assert.rejects(seedDemoData(), /belongs to a non-demo account/);
  const unchanged = await User.findById(regular._id);
  assert.equal(unchanged.isDemo, false);
  assert.equal(await JobApplication.countDocuments({}), 0);
});
