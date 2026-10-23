const express = require('express');
const router = express.Router();
const {
  getTrash,
  permanentlyDeleteTrashItem,
  restoreTrashItem,
} = require('../controllers/trashController');
const { protect, preventDemoWrites } = require('../middleware/authMiddleware');

router.use(protect, preventDemoWrites);
router.get('/', getTrash);
router.post('/:type/:id/restore', restoreTrashItem);
router.delete('/:type/:id', permanentlyDeleteTrashItem);

module.exports = router;
