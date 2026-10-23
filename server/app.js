const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { getTrustedProxyHops } = require('./config/trustProxy');

const app = express();

app.set('trust proxy', getTrustedProxyHops(process.env.TRUST_PROXY_HOPS));
app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '10kb' }));
app.use(morgan('dev'));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/applications', require('./routes/applicationRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/trash', require('./routes/trashRoutes'));

app.get('/', (req, res) => res.json({ message: 'Job Tracker API running ' }));

app.use((err, req, res, next) => {
  console.error('Request processing failed with status', err.statusCode || 500);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.statusCode && err.statusCode < 500 ? err.message : 'Server error',
  });
});

module.exports = app;
