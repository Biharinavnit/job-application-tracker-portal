const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const yauzl = require('yauzl');
const mongoose = require('mongoose');
const JobApplication = require('../models/JobApplication');
const ApplicationAttachment = require('../models/ApplicationAttachment');
const { getRetentionUntil } = require('../services/trashService');
const {
  MAX_DOCUMENT_SIZE_BYTES,
  getStoredPath,
  writeStoredFile,
  removeStoredFile,
} = require('../services/documentStorage');

const PDF_MIME_TYPE = 'application/pdf';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_DOCX_ENTRIES = 2000;
const MAX_DOCX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;

const publicAttachment = (attachment) => ({
  _id: attachment._id,
  originalName: attachment.originalName,
  documentType: attachment.documentType,
  mimeType: attachment.mimeType,
  size: attachment.size,
  createdAt: attachment.createdAt,
});

const sanitizeFilename = (filename, extension) => {
  const basename = String(filename || '').replace(/\\/g, '/').split('/').pop() || '';
  const stem = path.basename(basename, path.extname(basename))
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9 _.-]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '')
    .slice(0, 140);
  return `${stem || 'document'}${extension}`;
};

const validatePdf = (buffer) => {
  if (buffer.length < 10 || buffer.subarray(0, 5).toString('ascii') !== '%PDF-') return false;
  const tailStart = Math.max(0, buffer.length - 1024);
  return buffer.subarray(tailStart).includes(Buffer.from('%%EOF'));
};

const validateDocx = (buffer) => new Promise((resolve, reject) => {
  yauzl.fromBuffer(buffer, {
    lazyEntries: true,
    autoClose: true,
    decodeStrings: true,
    validateEntrySizes: true,
  }, (openError, zipFile) => {
    if (openError || !zipFile) return reject(new Error('DOCX archive is invalid.'));

    const requiredEntries = new Set(['[Content_Types].xml', 'word/document.xml']);
    let entryCount = 0;
    let uncompressedSize = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    };

    zipFile.on('error', () => fail(new Error('DOCX archive is invalid.')));
    zipFile.on('entry', (entry) => {
      entryCount += 1;
      if (entryCount > MAX_DOCX_ENTRIES || entry.fileName.includes('\\') ||
          entry.fileName.split('/').includes('..') || entry.fileName.startsWith('/')) {
        return fail(new Error('DOCX archive contains invalid entries.'));
      }

      requiredEntries.delete(entry.fileName);
      zipFile.openReadStream(entry, (streamError, stream) => {
        if (streamError || !stream) return fail(new Error('DOCX archive is invalid.'));
        stream.on('data', (chunk) => {
          uncompressedSize += chunk.length;
          if (uncompressedSize > MAX_DOCX_UNCOMPRESSED_SIZE) {
            fail(new Error('DOCX archive expands beyond the permitted limit.'));
          }
        });
        stream.on('error', () => fail(new Error('DOCX archive is invalid.')));
        stream.on('end', () => {
          if (!settled) zipFile.readEntry();
        });
      });
    });
    zipFile.on('end', () => {
      if (settled) return;
      settled = true;
      if (requiredEntries.size > 0) {
        return reject(new Error('DOCX file is missing required document content.'));
      }
      return resolve();
    });
    zipFile.readEntry();
  });
});

const ensureApplicationOwner = async (req, res, next) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid application ID.' });
  }
  try {
    const application = await JobApplication.findOne({
      _id: req.params.id,
      user: req.user._id,
      deletedAt: null,
    }).select('_id');
    if (!application) {
      return res.status(404).json({ success: false, message: 'Application not found.' });
    }
    req.application = application;
    return next();
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to access the application.' });
  }
};

const listAttachments = async (req, res) => {
  try {
    const attachments = await ApplicationAttachment.find({
      application: req.application._id,
      user: req.user._id,
      deletedAt: null,
    }).sort({ createdAt: 1, _id: 1 }).lean();
    return res.json({ success: true, data: attachments.map(publicAttachment) });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to load documents.' });
  }
};

