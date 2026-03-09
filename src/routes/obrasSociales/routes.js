const express = require('express');
const router = express.Router();

const { getdatos, syncdatos } = require('../../controllers/obrasSociales/controller');
const { syncState } = require('../../controllers/obrasSociales/syncdatos');

router.get('/', getdatos);
router.post('/sync', syncdatos);

router.get('/sync/progress', (req, res) => {
  const { processed, total, entity } = syncState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});

module.exports = router;