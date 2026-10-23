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

const testStorage = path.join(os.tmpdir(), `jobtrack-documents-test-${process.pid}`);
process.env.JWT_SECRET = 'jobtrack-document-integration-test-secret';
process.env.DOCUMENT_STORAGE_DIR = testStorage;
process.env.MAX_DOCUMENT_SIZE_BYTES = '1024';

const app = require('../app');
const User = require('../models/User');
const JobApplication = require('../models/JobApplication');
const ApplicationAttachment = require('../models/ApplicationAttachment');
const { getStoredPath } = require('../services/documentStorage');

const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n');
const SECOND_PDF_BYTES = Buffer.from('%PDF-1.7\n2 0 obj << /Title (Second) >> endobj\n%%EOF\n');
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const withAuth = (requestBuilder, token) => requestBuilder.set('Authorization', Buffer.from(['Bearer', token].join(' ')).toString());
const previewCookie = async (token, applicationId, attachmentId) => {
  const session = await withAuth(
    request(app).post(`/api/applications/${applicationId}/attachments/${attachmentId}/preview-session`),
    token
  );
  assert.equal(session.status, 200);
  assert.match(session.body.url, new RegExp(`/${applicationId}/attachments/${attachmentId}/view$`));
  const cookie = session.headers['set-cookie']?.find((value) =>
    value.startsWith(`jt_pdf_preview_${attachmentId}=`)
  );
  assert.ok(cookie);
  return cookie.split(';')[0];
};

const viewPdf = async (token, applicationId, attachmentId, range) => {
  const cookie = await previewCookie(token, applicationId, attachmentId);
  const preview = request(app)
    .get(`/api/applications/${applicationId}/attachments/${attachmentId}/view`)
    .set('Cookie', cookie)
    .buffer(true)
    .parse(binaryParser);
  if (range) preview.set('Range', range);
  return preview;
};

const createStoredPdf = async (filename, bytes) => {
  const storedName = `${crypto.randomUUID()}.pdf`;
  await fs.mkdir(testStorage, { recursive: true });
  await fs.writeFile(getStoredPath(storedName), bytes);
  return ApplicationAttachment.create({
    application: application._id,
    user: owner.user._id,
    originalName: filename,
    storedName,
    documentType: 'pdf',
    mimeType: 'application/pdf',
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
};

let mongoServer;
let owner;
let otherUser;
let application;
let ownerToken;
let otherUserToken;

const makeZip = (files) => {
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  };

  let offset = 0;
  const localParts = [];
  const centralParts = [];
  for (const [fileName, contents] of Object.entries(files)) {
    const name = Buffer.from(fileName);
    const data = Buffer.from(contents);
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(Object.keys(files).length, 8);
  endRecord.writeUInt16LE(Object.keys(files).length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, endRecord]);
};

const DOCX_BYTES = makeZip({
  '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
  'word/document.xml': '<?xml version="1.0"?><document><body/></document>',
});

const createIdentity = async (email) => {
  const user = await User.create({ name: 'Document User', email, password: 'test-password' });
  const token = jwt.sign({ id: user._id, tokenVersion: 0 }, process.env.JWT_SECRET);
  return { user, token };
};

const upload = (token, applicationId, filename, bytes, contentType) => request(app)
  .post(`/api/applications/${applicationId}/attachments`)
  .set('Authorization', `Bearer ${token}`)
  .attach('document', bytes, { filename, contentType });

const binaryParser = (response, callback) => {
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
};

before(async () => {
  mongoServer = await MongoMemoryServer.create({ instance: { launchTimeout: 60_000 } });
  await mongoose.connect(mongoServer.getUri());
});

beforeEach(async () => {
  await Promise.all([
    User.deleteMany({}),
    JobApplication.deleteMany({}),
    ApplicationAttachment.deleteMany({}),
    fs.rm(testStorage, { recursive: true, force: true }),
  ]);
  owner = await createIdentity('owner@example.test');
  otherUser = await createIdentity('other@example.test');
  ownerToken = owner.token;
  otherUserToken = otherUser.token;
  application = await JobApplication.create({
    user: owner.user._id,
    company: 'Example Co',
    role: 'Engineer',
    notes: 'Existing interview notes',
    statusNote: 'Recruiter follow-up due',
  });
});

after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
  await fs.rm(testStorage, { recursive: true, force: true });
});

