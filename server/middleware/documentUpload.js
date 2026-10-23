const multer = require('multer');
const path = require('path');
const { MAX_DOCUMENT_SIZE_BYTES } = require('../services/documentStorage');

const MIME_TYPES = {
  '.pdf': new Set(['application/pdf', 'application/octet-stream']),
  '.docx': new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ]),
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_SIZE_BYTES,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (!MIME_TYPES[extension] || !MIME_TYPES[extension].has(file.mimetype)) {
      const error = new Error('Only PDF and DOCX documents are supported.');
      error.code = 'UNSUPPORTED_DOCUMENT_TYPE';
      return callback(error);
    }
    return callback(null, true);
  },
}).single('document');

const uploadDocument = (req, res, next) => {
  upload(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        success: false,
        message: `Document exceeds the ${Math.round(MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024))} MB upload limit.`,
      });
    }
    if (error.code === 'UNSUPPORTED_DOCUMENT_TYPE') {
      return res.status(400).json({ success: false, message: error.message });
    }
    return res.status(400).json({ success: false, message: 'Invalid document upload request.' });
  });
};

module.exports = { uploadDocument };
