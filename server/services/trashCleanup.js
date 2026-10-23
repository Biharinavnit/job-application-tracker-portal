const { purgeExpiredTrash } = require('./trashService');

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

const startTrashCleanup = () => {
  let running = false;
  const runCleanup = async () => {
    if (running) return;
    running = true;
    try {
      const result = await purgeExpiredTrash();
      if (result.attachmentsPurged || result.applicationsPurged) {
        console.log('Expired trash purged.', result);
      }
    } catch (error) {
      console.error('Expired trash cleanup failed; remaining items will be retried.', error.message);
    } finally {
      running = false;
    }
  };

  void runCleanup();
  const timer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
};

module.exports = { startTrashCleanup };