test('authenticated owner can attach and download a validated PDF without changing notes', async () => {
  const response = await upload(ownerToken, application._id, 'resume.pdf', PDF_BYTES, 'application/pdf');
  assert.equal(response.status, 201);
  assert.equal(response.body.data.documentType, 'pdf');
  assert.equal(response.body.data.size, PDF_BYTES.length);

  const downloaded = await request(app)
    .get(`/api/applications/${application._id}/attachments/${response.body.data._id}`)
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.body, PDF_BYTES);
  assert.match(downloaded.headers['content-type'], /^application\/pdf/);
  assert.match(downloaded.headers['content-disposition'], /resume\.pdf/);

  const updatedApplication = await JobApplication.findById(application._id);
  assert.equal(updatedApplication.notes, 'Existing interview notes');
  assert.equal(updatedApplication.statusNote, 'Recruiter follow-up due');
});

test('owner can view a PDF inline using the original stored file', async () => {
  const created = await upload(ownerToken, application._id, 'portfolio.pdf', PDF_BYTES, 'application/pdf');
  const viewed = await viewPdf(ownerToken, application._id, created.body.data._id);

  assert.equal(viewed.status, 200);
  assert.deepEqual(viewed.body, PDF_BYTES);
  assert.match(viewed.headers['content-type'], /^application\/pdf/);
  assert.match(viewed.headers['content-disposition'], /^inline;/);
  assert.equal(viewed.headers['accept-ranges'], 'bytes');
  assert.equal(Number(viewed.headers['content-length']), PDF_BYTES.length);
  assert.equal(viewed.headers['x-content-type-options'], 'nosniff');
  assert.equal(viewed.headers['cache-control'], 'private, no-store');
  assert.equal(viewed.headers['cross-origin-resource-policy'], 'same-origin');
});

test('application list includes only owned attachment summaries and zero for no documents', async () => {
  const otherApplication = await JobApplication.create({
    user: otherUser.user._id,
    company: 'Other Co',
    role: 'Designer',
  });
  const emptyList = await request(app)
    .get('/api/applications')
    .set('Authorization', `Bearer ${ownerToken}`);
  const emptyApp = emptyList.body.data.find((item) => item._id === application._id.toString());
  assert.equal(emptyApp.attachmentCount, 0);
  assert.equal(emptyApp.firstAttachmentId, null);

  const created = await upload(ownerToken, application._id, 'portfolio.pdf', PDF_BYTES, 'application/pdf');
  await upload(otherUserToken, otherApplication._id, 'private.pdf', PDF_BYTES, 'application/pdf');
  const populatedList = await request(app)
    .get('/api/applications')
    .set('Authorization', `Bearer ${ownerToken}`);
  const populatedApp = populatedList.body.data.find((item) => item._id === application._id.toString());

  assert.equal(populatedApp.attachmentCount, 1);
  assert.equal(populatedApp.firstAttachmentId, created.body.data._id);
  assert.equal(populatedApp.firstDocumentType, 'pdf');
  assert.equal(populatedApp.firstDocumentName, 'portfolio.pdf');
  assert.equal(populatedList.body.data.some((item) => item._id === otherApplication._id.toString()), false);
});

