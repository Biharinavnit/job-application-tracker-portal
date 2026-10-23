const fs = require('fs/promises');
const ApplicationAttachment = require('../models/ApplicationAttachment');
const JobApplication = require('../models/JobApplication');
const { getStoredPath, removeStoredFile } = require('./documentStorage');

const getRetentionDays = () => {
  const configuredDays = process.env.TRASH_RETENTION_DAYS;
  if (configuredDays === undefined || configuredDays === '') return 30;
  const days = Number(configuredDays);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    throw new Error('TRASH_RETENTION_DAYS must be an integer between 1 and 3650.');
  }
  return days;
};

const getRetentionUntil = (deletedAt = new Date()) =>
  new Date(deletedAt.getTime() + getRetentionDays() * 24 * 60 * 60 * 1000);

const fileExists = async (storedName) => {
  try {
    await fs.access(getStoredPath(storedName), fs.constants.R_OK);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
};

const purgeAttachment = async (attachmentId, userId, { force = false } = {}) => {
  const filter = { _id: attachmentId, user: userId };
  if (!force) filter.deletedAt = { $ne: null };

  const attachment = await ApplicationAttachment.findOneAndUpdate(
    filter,
    { $set: { purgePending: true } },
    { new: true }
  ).select('+storedName');
  if (!attachment) return false;

  await removeStoredFile(attachment.storedName);
  const result = await ApplicationAttachment.deleteOne({
    _id: attachment._id,
    user: userId,
    purgePending: true,
  });
  if (result.deletedCount) return true;

  const remaining = await ApplicationAttachment.exists({ _id: attachment._id, user: userId });
  return !remaining;
};

const permanentlyDeleteApplication = async (applicationId, userId) => {
  const application = await JobApplication.findOneAndUpdate(
    { _id: applicationId, user: userId, deletedAt: { $ne: null } },
    { $set: { purgePending: true } },
    { new: true }
  );
  if (!application) return false;

  const attachments = await ApplicationAttachment.find({
    application: application._id,
    user: userId,
  }).select('_id');
  for (const attachment of attachments) {
    await purgeAttachment(attachment._id, userId, { force: true });
  }

  const result = await JobApplication.deleteOne({
    _id: application._id,
    user: userId,
    purgePending: true,
  });
  if (result.deletedCount) return true;
  return !(await JobApplication.exists({ _id: application._id, user: userId }));
};

const purgeExpiredTrash = async (now = new Date()) => {
  const expiredAttachments = await ApplicationAttachment.find({
    deletedAt: { $ne: null },
    $or: [
      { retentionUntil: { $lte: now } },
      { purgePending: true },
    ],
  }).select('_id user');

  let attachmentsPurged = 0;
  for (const attachment of expiredAttachments) {
    if (await purgeAttachment(attachment._id, attachment.user)) attachmentsPurged += 1;
  }

  const expiredApplications = await JobApplication.find({
    deletedAt: { $ne: null },
    $or: [
      { retentionUntil: { $lte: now } },
      { purgePending: true },
    ],
  }).select('_id user');

  let applicationsPurged = 0;
  for (const application of expiredApplications) {
    if (await permanentlyDeleteApplication(application._id, application.user)) applicationsPurged += 1;
  }

  return { attachmentsPurged, applicationsPurged };
};

module.exports = {
  fileExists,
  getRetentionDays,
  getRetentionUntil,
  permanentlyDeleteApplication,
  purgeAttachment,
  purgeExpiredTrash,
};
