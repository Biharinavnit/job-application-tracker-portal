const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const request = require('supertest');

const storageDirectory = path.join(os.tmpdir(), `jobtrack-trash-test-${process.pid}`);
process.env.JWT_SECRET = 'jobtrack-trash-integration-test-secret';
process.env.DOCUMENT_STORAGE_DIR = storageDirectory;
process.env.TRASH_RETENTION_DAYS = '30';

const app = require('../app');
const User = require('../models/User');
const JobApplication = require('../models/JobApplication');
const ApplicationAttachment = require('../models/ApplicationAttachment');
const { getStoredPath, writeStoredFile } = require('../services/documentStorage');
const { getRetentionUntil, purgeExpiredTrash } = require('../services/trashService');

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n');
const withAuth = (requestBuilder, token) =>
  requestBuilder.set('Authorization', Buffer.from(['Bearer', token].join(' ')).toString());
let mongoServer;
let owner;
let otherUser;
let ownerToken;
let otherUserToken;
let application;

const createUser = async (email) => User.create({
  name: 'Trash Test User',
  email,
  password: 'valid-test-password',
});

const createAttachment = async (parent = application, user = owner) => {
  const storedName = `${crypto.randomUUID()}.pdf`;
  await writeStoredFile(storedName, PDF_BYTES);
  return ApplicationAttachment.create({
    application: parent._id,
    user: user._id,
    originalName: 'portfolio.pdf',
    storedName,
    documentType: 'pdf',
    mimeType: 'application/pdf',
    size: PDF_BYTES.length,
    sha256: crypto.randomBytes(32).toString('hex'),
  });
};

const trashPath = (type, id) => `/api/trash/${type}/${id}`;

before(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  process.env.TRASH_RETENTION_DAYS = '30';
  await Promise.all([
    User.deleteMany({}),
    JobApplication.deleteMany({}),
    ApplicationAttachment.deleteMany({}),
    fs.rm(storageDirectory, { recursive: true, force: true }),
  ]);
  owner = await createUser('trash-owner@example.test');
  otherUser = await createUser('trash-other@example.test');
  ownerToken = jwt.sign({ id: owner._id, tokenVersion: 0 }, process.env.JWT_SECRET);
  otherUserToken = jwt.sign({ id: otherUser._id, tokenVersion: 0 }, process.env.JWT_SECRET);
  application = await JobApplication.create({
    user: owner._id,
    company: 'Northstar Analytics',
    role: 'Platform Engineer',
    location: 'Remote',
    stage: 'Interview',
    notes: 'Keep these private interview notes.',
    tags: ['priority', 'remote'],
    appliedDate: new Date('2026-02-01T12:00:00.000Z'),
    interviewDate: new Date('2026-02-08T12:00:00.000Z'),
  });
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  await fs.rm(storageDirectory, { recursive: true, force: true });
});

test('application deletion soft-deletes the record and attachments; restore preserves data and files', async () => {
  const attachment = await createAttachment();
  const storedPath = getStoredPath(attachment.storedName);
  const deletion = await withAuth(
    request(app).delete(`/api/applications/${application._id}`),
    ownerToken
  );
  assert.equal(deletion.status, 200);
  await fs.access(storedPath);

  const trashedApplication = await JobApplication.findById(application._id);
  const trashedAttachment = await ApplicationAttachment.findById(attachment._id);
  assert.ok(trashedApplication.deletedAt);
  assert.ok(trashedAttachment.deletedAt);
  assert.equal(trashedAttachment.deletedWithApplication, true);

  const activeList = await withAuth(request(app).get('/api/applications'), ownerToken);
  assert.equal(activeList.body.count, 0);
  const activeDocumentList = await withAuth(
    request(app).get(`/api/applications/${application._id}/attachments`),
    ownerToken
  );
  assert.equal(activeDocumentList.status, 404);

  const trash = await withAuth(request(app).get('/api/trash'), ownerToken);
  assert.equal(trash.status, 200);
  assert.equal(trash.body.retentionDays, 30);
  assert.deepEqual(trash.body.data.map(({ type }) => type).sort(), ['application', 'document']);
  assert.ok(trash.body.data.every(({ daysRemaining, retentionStatus }) => daysRemaining === 30 && /remaining/.test(retentionStatus)));

  const restore = await withAuth(
    request(app).post(`${trashPath('application', application._id)}/restore`),
    ownerToken
  );
  assert.equal(restore.status, 200);
  assert.deepEqual(restore.body.warnings, []);

  const restoredApplication = await JobApplication.findById(application._id);
  assert.equal(restoredApplication.deletedAt, null);
  assert.equal(restoredApplication.company, 'Northstar Analytics');
  assert.equal(restoredApplication.notes, 'Keep these private interview notes.');
  assert.deepEqual(restoredApplication.tags, ['priority', 'remote']);
  assert.equal(restoredApplication.stage, 'Interview');
  assert.equal(restoredApplication.appliedDate.toISOString(), '2026-02-01T12:00:00.000Z');
  const activeAttachments = await withAuth(
    request(app).get(`/api/applications/${application._id}/attachments`),
    ownerToken
  );
  assert.equal(activeAttachments.body.data.length, 1);
  assert.equal(activeAttachments.body.data[0]._id, attachment._id.toString());
  await fs.access(storedPath);
});

