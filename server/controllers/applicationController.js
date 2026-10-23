// controllers/applicationController.js — Full CRUD for Job Applications

const JobApplication = require('../models/JobApplication');
const ApplicationAttachment = require('../models/ApplicationAttachment');
const { getRetentionUntil } = require('../services/trashService');

// ── @GET /api/applications ────────────────────────────────────
// Supports: ?stage=Applied&search=google&sort=-createdAt&priority=true
const getApplications = async (req, res) => {
  try {
    const { stage, search, sort, priority, source } = req.query;
    const filter = { user: req.user._id, deletedAt: null };

    if (stage && stage !== 'All') filter.stage = stage;
    if (source && source !== 'All') filter.source = source;
    if (priority === 'true') filter.priority = true;

    if (search) {
      filter.$or = [
        { company: { $regex: search, $options: 'i' } },
        { role:    { $regex: search, $options: 'i' } },
        { location: { $regex: search, $options: 'i' } },
      ];
    }

    const sortOption = sort || '-createdAt';

    const applications = await JobApplication.find(filter)
      .sort(sortOption)
      .lean();

    const attachmentSummaries = applications.length
      ? await ApplicationAttachment.aggregate([
        {
          $match: {
            user: req.user._id,
            deletedAt: null,
            application: { $in: applications.map((application) => application._id) },
          },
        },
        { $sort: { createdAt: 1, _id: 1 } },
        {
          $group: {
            _id: '$application',
            attachmentCount: { $sum: 1 },
            firstAttachmentId: { $first: '$_id' },
            firstDocumentType: { $first: '$documentType' },
            firstDocumentName: { $first: '$originalName' },
          },
        },
      ])
      : [];
    const attachmentsByApplication = new Map(
      attachmentSummaries.map((summary) => [summary._id.toString(), summary])
    );
    const applicationsWithAttachments = applications.map((application) => {
      const summary = attachmentsByApplication.get(application._id.toString());
      return {
        ...application,
        attachmentCount: summary?.attachmentCount || 0,
        firstAttachmentId: summary?.firstAttachmentId || null,
        firstDocumentType: summary?.firstDocumentType || null,
        firstDocumentName: summary?.firstDocumentName || null,
      };
    });

    res.json({ success: true, count: applications.length, data: applicationsWithAttachments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── @GET /api/applications/:id ────────────────────────────────
const getApplication = async (req, res) => {
  try {
    const app = await JobApplication.findOne({
      _id: req.params.id,
      user: req.user._id,
      deletedAt: null,
    });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found' });
    res.json({ success: true, data: app });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── @POST /api/applications ───────────────────────────────────
const createApplication = async (req, res) => {
  try {
    const {
      company, role, location, jobUrl, source, salaryNote,
      stage, statusNote, appliedDate, interviewDate, deadlineDate,
      notes, tags, priority,
    } = req.body;

    if (!company || !role) {
      return res.status(400).json({ success: false, message: 'Company and role are required' });
    }

    const application = await JobApplication.create({
      user: req.user._id,
      company, role, location, jobUrl, source, salaryNote,
      stage: stage || 'Saved',
      statusNote, appliedDate, interviewDate, deadlineDate,
      notes, tags, priority,
    });

    res.status(201).json({ success: true, data: application });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── @PUT /api/applications/:id ────────────────────────────────
const updateApplication = async (req, res) => {
  try {
    const editableFields = [
      'company', 'role', 'location', 'jobUrl', 'source', 'salaryNote',
      'stage', 'statusNote', 'appliedDate', 'interviewDate', 'deadlineDate',
      'notes', 'tags', 'priority',
    ];
    const updates = Object.fromEntries(
      editableFields
        .filter((field) => Object.hasOwn(req.body, field))
        .map((field) => [field, req.body[field]])
    );
    const application = await JobApplication.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id, deletedAt: null },
      { $set: updates },
      { new: true, runValidators: true }
    );
    if (!application) return res.status(404).json({ success: false, message: 'Application not found' });
    res.json({ success: true, data: application });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── @DELETE /api/applications/:id ────────────────────────────
const deleteApplication = async (req, res) => {
  try {
    let application = await JobApplication.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).select('+purgePending');
    if (!application) return res.status(404).json({ success: false, message: 'Application not found' });
    if (application.purgePending) {
      return res.status(409).json({ success: false, message: 'Application is being permanently deleted.' });
    }
    if (!application.deletedAt) {
      const deletedAt = new Date();
      const retentionUntil = getRetentionUntil(deletedAt);
      application = await JobApplication.findOneAndUpdate(
        { _id: application._id, user: req.user._id, deletedAt: null },
        { $set: { deletedAt, retentionUntil, purgePending: false } },
        { new: true }
      );
      if (!application) {
        application = await JobApplication.findOne({ _id: req.params.id, user: req.user._id });
      }
      if (!application?.deletedAt) {
        return res.status(409).json({ success: false, message: 'Application could not be moved to Recently Deleted.' });
      }
    }

    const deletedAt = application.deletedAt;
    const retentionUntil = application.retentionUntil || getRetentionUntil(deletedAt);
    if (!application.retentionUntil) {
      await JobApplication.updateOne(
        { _id: application._id, user: req.user._id, deletedAt },
        { $set: { retentionUntil } }
      );
    }
    await ApplicationAttachment.updateMany(
      { application: application._id, user: req.user._id, deletedAt: null },
      {
        $set: {
          deletedAt,
          retentionUntil,
          deletedWithApplication: true,
          purgePending: false,
        },
      }
    );
    return res.json({ success: true, message: 'Application moved to Recently Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── @PATCH /api/applications/:id/stage ───────────────────────
const updateStage = async (req, res) => {
  try {
    const { stage, statusNote } = req.body;
    const application = await JobApplication.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id, deletedAt: null },
      { $set: { stage, statusNote } },
      { new: true, runValidators: true }
    );
    if (!application) return res.status(404).json({ success: false, message: 'Application not found' });
    res.json({ success: true, data: application });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getApplications, getApplication, createApplication, updateApplication, deleteApplication, updateStage };