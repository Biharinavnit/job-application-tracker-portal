// ============================================================
// Job Application Tracker - Express Server Entry Point
// ============================================================

const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.join(__dirname, '.env') });

const connectDB = require('./config/db');
const app = require('./app');
const { startTrashCleanup } = require('./services/trashCleanup');

const PORT = process.env.PORT || 5000;
connectDB().then(() => {
  startTrashCleanup();
  app.listen(PORT, () => console.log(` Server running on port ${PORT}`));
});