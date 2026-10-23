// routes/applicationRoutes.js
const express = require('express');
const router = express.Router();
const {
  getApplications, getApplication, createApplication,
  updateApplication, deleteApplication, updateStage,
} = require('../controllers/applicationController');
const {
  ensureApplicationOwner,
  listAttachments,
  createAttachment,
  createPreviewSession,
  clearPreviewSession,
  downloadAttachment,
  viewAttachment,
  deleteAttachment,
} = require('../controllers/attachmentController');
const { uploadDocument } = require('../middleware/documentUpload');
const { protect, protectPdfPreview, preventDemoWrites } = require('../middleware/authMiddleware');

router.post('/:id/attachments/:attachmentId/preview-session',
  protect, ensureApplicationOwner, createPreviewSession);
router.delete('/:id/attachments/:attachmentId/preview-session',
  protect, ensureApplicationOwner, clearPreviewSession);
router.get('/:id/attachments/:attachmentId/view',
  protectPdfPreview, ensureApplicationOwner, viewAttachment);

router.use(protect); // Remaining routes require the regular bearer token.
router.use(preventDemoWrites);

router.route('/')
  .get(getApplications)
  .post(createApplication);

router.route('/:id')
  .get(getApplication)
  .put(updateApplication)
  .delete(deleteApplication);

router.patch('/:id/stage', updateStage);
router.get('/:id/attachments', ensureApplicationOwner, listAttachments);
router.post('/:id/attachments', ensureApplicationOwner, uploadDocument, createAttachment);
router.get('/:id/attachments/:attachmentId', ensureApplicationOwner, downloadAttachment);
router.delete('/:id/attachments/:attachmentId', ensureApplicationOwner, deleteAttachment);

module.exports = router;