const createAttachment = async (req, res) => {
  if (!req.file || !req.file.buffer || req.file.size < 1) {
    return res.status(400).json({ success: false, message: 'Choose a non-empty PDF or DOCX document.' });
  }
  if (req.file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return res.status(413).json({ success: false, message: 'Document exceeds the configured upload limit.' });
  }

  const extension = path.extname(req.file.originalname || '').toLowerCase();
  let documentType;
  let mimeType;

  if (extension === '.pdf') {
    if (req.file.mimetype !== PDF_MIME_TYPE && req.file.mimetype !== 'application/octet-stream') {
      return res.status(400).json({ success: false, message: 'The PDF content type does not match its file extension.' });
    }
    if (!validatePdf(req.file.buffer)) {
      return res.status(400).json({ success: false, message: 'The PDF file is empty, corrupt, or invalid.' });
    }
    documentType = 'pdf';
    mimeType = PDF_MIME_TYPE;
  } else if (extension === '.docx') {
    const acceptedMimeTypes = [
      DOCX_MIME_TYPE,
      'application/octet-stream',
    ];
    if (!acceptedMimeTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ success: false, message: 'The DOCX content type does not match its file extension.' });
    }
    try {
      await validateDocx(req.file.buffer);
    } catch (error) {
      return res.status(400).json({ success: false, message: error.message });
    }
    documentType = 'docx';
    mimeType = DOCX_MIME_TYPE;
  } else {
    return res.status(400).json({ success: false, message: 'Only PDF and DOCX documents are supported.' });
  }

  const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  try {
    const duplicate = await ApplicationAttachment.exists({
      application: req.application._id,
      sha256,
    });
    if (duplicate) {
      return res.status(409).json({ success: false, message: 'This document is already attached.' });
    }

    const storedName = `${crypto.randomUUID()}.${documentType}`;
    await writeStoredFile(storedName, req.file.buffer);
    try {
      const attachment = await ApplicationAttachment.create({
        application: req.application._id,
        user: req.user._id,
        originalName: sanitizeFilename(req.file.originalname, `.${documentType}`),
        storedName,
        documentType,
        mimeType,
        size: req.file.size,
        sha256,
      });
      return res.status(201).json({ success: true, data: publicAttachment(attachment) });
    } catch (error) {
      await removeStoredFile(storedName);
      if (error.code === 11000) {
        return res.status(409).json({ success: false, message: 'This document is already attached.' });
      }
      throw error;
    }
  } catch (error) {
    if (error.code === 'LIMIT_DOCUMENT_SIZE') {
      return res.status(413).json({ success: false, message: 'Document exceeds the configured upload limit.' });
    }
    console.error('Attachment upload failed with error code:', error.code || 'UNKNOWN');
    return res.status(500).json({ success: false, message: 'Unable to attach this document.' });
  }
};

const getOwnedAttachment = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.attachmentId)) {
    res.status(400).json({ success: false, message: 'Invalid document ID.' });
    return null;
  }
  const attachment = await ApplicationAttachment.findOne({
    _id: req.params.attachmentId,
    application: req.application._id,
    user: req.user._id,
    deletedAt: null,
  }).select('+storedName');
  if (!attachment) {
    res.status(404).json({ success: false, message: 'Document not found.' });
    return null;
  }
  return attachment;
};

const getPreviewCookieOptions = (req, attachment, maxAge) => ({
  httpOnly: true,
  secure: Boolean(req.secure),
  sameSite: 'strict',
  path: `/api/applications/${attachment.application}/attachments/${attachment._id}/view`,
  maxAge,
});

const createPreviewSession = async (req, res) => {
  try {
    const attachment = await getOwnedAttachment(req, res);
    if (!attachment) return;
    if (attachment.documentType !== 'pdf' || attachment.mimeType !== PDF_MIME_TYPE) {
      return res.status(415).json({
        success: false,
        message: 'In-browser preview is only supported for PDF documents. Download this file to view it.',
      });
    }
    try {
      await fs.promises.access(getStoredPath(attachment.storedName), fs.constants.R_OK);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return res.status(404).json({ success: false, message: 'Document not found.' });
      }
      throw error;
    }

    const token = jwt.sign({
      id: req.user._id,
      tokenVersion: req.user.tokenVersion ?? 0,
      purpose: 'pdf-preview',
      applicationId: attachment.application.toString(),
      attachmentId: attachment._id.toString(),
    }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const cookieName = `jt_pdf_preview_${attachment._id}`;
    res.cookie(cookieName, token, getPreviewCookieOptions(req, attachment, 15 * 60 * 1000));
    return res.json({
      success: true,
      url: `/api/applications/${attachment.application}/attachments/${attachment._id}/view`,
    });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to start the PDF preview.' });
  }
};

const clearPreviewSession = async (req, res) => {
  try {
    const attachment = await getOwnedAttachment(req, res);
    if (!attachment) return;
    res.clearCookie(
      `jt_pdf_preview_${attachment._id}`,
      getPreviewCookieOptions(req, attachment, 0)
    );
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to close the PDF preview session.' });
  }
};

