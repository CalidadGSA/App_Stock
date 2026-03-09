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
  getmedicamentos,
  syncmedicamentos,
} = require('../../controllers/obrasSociales/controller');
const {
  syncMedicamentosState,
} = require('../../controllers/obrasSociales/syncmedicamentos');
const {
  getrubros,
  syncrubros,
} = require('../../controllers/obrasSociales/controller');
const {
  syncRubrosState,
} = require('../../controllers/obrasSociales/syncrubros');
const {
  getsubrubros,
  syncsubrubros,
} = require('../../controllers/obrasSociales/controller');
const {
  syncSubrubrosState,
} = require('../../controllers/obrasSociales/syncsubrubros');
const {
  getcategorias,
  synccategorias,
} = require('../../controllers/obrasSociales/controller');
const {
  syncCategoriasState,
} = require('../../controllers/obrasSociales/synccategorias');
const {
  getpsicofarmacos,
  syncpsicofarmacos,
} = require('../../controllers/obrasSociales/controller');
const {
  syncPsicofarmacosState,
} = require('../../controllers/obrasSociales/syncpsicofarmacos');

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

// Medicamentos
router.get('/medicamentos', getmedicamentos);
router.post('/medicamentos/sync', syncmedicamentos);
router.get('/medicamentos/sync/progress', (req, res) => {
  const { processed, total, entity } = syncMedicamentosState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});

// Rubros
router.get('/rubros', getrubros);
router.post('/rubros/sync', syncrubros);
router.get('/rubros/sync/progress', (req, res) => {
  const { processed, total, entity } = syncRubrosState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});

// Subrubros
router.get('/subrubros', getsubrubros);
router.post('/subrubros/sync', syncsubrubros);
router.get('/subrubros/sync/progress', (req, res) => {
  const { processed, total, entity } = syncSubrubrosState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});

// Categorias
router.get('/categorias', getcategorias);
router.post('/categorias/sync', synccategorias);
router.get('/categorias/sync/progress', (req, res) => {
  const { processed, total, entity } = syncCategoriasState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});

// Psicofarmacos
router.get('/psicofarmacos', getpsicofarmacos);
router.post('/psicofarmacos/sync', syncpsicofarmacos);
router.get('/psicofarmacos/sync/progress', (req, res) => {
  const { processed, total, entity } = syncPsicofarmacosState;
  res.json({
    processed,
    total,
    entity: entity || null,
  });
});

module.exports = router;