const express = require('express');
const router = express.Router();

const {
  getdatos,
  getdatosExternos,
  syncdatos,
  getSyncDebug,
} = require('../../controllers/obrasSociales/controller');
const { syncState } = require('../../controllers/obrasSociales/syncdatos');
const {
  getoperadores,
  syncoperadores,
} = require('../../controllers/obrasSociales/controller');
const {
  syncOperadoresState,
} = require('../../controllers/obrasSociales/syncoperadores');
const {
} = require('../../controllers/obrasSociales/controller');
const {
} = require('../../controllers/obrasSociales/controller');
const {
} = require('../../controllers/obrasSociales/controller');
const {
} = require('../../controllers/obrasSociales/controller');
const {
} = require('../../controllers/obrasSociales/controller');
const {
  getstock,
  syncstock,
} = require('../../controllers/obrasSociales/controller');
const {
  syncStockState,
} = require('../../controllers/obrasSociales/syncstock');
const {
  syncusuariosquantio,
  syncproductosquantio,
} = require('../../controllers/obrasSociales/controller');

router.get('/', getdatos);
router.post('/sync', syncdatos);
router.get('/externos', getdatosExternos);

router.get('/sync/progress', (req, res) => {
  const { processed, total, entity } = syncState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});

// Vista temporal para entender sync manual / programada
router.get('/sync/debug', getSyncDebug);

// Operadores
router.get('/operadores', getoperadores);
router.post('/operadores/sync', syncoperadores);
router.get('/operadores/sync/progress', (req, res) => {
  const { processed, total, entity } = syncOperadoresState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});





// Stock
router.get('/stock', getstock);
router.post('/stock/sync', syncstock);
router.get('/stock/sync/progress', (req, res) => {
  const { processed, total, entity } = syncStockState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});

// Droguería Quantio: usuarios y productos
router.post('/usuarios-quantio/sync', syncusuariosquantio);
router.post('/productos-quantio/sync', syncproductosquantio);



module.exports = router;