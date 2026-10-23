// models/JobApplication.js — Mongoose Job Application Schema

const mongoose = require('mongoose');

const STAGES = ['Saved', 'Applied', 'OA', 'Phone Screen', 'Interview', 'Offer', 'Rejected', 'Withdrawn', 'Accepted'];

const JobApplicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    demoSeedKey: {
      type: String,
      select: false,
      immutable: true,
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
    purgePending: {
      type: Boolean,
      default: false,
      select: false,
    },
    // ── Company & Role ───────────────────────────────────────
    company: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
    },
    role: {
      type: String,
      required: [true, 'Role / Job Title is required'],
      trim: true,
    },
    location: {
      type: String,
      trim: true,
      default: '',
    },
    jobUrl: {
      type: String,
      trim: true,
      default: '',
    },
    source: {
      type: String,
      enum: ['LinkedIn', 'Indeed', 'Company Site', 'Referral', 'Naukri', 'Internshala', 'Other'],
      default: 'Other',
    },
    salaryNote: {
      type: String,
      trim: true,
      default: '',
    },

    // ── Stage & Status ────────────────────────────────────────
    stage: {
      type: String,
      enum: STAGES,
      default: 'Saved',
    },
    statusNote: {
      type: String,
      trim: true,
      default: '',
    },

    // ── Dates ─────────────────────────────────────────────────
    appliedDate: {
      type: Date,
      default: null,
    },
    interviewDate: {
      type: Date,
      default: null,
    },
    deadlineDate: {
      type: Date,
      default: null,
    },

    // ── Notes / Tags ──────────────────────────────────────────
    notes: {
      type: String,
      default: '',
    },
    tags: {
      type: [String],
      default: [],
    },

    // ── Priority flag ─────────────────────────────────────────
    priority: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Text index for search
JobApplicationSchema.index({ company: 'text', role: 'text', location: 'text' });
JobApplicationSchema.index(
  { user: 1, demoSeedKey: 1 },
  { unique: true, partialFilterExpression: { demoSeedKey: { $type: 'string' } } }
);

module.exports = mongoose.model('JobApplication', JobApplicationSchema);