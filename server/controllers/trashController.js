const mongoose = require('mongoose');
const ApplicationAttachment = require('../models/ApplicationAttachment');
const JobApplication = require('../models/JobApplication');
const {
  fileExists,
  getRetentionDays,
  getRetentionUntil,
  permanentlyDeleteApplication,
  purgeAttachment,
} = require('../services/trashService');

const getTrash = async (req, res) => {
  try {
    const [applications, attachments] = await Promise.all([
      JobApplication.find({ user: req.user._id, deletedAt: { $ne: null } })
        .select('+purgePending')
        .sort({ deletedAt: -1 })
        .lean(),
      ApplicationAttachment.find({ user: req.user._id, deletedAt: { $ne: null } })
        .select('+purgePending')
        .sort({ deletedAt: -1 })
        .lean(),
    ]);

    const parentIds = [...new Set(attachments.map((attachment) => attachment.application.toString()))];
    const parents = await JobApplication.find({ _id: { $in: parentIds }, user: req.user._id })
      .select('company role deletedAt')
      .lean();
    const parentsById = new Map(parents.map((application) => [application._id.toString(), application]));
    const now = Date.now();
    const toTrashItem = (item, type, name, parent = null) => {
      const retentionUntil = item.retentionUntil || getRetentionUntil(item.deletedAt);
      const remainingMs = Math.max(0, retentionUntil.getTime() - now);
      const daysRemaining = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      return {
        id: item._id,
        type,
        name,
        applicationId: parent ? parent._id : undefined,
        applicationName: parent ? `${parent.company} · ${parent.role}` : undefined,
        deletedAt: item.deletedAt,
        retentionUntil,
        daysRemaining,
        retentionStatus: item.purgePending
          ? 'Purge pending'
          : daysRemaining === 0
            ? 'Expired'
            : `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining`,
        purgePending: item.purgePending,
      };
    };

    const items = [
      ...applications.map((application) => toTrashItem(
        application,
        'application',
        `${application.company} · ${application.role}`
      )),
      ...attachments.map((attachment) => toTrashItem(
        attachment,
        'document',
        attachment.originalName,
        parentsById.get(attachment.application.toString()) || null
      )),
    ].sort((left, right) => new Date(right.deletedAt) - new Date(left.deletedAt));

    return res.json({
      success: true,
      retentionDays: getRetentionDays(),
      count: items.length,
      data: items,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Unable to load Recently Deleted.',
    });
  }
};

