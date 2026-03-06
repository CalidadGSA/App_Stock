const express = require('express');
const router = express.Router();

const {
  getobrasSociales,
  syncobrasSocialesManual
} = require('../../controllers/obrasSociales/controller');

const { syncState } = require('../../controllers/obrasSociales/syncobrasSociales');

router.get('/', getobrasSociales);

// 👇 NUEVO ENDPOINT
router.post('/sync', syncobrasSocialesManual);

// 👇 ENDPOINT PARA PROGRESO
router.get('/sync/progress', (req, res) => {
  const { processed, total, batchNumber } = syncState;
  res.json({
    processed,
    total,
    batch: batchNumber || 0
  });
});

module.exports = router;