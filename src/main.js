require('dotenv').config();

const express = require('express');
const cors = require('cors');

const datosRouter = require('./routes/obrasSociales/routes');
const { ensureDatos } = require('./controllers/obrasSociales/ensureSucursales');
require('./jobs/obrasSocialesSync.job');

const app = express();

// Middlewares básicos
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());

// Healthcheck
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Rutas de sync de datos (legacy → Supabase)
app.use('/api/datos', datosRouter);

// Verificación de conexión Supabase al arrancar
ensureDatos()
  .then(() => {
    console.log('✅ Sync datos: verificación Supabase OK');
  })
  .catch((err) => {
    console.error('❌ Sync datos: error al verificar Supabase:', err);
  });

// Puerto
const PORT = parseInt(process.env.API_PORT || process.env.PORT || '4000', 10);

app.listen(PORT, () => {
  console.log(`🚀 API Express escuchando en el puerto ${PORT}`);
});

