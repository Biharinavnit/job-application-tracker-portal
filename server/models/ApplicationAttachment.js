const mongoose = require('mongoose');

const ApplicationAttachmentSchema = new mongoose.Schema(
  {
    application: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'JobApplication',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    originalName: {
      type: String,
      required: true,
      maxlength: 160,
    },
    storedName: {
      type: String,
      required: true,
      select: false,
    },
    documentType: {
      type: String,
      enum: ['pdf', 'docx'],
      required: true,
    },
    mimeType: {
      type: String,
      enum: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      required: true,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
    sha256: {
      type: String,
      required: true,
      select: false,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
    retentionUntil: {
      type: Date,
      default: null,
    },
    deletedWithApplication: {
      type: Boolean,
      default: false,
    },
    purgePending: {
      type: Boolean,
      default: false,
      select: false,
    },
  },
  { timestamps: true }
);

ApplicationAttachmentSchema.index({ application: 1, sha256: 1 }, { unique: true });
ApplicationAttachmentSchema.index({ user: 1, deletedAt: 1, retentionUntil: 1 });

module.exports = mongoose.model('ApplicationAttachment', ApplicationAttachmentSchema);
