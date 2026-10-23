const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') });

const sampleApplications = [
  { key: 'northstar-platform-engineer', company: 'Northstar Analytics', role: 'Platform Engineer', location: 'Remote', stage: 'Interview', source: 'LinkedIn', salaryNote: '$125k-$145k', priority: true, interviewInDays: 3 },
  { key: 'copperline-product-designer', company: 'Copperline Health', role: 'Product Designer', location: 'Austin, TX', stage: 'Phone Screen', source: 'Referral', salaryNote: '$105k-$120k', priority: true },
  { key: 'brightpath-full-stack', company: 'Brightpath Learning', role: 'Full Stack Developer', location: 'Remote', stage: 'Applied', source: 'Company Site', priority: false },
  { key: 'harborlight-data-analyst', company: 'Harborlight Finance', role: 'Data Analyst', location: 'New York, NY', stage: 'OA', source: 'LinkedIn', salaryNote: '$90k-$110k', priority: false },
  { key: 'mosaic-cloud-backend', company: 'Mosaic Cloud', role: 'Backend Engineer', location: 'Seattle, WA', stage: 'Offer', source: 'Referral', salaryNote: '$140k-$160k', priority: true },
  { key: 'wildwood-mobile', company: 'Wildwood Mobility', role: 'Mobile Engineer', location: 'Denver, CO', stage: 'Rejected', source: 'Indeed', priority: false },
  { key: 'bluepeak-frontend', company: 'Bluepeak Commerce', role: 'Frontend Engineer', location: 'Chicago, IL', stage: 'Applied', source: 'Company Site', priority: false },
  { key: 'fieldnote-product-manager', company: 'Fieldnote Systems', role: 'Associate Product Manager', location: 'Boston, MA', stage: 'Saved', source: 'LinkedIn', salaryNote: '$95k-$115k', priority: false },
  { key: 'redwood-security', company: 'Redwood Security', role: 'Application Security Engineer', location: 'Remote', stage: 'Interview', source: 'Referral', priority: true, interviewInDays: 7 },
  { key: 'cloudharbor-devops', company: 'Cloudharbor', role: 'DevOps Engineer', location: 'Portland, OR', stage: 'Applied', source: 'Indeed', salaryNote: '$115k-$135k', priority: false },
];

const getDemoConfiguration = (env = process.env) => {
  const email = typeof env.DEMO_USER_EMAIL === 'string' ? env.DEMO_USER_EMAIL.trim().toLowerCase() : '';
  const password = env.DEMO_USER_PASSWORD;
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('Set DEMO_USER_EMAIL to a valid email address in server/.env.');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new Error('Set DEMO_USER_PASSWORD to a password of at least 6 characters in server/.env.');
  }
  return { email, password };
};

const seedDemoData = async () => {
  const { email, password } = getDemoConfiguration();
  const User = require('../models/User');
  const JobApplication = require('../models/JobApplication');

  let user = await User.findOne({ email });
  if (user && !user.isDemo) {
    throw new Error('DEMO_USER_EMAIL belongs to a non-demo account; refusing to modify it.');
  }
  const createdUser = !user;
  if (!user) {
    user = await User.create({
      name: 'JobTrack Demo',
      email,
      password,
      isDemo: true,
    });
  }

  const now = Date.now();
  const operations = sampleApplications.map((application, index) => {
    const { key, interviewInDays, ...fields } = application;
    const appliedDate = fields.stage === 'Saved'
      ? null
      : new Date(now - (index + 2) * 24 * 60 * 60 * 1000);
    return {
      updateOne: {
        filter: { user: user._id, demoSeedKey: key },
        update: {
          $setOnInsert: {
            ...fields,
            user: user._id,
            demoSeedKey: key,
            appliedDate,
            interviewDate: interviewInDays
              ? new Date(now + interviewInDays * 24 * 60 * 60 * 1000)
              : null,
            deadlineDate: null,
            statusNote: fields.stage === 'Offer' ? 'Review the written offer and benefits.' : '',
            notes: `Sample demo record for ${fields.company}. No real applicant data.`,
            tags: ['demo', fields.source.toLowerCase().replaceAll(' ', '-')],
          },
        },
        upsert: true,
      },
    };
  });
  const result = await JobApplication.bulkWrite(operations, { ordered: true });

  return {
    email: user.email,
    createdUser,
    applicationsInserted: result.upsertedCount,
    applicationsAvailable: sampleApplications.length,
  };
};

if (require.main === module) {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('Set MONGO_URI in server/.env before seeding the demo account.');
    process.exitCode = 1;
  } else {
    mongoose.connect(mongoUri)
      .then(seedDemoData)
      .then((result) => {
        console.log(`Demo account ready: ${result.email}`);
        console.log(`Sample applications added: ${result.applicationsInserted}`);
      })
      .catch((error) => {
        console.error(`Demo seed failed: ${error.message}`);
        process.exitCode = 1;
      })
      .finally(() => mongoose.disconnect());
  }
}

module.exports = { getDemoConfiguration, seedDemoData };