const restoreApplication = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid application ID.' });
  }

  try {
    const application = await JobApplication.findOne({
      _id: req.params.id,
      user: req.user._id,
      deletedAt: { $ne: null },
    }).select('+purgePending');
    if (!application) {
      return res.status(404).json({ success: false, message: 'Recently deleted application not found.' });
    }
    if (application.purgePending) {
      return res.status(409).json({ success: false, message: 'This application is being permanently deleted and cannot be restored.' });
    }
    if (!application.retentionUntil || application.retentionUntil <= new Date()) {
      return res.status(410).json({ success: false, message: 'The retention period has expired for this application.' });
    }

    const deletedAttachments = await ApplicationAttachment.find({
      application: application._id,
      user: req.user._id,
      deletedAt: { $ne: null },
      deletedWithApplication: true,
    }).select('_id deletedAt retentionUntil +storedName +purgePending');
    const restorableAttachmentIds = [];
    const missingAttachmentIds = [];
    for (const attachment of deletedAttachments) {
      if (attachment.retentionUntil > new Date() && await fileExists(attachment.storedName)) {
        restorableAttachmentIds.push(attachment._id);
      } else {
        missingAttachmentIds.push(attachment._id);
      }
    }

    const restored = await JobApplication.updateOne(
      {
        _id: application._id,
        user: req.user._id,
        deletedAt: application.deletedAt,
        purgePending: { $ne: true },
        retentionUntil: { $gt: new Date() },
      },
      {
        $set: { purgePending: false },
        $unset: { deletedAt: 1, retentionUntil: 1 },
      }
    );
    if (!restored.modifiedCount) {
      return res.status(409).json({ success: false, message: 'Application could not be restored. Refresh Recently Deleted and try again.' });
    }

    if (restorableAttachmentIds.length) {
      await ApplicationAttachment.updateMany(
        {
          _id: { $in: restorableAttachmentIds },
          user: req.user._id,
          application: application._id,
          deletedAt: { $ne: null },
          purgePending: { $ne: true },
        },
        {
          $set: { deletedWithApplication: false, purgePending: false },
          $unset: { deletedAt: 1, retentionUntil: 1 },
        }
      );
    }

    return res.json({
      success: true,
      message: 'Application restored.',
      warnings: missingAttachmentIds.length
        ? [`${missingAttachmentIds.length} attached document(s) could not be restored because the file is missing or its retention period expired.`]
        : [],
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to restore the application.' });
  }
};

const restoreDocument = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid document ID.' });
  }

  try {
    const attachment = await ApplicationAttachment.findOne({
      _id: req.params.id,
      user: req.user._id,
      deletedAt: { $ne: null },
    }).select('+storedName +purgePending');
    if (!attachment) {
      return res.status(404).json({ success: false, message: 'Recently deleted document not found.' });
    }
    if (attachment.purgePending) {
      return res.status(409).json({ success: false, message: 'This document is being permanently deleted and cannot be restored.' });
    }
    if (!attachment.retentionUntil || attachment.retentionUntil <= new Date()) {
      return res.status(410).json({ success: false, message: 'The retention period has expired for this document.' });
    }

    const application = await JobApplication.findOne({
      _id: attachment.application,
      user: req.user._id,
      deletedAt: null,
    }).select('_id');
    if (!application) {
      return res.status(409).json({
        success: false,
        message: 'Restore the parent application first, then restore this document.',
      });
    }
    if (!await fileExists(attachment.storedName)) {
      return res.status(410).json({ success: false, message: 'The document file is missing and cannot be restored.' });
    }

    const restored = await ApplicationAttachment.updateOne(
      {
        _id: attachment._id,
        user: req.user._id,
        application: application._id,
        deletedAt: attachment.deletedAt,
        purgePending: { $ne: true },
        retentionUntil: { $gt: new Date() },
      },
      {
        $set: { deletedWithApplication: false, purgePending: false },
        $unset: { deletedAt: 1, retentionUntil: 1 },
      }
    );
    if (!restored.modifiedCount) {
      return res.status(409).json({ success: false, message: 'Document could not be restored. Refresh Recently Deleted and try again.' });
    }

    return res.json({ success: true, message: 'Document restored.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Unable to restore the document.' });
  }
};

const permanentlyDeleteTrashItem = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ success: false, message: 'Invalid trash item ID.' });
  }

  try {
    let deleted;
    if (req.params.type === 'application') {
      deleted = await permanentlyDeleteApplication(req.params.id, req.user._id);
    } else if (req.params.type === 'document') {
      deleted = await purgeAttachment(req.params.id, req.user._id);
    } else {
      return res.status(400).json({ success: false, message: 'Unsupported trash item type.' });
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Recently deleted item not found.' });
    }
    return res.json({ success: true, message: 'Item permanently deleted.' });
  } catch {
    return res.status(500).json({
      success: false,
      message: 'Permanent deletion is incomplete. The item remains in Recently Deleted and can be retried.',
    });
  }
};

const restoreTrashItem = (req, res) => {
  if (req.params.type === 'application') return restoreApplication(req, res);
  if (req.params.type === 'document') return restoreDocument(req, res);
  return res.status(400).json({ success: false, message: 'Unsupported trash item type.' });
};

module.exports = { getTrash, permanentlyDeleteTrashItem, restoreTrashItem };