test('attachment previews return the selected PDF and filename for each attachment ID', async () => {
  const first = await upload(ownerToken, application._id, 'first.pdf', PDF_BYTES, 'application/pdf');
  const second = await upload(ownerToken, application._id, 'second.pdf', SECOND_PDF_BYTES, 'application/pdf');
  const listed = await request(app)
    .get(`/api/applications/${application._id}/attachments`)
    .set('Authorization', `Bearer ${ownerToken}`);

  assert.equal(listed.status, 200);
  assert.equal(listed.body.data.length, 2);
  assert.deepEqual(
    listed.body.data.map((attachment) => attachment._id),
    [first.body.data._id, second.body.data._id]
  );
  assert.deepEqual(
    listed.body.data.map(({ originalName, documentType, size }) => ({ originalName, documentType, size })),
    [
      { originalName: 'first.pdf', documentType: 'pdf', size: PDF_BYTES.length },
      { originalName: 'second.pdf', documentType: 'pdf', size: SECOND_PDF_BYTES.length },
    ]
  );

  const firstViewed = await viewPdf(ownerToken, application._id, listed.body.data[0]._id);
  assert.equal(firstViewed.status, 200);
  assert.equal(firstViewed.headers['content-type'], 'application/pdf');
  assert.equal(firstViewed.headers['content-disposition'], 'inline; filename="first.pdf"');
  assert.deepEqual(firstViewed.body, PDF_BYTES);

  const secondViewed = await viewPdf(ownerToken, application._id, listed.body.data[1]._id);
  assert.equal(secondViewed.status, 200);
  assert.equal(secondViewed.headers['content-type'], 'application/pdf');
  assert.equal(secondViewed.headers['content-disposition'], 'inline; filename="second.pdf"');
  assert.deepEqual(secondViewed.body, SECOND_PDF_BYTES);
});

test('large PDFs stream full files and valid byte ranges without buffering the whole response', async () => {
  const largeBytes = Buffer.alloc(2 * 1024 * 1024);
  Buffer.from('%PDF-1.7\n').copy(largeBytes);
  Buffer.from('%%EOF\n').copy(largeBytes, largeBytes.length - 6);
  const attachment = await createStoredPdf('large-synthetic.pdf', largeBytes);

  const partial = await viewPdf(ownerToken, application._id, attachment._id, 'bytes=1048576-1048591');
  assert.equal(partial.status, 206);
  assert.deepEqual(partial.body, largeBytes.subarray(1048576, 1048592));
  assert.equal(partial.headers['content-range'], `bytes 1048576-1048591/${largeBytes.length}`);
  assert.equal(partial.headers['accept-ranges'], 'bytes');
  assert.equal(Number(partial.headers['content-length']), 16);

  const suffix = await viewPdf(ownerToken, application._id, attachment._id, 'bytes=-8');
  assert.equal(suffix.status, 206);
  assert.deepEqual(suffix.body, largeBytes.subarray(-8));
  assert.equal(suffix.headers['content-range'], `bytes ${largeBytes.length - 8}-${largeBytes.length - 1}/${largeBytes.length}`);

  const full = await viewPdf(ownerToken, application._id, attachment._id);
  assert.equal(full.status, 200);
  assert.equal(full.body.length, largeBytes.length);
  assert.deepEqual(full.body, largeBytes);
  assert.equal(Number(full.headers['content-length']), largeBytes.length);
});

test('invalid and unsatisfiable byte ranges return 416 with the resource size', async () => {
  const created = await upload(ownerToken, application._id, 'portfolio.pdf', PDF_BYTES, 'application/pdf');
  for (const range of ['bytes=999999-', 'bytes=8-2', 'bytes=-0', 'bytes=0-1,3-4', 'invalid']) {
    const response = await viewPdf(ownerToken, application._id, created.body.data._id, range);
    assert.equal(response.status, 416, range);
    assert.equal(response.headers['content-range'], `bytes */${PDF_BYTES.length}`, range);
    assert.equal(response.headers['accept-ranges'], 'bytes', range);
  }
});

test('empty application attachment list is returned as an empty array', async () => {
  const response = await request(app)
    .get(`/api/applications/${application._id}/attachments`)
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, []);
});

