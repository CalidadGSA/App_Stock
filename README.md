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

## Deploy

Configurado para Vercel. Agregar las variables de entorno en el panel de Vercel.