test('document restore requires an active parent application', async () => {
  const attachment = await createAttachment();
  const storedPath = getStoredPath(attachment.storedName);
  const softDelete = await withAuth(
    request(app).delete(`/api/applications/${application._id}/attachments/${attachment._id}`),
    ownerToken
  );
  assert.equal(softDelete.status, 200);
  await fs.access(storedPath);

  const restore = await withAuth(
    request(app).post(`${trashPath('document', attachment._id)}/restore`),
    ownerToken
  );
  assert.equal(restore.status, 200);
  assert.equal((await ApplicationAttachment.findById(attachment._id)).deletedAt, null);
  await fs.access(storedPath);

  await withAuth(request(app).delete(`/api/applications/${application._id}`), ownerToken);
  const parentDeletedRestore = await withAuth(
    request(app).post(`${trashPath('document', attachment._id)}/restore`),
    ownerToken
  );
  assert.equal(parentDeletedRestore.status, 409);
});

test('document restore reports missing stored files without changing the trash record', async () => {
  const attachment = await createAttachment();
  await withAuth(
    request(app).delete(`/api/applications/${application._id}/attachments/${attachment._id}`),
    ownerToken
  );
  await fs.unlink(getStoredPath(attachment.storedName));

  const restore = await withAuth(
    request(app).post(`${trashPath('document', attachment._id)}/restore`),
    ownerToken
  );
  assert.equal(restore.status, 410);
  assert.match(restore.body.message, /file is missing/);
  assert.ok((await ApplicationAttachment.findById(attachment._id)).deletedAt);
});

test('expired attachments and applications are permanently purged with stored files', async () => {
  process.env.TRASH_RETENTION_DAYS = '1';
  const attachment = await createAttachment();
  const storedPath = getStoredPath(attachment.storedName);
  const deletedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await JobApplication.updateOne({ _id: application._id }, {
    $set: { deletedAt, retentionUntil: getRetentionUntil(deletedAt) },
  });
  await ApplicationAttachment.updateOne({ _id: attachment._id }, {
    $set: {
      deletedAt,
      retentionUntil: getRetentionUntil(deletedAt),
      deletedWithApplication: true,
    },
  });

  const result = await purgeExpiredTrash();
  assert.equal(result.attachmentsPurged, 1);
  assert.equal(result.applicationsPurged, 1);
  assert.equal(await ApplicationAttachment.exists({ _id: attachment._id }), null);
  assert.equal(await JobApplication.exists({ _id: application._id }), null);
  await assert.rejects(fs.access(storedPath), { code: 'ENOENT' });
});

test('permanent document deletion removes metadata and files and tolerates missing files', async () => {
  const attachment = await createAttachment();
  const storedPath = getStoredPath(attachment.storedName);
  await ApplicationAttachment.updateOne({ _id: attachment._id }, {
    $set: { deletedAt: new Date(), retentionUntil: getRetentionUntil() },
  });

  const result = await withAuth(
    request(app).delete(trashPath('document', attachment._id)),
    ownerToken
  );
  assert.equal(result.status, 200);
  assert.equal(await ApplicationAttachment.exists({ _id: attachment._id }), null);
  await assert.rejects(fs.access(storedPath), { code: 'ENOENT' });

  const missingFileAttachment = await createAttachment();
  await ApplicationAttachment.updateOne({ _id: missingFileAttachment._id }, {
    $set: { deletedAt: new Date(), retentionUntil: getRetentionUntil() },
  });
  await fs.unlink(getStoredPath(missingFileAttachment.storedName));
  const retry = await withAuth(
    request(app).delete(trashPath('document', missingFileAttachment._id)),
    ownerToken
  );
  assert.equal(retry.status, 200);
  assert.equal(await ApplicationAttachment.exists({ _id: missingFileAttachment._id }), null);
});

test('trash listing, restoration, and permanent deletion are owner-scoped', async () => {
  const attachment = await createAttachment();
  await withAuth(request(app).delete(`/api/applications/${application._id}`), ownerToken);

  const otherList = await withAuth(request(app).get('/api/trash'), otherUserToken);
  assert.equal(otherList.status, 200);
  assert.equal(otherList.body.count, 0);

  const otherRestore = await withAuth(
    request(app).post(`${trashPath('application', application._id)}/restore`),
    otherUserToken
  );
  assert.equal(otherRestore.status, 404);

  const otherPermanentDelete = await withAuth(
    request(app).delete(trashPath('application', application._id)),
    otherUserToken
  );
  assert.equal(otherPermanentDelete.status, 404);

  const otherDocumentRestore = await withAuth(
    request(app).post(`${trashPath('document', attachment._id)}/restore`),
    otherUserToken
  );
  assert.equal(otherDocumentRestore.status, 404);

  assert.ok((await JobApplication.findById(application._id)).deletedAt);
  assert.ok((await ApplicationAttachment.findById(attachment._id)).deletedAt);
});