test('DOCX preview is explicitly unsupported while download remains available', async () => {
  const created = await upload(ownerToken, application._id, 'cover-letter.docx', DOCX_BYTES, DOCX_MIME);
  const viewed = await withAuth(
    request(app).post(`/api/applications/${application._id}/attachments/${created.body.data._id}/preview-session`),
    ownerToken
  );
  assert.equal(viewed.status, 415);
  assert.match(viewed.body.message, /only supported for PDF/);

  const downloaded = await request(app)
    .get(`/api/applications/${application._id}/attachments/${created.body.data._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .buffer(true)
    .parse(binaryParser);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.body, DOCX_BYTES);
  assert.match(downloaded.headers['content-disposition'], /^attachment;/);
});

test('document preview requires authentication and rejects cross-user access', async () => {
  const created = await upload(ownerToken, application._id, 'portfolio.pdf', PDF_BYTES, 'application/pdf');
  const viewPath = `/api/applications/${application._id}/attachments/${created.body.data._id}/view`;
  const otherApplication = await JobApplication.create({
    user: otherUser.user._id,
    company: 'Other Co',
    role: 'Designer',
  });

  const unauthenticated = await request(app).get(viewPath);
  assert.equal(unauthenticated.status, 401);

  const crossUser = await request(app)
    .get(`/api/applications/${otherApplication._id}/attachments/${created.body.data._id}/view`)
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.equal(crossUser.status, 404);
});

test('PDF preview cookies are attachment-scoped and do not put credentials in the URL', async () => {
  const first = await upload(ownerToken, application._id, 'first.pdf', PDF_BYTES, 'application/pdf');
  const second = await upload(ownerToken, application._id, 'second.pdf', SECOND_PDF_BYTES, 'application/pdf');
  const session = await withAuth(
    request(app).post(`/api/applications/${application._id}/attachments/${first.body.data._id}/preview-session`),
    ownerToken
  );

  assert.equal(session.status, 200);
  assert.equal(
    session.body.url,
    `/api/applications/${application._id}/attachments/${first.body.data._id}/view`
  );
  assert.doesNotMatch(session.body.url, /token|jwt|secret/i);
  const cookie = session.headers['set-cookie'].find((value) =>
    value.startsWith(`jt_pdf_preview_${first.body.data._id}=`)
  );
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Strict/i);
  assert.match(cookie, new RegExp(`Path=/api/applications/${application._id}/attachments/${first.body.data._id}/view`));
  assert.equal(cookie.startsWith(`jt_pdf_preview_${second.body.data._id}=`), false);

  const otherApplication = await JobApplication.create({
    user: otherUser.user._id,
    company: 'Other Co',
    role: 'Designer',
  });
  const stolenCookie = await request(app)
    .get(`/api/applications/${otherApplication._id}/attachments/${first.body.data._id}/view`)
    .set('Cookie', cookie.split(';')[0]);
  assert.equal(stolenCookie.status, 401);
});

test('document preview rejects attachments that do not exist', async () => {
  const missingAttachmentId = new mongoose.Types.ObjectId();
  const viewed = await request(app)
    .get(`/api/applications/${application._id}/attachments/${missingAttachmentId}/view`)
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.equal(viewed.status, 404);
  assert.equal(viewed.body.message, 'Document not found.');
});

test('document preview returns not found when the private file is missing', async () => {
  const created = await upload(ownerToken, application._id, 'missing.pdf', PDF_BYTES, 'application/pdf');
  const attachment = await ApplicationAttachment.findById(created.body.data._id).select('+storedName');
  await fs.unlink(getStoredPath(attachment.storedName));

  const viewed = await request(app)
    .get(`/api/applications/${application._id}/attachments/${attachment._id}/view`)
    .set('Authorization', `Bearer ${ownerToken}`);
  assert.equal(viewed.status, 404);
  assert.equal(viewed.body.message, 'Document not found.');
});

test('authenticated owner can attach a valid DOCX and duplicate contents are rejected', async () => {
  const response = await upload(ownerToken, application._id, 'cover-letter.docx', DOCX_BYTES, DOCX_MIME);
  assert.equal(response.status, 201);
  assert.equal(response.body.data.documentType, 'docx');

  const duplicate = await upload(ownerToken, application._id, 'another-name.docx', DOCX_BYTES, DOCX_MIME);
  assert.equal(duplicate.status, 409);
});

test('unsupported, invalid, and oversized files are rejected', async () => {
  const unsupported = await upload(ownerToken, application._id, 'resume.txt', Buffer.from('text'), 'text/plain');
  assert.equal(unsupported.status, 400);

  const invalidPdf = await upload(ownerToken, application._id, 'broken.pdf', Buffer.from('not a PDF'), 'application/pdf');
  assert.equal(invalidPdf.status, 400);

  const invalidDocx = await upload(ownerToken, application._id, 'broken.docx', Buffer.from('not a ZIP'), DOCX_MIME);
  assert.equal(invalidDocx.status, 400);

  const emptyPdf = await upload(ownerToken, application._id, 'empty.pdf', Buffer.alloc(0), 'application/pdf');
  assert.equal(emptyPdf.status, 400);

  const oversized = await upload(
    ownerToken,
    application._id,
    'large.pdf',
    Buffer.concat([PDF_BYTES, Buffer.alloc(1025)]),
    'application/pdf'
  );
  assert.equal(oversized.status, 413);
});

test('missing or invalid application IDs and unauthenticated requests are rejected', async () => {
  const missing = await upload(ownerToken, new mongoose.Types.ObjectId(), 'resume.pdf', PDF_BYTES, 'application/pdf');
  assert.equal(missing.status, 404);

  const invalid = await upload(ownerToken, 'not-an-id', 'resume.pdf', PDF_BYTES, 'application/pdf');
  assert.equal(invalid.status, 400);

  const unauthenticated = await request(app)
    .post(`/api/applications/${application._id}/attachments`)
    .attach('document', PDF_BYTES, { filename: 'resume.pdf', contentType: 'application/pdf' });
  assert.equal(unauthenticated.status, 401);
});

test('another user cannot list, upload, download, or delete an application attachment', async () => {
  const created = await upload(ownerToken, application._id, 'resume.pdf', PDF_BYTES, 'application/pdf');
  assert.equal(created.status, 201);
  const attachmentId = created.body.data._id;

  const list = await withAuth(request(app).get('/api/applications/' + application._id + '/attachments'), otherUserToken);
  assert.equal(list.status, 404);

  const attemptedUpload = await upload(otherUserToken, application._id, 'other.pdf', PDF_BYTES, 'application/pdf');
  assert.equal(attemptedUpload.status, 404);

  const download = await withAuth(request(app).get('/api/applications/' + application._id + '/attachments/' + attachmentId), otherUserToken);
  assert.equal(download.status, 404);

  const deletion = await withAuth(request(app).delete('/api/applications/' + application._id + '/attachments/' + attachmentId), otherUserToken);
  assert.equal(deletion.status, 404);
  assert.equal(await ApplicationAttachment.countDocuments({ _id: attachmentId }), 1);
});

test('deleting an attachment moves it to Recently Deleted and retains its private file', async () => {
  const created = await upload(ownerToken, application._id, 'resume.pdf', PDF_BYTES, 'application/pdf');
  const attachment = await ApplicationAttachment.findById(created.body.data._id).select('+storedName');
  const storedPath = getStoredPath(attachment.storedName);
  await fs.access(storedPath);

  const response = await withAuth(request(app).delete(`/api/applications/${application._id}/attachments/${attachment._id}`), ownerToken);
  assert.equal(response.status, 200);
  await fs.access(storedPath);
  const trashed = await ApplicationAttachment.findById(attachment._id);
  assert.ok(trashed.deletedAt);
  assert.ok(trashed.retentionUntil > new Date());
  assert.equal(await ApplicationAttachment.countDocuments({ _id: attachment._id }), 1);
  const visible = await withAuth(request(app).get(`/api/applications/${application._id}/attachments`), ownerToken);
  assert.deepEqual(visible.body.data, []);
});

test('application create and update preserve notes and status note fields', async () => {
  const create = await request(app)
    .post('/api/applications')
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ company: 'New Co', role: 'Developer', notes: 'Keep this note', statusNote: 'Waiting for reply' });
  assert.equal(create.status, 201);

  const update = await request(app)
    .put(`/api/applications/${create.body.data._id}`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ company: 'New Co', role: 'Developer II', notes: 'Updated notes', statusNote: 'Interview scheduled' });
  assert.equal(update.status, 200);
  assert.equal(update.body.data.notes, 'Updated notes');
  assert.equal(update.body.data.statusNote, 'Interview scheduled');
});

test('sanitized attachment filenames cannot contain path separators', async () => {
  const response = await upload(ownerToken, application._id, '..\\..\\resume.pdf', PDF_BYTES, 'application/pdf');
  assert.equal(response.status, 201);
  assert.equal(response.body.data.originalName, 'resume.pdf');
  assert.doesNotMatch(response.body.data.originalName, /[/\\]/);
});
