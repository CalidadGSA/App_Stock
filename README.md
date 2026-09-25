# GestiónStock Farmacia

App web PWA para control de inventario y vencimientos en farmacias.

## Stack

- **Frontend/Backend**: Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- **Base de datos propia**: Supabase (Postgres)
- **Autenticación**: Supabase Auth
- **Escáner**: Input USB/PDA + cámara opcional (@zxing/browser)

## Setup

### 1. Variables de entorno

```bash
cp .env.local.example .env.local
# Completar con tus claves de Supabase
```

### 2. Base de datos Supabase

Ejecutar en el SQL Editor de tu proyecto Supabase:

```sql
-- 1. Crear schema
\i supabase/schema.sql

-- 2. Datos de prueba (opcional)
\i supabase/seed.sql
```

### 3. Instalar y correr

```bash
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000)

## Estructura principal

```
src/
  app/
    (auth)/login/       ← Pantalla de login
    (app)/
      sucursal/         ← Selección de sucursal
      dashboard/        ← Dashboard con KPIs
      inventario/[id]/  ← Control de inventario (escaneo + detalles)
      vencimientos/[id]/← Control de vencimientos (escaneo + fechas)
    api/                ← API routes (auth, sucursales, productos, inventario, vencimientos, dashboard)
  lib/
    supabase/           ← Clientes browser/server
    legacy-db/          ← Integración con base del sistema actual (mock/mssql/postgres)
  components/
    BarcodeScanner.tsx  ← Escáner (input USB + cámara)
    Navbar.tsx
    ui/                 ← Componentes UI base
  types/                ← Tipos TypeScript
supabase/
  schema.sql            ← Esquema completo de la base
  seed.sql              ← Datos de prueba
```

## Conexión a base legacy

Configurar en `.env.local`:

```
LEGACY_DB_TYPE=mock       # 'mock' para pruebas, 'mssql' para SQL Server, 'postgres' para Postgres
LEGACY_DB_HOST=...
LEGACY_DB_PORT=1433
LEGACY_DB_NAME=...
LEGACY_DB_USER=...
LEGACY_DB_PASSWORD=...
```

Adaptar las queries SQL en `src/lib/legacy-db/productos.ts` según el esquema de tu sistema.

### Padron externo para descuentos

Para la configuración de descuentos (rubro Perfumería), la app consulta un Postgres externo (`padron_final`).
Configurar en `.env.local`:

```
# Opción recomendada
PADRON_DB_URL=postgresql://usuario:password@host:puerto/base

# O por campos
PADRON_DB_HOST=...
PADRON_DB_PORT=25060
PADRON_DB_NAME=abastecimiento
PADRON_DB_USER=...
PADRON_DB_PASSWORD=...
PADRON_DB_SSL=require
# Recomendado: verificar el certificado del servidor (PEM inline o ruta al .crt de la CA)
PADRON_DB_SSL_CA=
```

### Sync de `padron_final` (botón en Padrón productos)

Dispara el cron de **abastecimiento-gsa** (`/api/abastecimiento/cron/padron-sync`). En `.env.local`:

```
PADRON_SYNC_BASE_URL=https://compras.farmagsa.com.ar
PADRON_SYNC_CRON_SECRET=mismo_valor_que_CRON_SECRET_de_abastecimiento
```

## KPIs mensuales

`General → KPIs mensuales` (todos los usuarios): diferencias de inventario valorizadas vs stock valorizado, y
bajas/altas de stock por motivo vs facturación neta, leídas de onze_center (`stock_operaciones*`, `factcabecera`,
`factlineas`, `stock`). Requiere la migración `supabase/migrations/028_kpi_stock_valorizado_mensual.sql`
(snapshot mensual del stock valorizado + índices). El snapshot se actualiza al abrir la vista en el mes en curso y
en el cron diario de cierre de inventarios (a las 00:00 del día 1 fija el valor del mes anterior).

## Cron de cierre / snapshot KPIs

El cierre automático de inventarios abiertos (> `INVENTARIO_CIERRE_HORAS`, default 168 h) y el snapshot mensual
del stock valorizado corren juntos, todos los días a las 00:00 Argentina (`INVENTARIO_CIERRE_CRON`, default `0 0 * * *`).
**No es una tarea del sistema operativo**: es `node-cron` dentro del proceso de la app.

- **PM2 (VPS, recomendado)**: `pm2 start ecosystem.config.cjs` → `scripts/pm2-start-web.cjs` registra el cron al arrancar.
  Verificar con `pm2 logs gestionstock --lines 200 | grep -i "cron cierre"` (tiene que aparecer "Próximo cierre automático").
- **Sin PM2** (`npm run start` / `npm run dev`): lo registra `instrumentation.ts` al levantar Next; solo corre mientras la app esté abierta.
- **Si la app no queda 24/7**: programarlo en el SO llamando a `npm run inventario:cierre` (corre una vez y termina).
  - Windows: `powershell -ExecutionPolicy Bypass -File scripts\registrar-tarea-cierre-windows.ps1` (como administrador; log en `logs\cierre-inventarios.log`).
  - Linux: `crontab -e` → `0 0 * * * cd /ruta/gestionstock && npm run inventario:cierre >> logs/cierre.log 2>&1`.
- Diagnóstico: `npm run inventario:cierre:diagnose`. Corrida manual inmediata: `npm run inventario:cierre`.

## Sesión y seguridad

- La sesión del operador (`operador_session`) y la sucursal activa (`sucursal_session`) son cookies
  firmadas con HMAC (`AUTH_SECRET` o, si falta, `SUPABASE_SERVICE_ROLE_KEY`). La sucursal queda atada
  al operador que la eligió: no se puede cambiar de sucursal editando cookies.
  Al desplegar esta versión las sesiones anteriores piden volver a elegir sucursal (una sola vez).
- Login con límite de intentos fallidos por IP y por operador (`LOGIN_RATE_LIMIT_*`, ver `.env.local.example`).
  El contador vive en memoria del proceso (PM2 con una instancia).

## Deploy

Configurado para Vercel. Agregar las variables de entorno en el panel de Vercel.

## Documentacion

- Documentacion tecnica: `docs/DOCUMENTACION_PROYECTO.md`
- Manual de usuario: `docs/MANUAL_USUARIO.md`