const streamPdf = async (req, res, attachment) => {
  const filePath = getStoredPath(attachment.storedName);
  let fileHandle;
  let stream;

  try {
    fileHandle = await fs.promises.open(filePath, 'r');
    const { size } = await fileHandle.stat();
    if (!Number.isSafeInteger(size) || size < 1) {
      await fileHandle.close();
      fileHandle = null;
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    res.set('Accept-Ranges', 'bytes');
    const invalidRange = async () => {
      await fileHandle.close();
      fileHandle = null;
      res.set('Content-Range', `bytes */${size}`);
      return res.status(416).end();
    };

    let start = 0;
    let end = size - 1;
    let status = 200;
    if (req.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range.trim());
      if (!match || (!match[1] && !match[2])) {
        return await invalidRange();
      }

      if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength < 1) {
          return await invalidRange();
        }
        start = Math.max(size - suffixLength, 0);
      } else {
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : size - 1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start >= size ||
          start > end
        ) {
          return await invalidRange();
        }
        end = Math.min(end, size - 1);
      }
      status = 206;
      res.set('Content-Range', `bytes ${start}-${end}/${size}`);
    }

    res.status(status).set({
      'Content-Type': PDF_MIME_TYPE,
      'Content-Length': end - start + 1,
      'Content-Disposition': `inline; filename="${attachment.originalName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    stream = fileHandle.createReadStream({ start, end, autoClose: true });
    fileHandle = null;
    stream.on('error', (error) => {
      if (error.code !== 'ENOENT') console.error('PDF streaming failed:', error.message);
      if (!res.headersSent) res.status(500).json({ success: false, message: 'Unable to read the document.' });
      else res.destroy(error);
    });
    res.on('close', () => {
      if (stream && !stream.destroyed) stream.destroy();
    });
    return stream.pipe(res);
  } catch (error) {
    if (fileHandle) await fileHandle.close().catch(() => {});
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    console.error('PDF streaming setup failed:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to read the document.' });
  }
};

const downloadAttachment = async (req, res) => {
  try {
    const attachment = await getOwnedAttachment(req, res);
    if (!attachment) return;
    const filePath = getStoredPath(attachment.storedName);
    await fs.promises.access(filePath, fs.constants.R_OK);
    res.set({
      'Content-Type': attachment.mimeType,
      'Content-Length': attachment.size,
      'Content-Disposition': `attachment; filename="${attachment.originalName}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return fs.createReadStream(filePath)
      .on('error', () => {
        if (!res.headersSent) res.status(404).json({ success: false, message: 'Document not found.' });
        else res.destroy();
      })
      .pipe(res);
  } catch {
    if (!res.headersSent) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    return res.destroy();
  }
};

const viewAttachment = async (req, res) => {
  try {
    const attachment = await getOwnedAttachment(req, res);
    if (!attachment) return;
    if (attachment.documentType !== 'pdf' || attachment.mimeType !== PDF_MIME_TYPE) {
      return res.status(415).json({
        success: false,
        message: 'In-browser preview is only supported for PDF documents. Download this file to view it.',
      });
    }

    return await streamPdf(req, res, attachment);
  } catch (error) {
    console.error('PDF preview failed:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: 'Unable to preview this document.' });
    }
    return res.destroy(error);
  }
};

const deleteAttachment = async (req, res) => {
  try {
    const attachment = await getOwnedAttachment(req, res);
    if (!attachment) return;
    const deletedAt = new Date();
    const result = await ApplicationAttachment.updateOne({
      _id: attachment._id,
      application: req.application._id,
      user: req.user._id,
      deletedAt: null,
    }, {
      $set: {
        deletedAt,
        retentionUntil: getRetentionUntil(deletedAt),
        deletedWithApplication: false,
        purgePending: false,
      },
    });
    if (!result.modifiedCount) {
      return res.status(404).json({ success: false, message: 'Document not found.' });
    }
    return res.json({ success: true, message: 'Document moved to Recently Deleted.' });
  } catch {
    return res.status(500).json({ success: false, message: 'Unable to delete this document.' });
  }
};

module.exports = {
  ensureApplicationOwner,
  listAttachments,
  createAttachment,
  createPreviewSession,
  clearPreviewSession,
  downloadAttachment,
  viewAttachment,
  deleteAttachment,
  sanitizeFilename,
};
