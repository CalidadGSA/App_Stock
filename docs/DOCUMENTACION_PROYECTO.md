# Documentacion del proyecto - GestionStock Farmacia

## 1) Objetivo

GestionStock es una aplicacion web para farmacias orientada a:

- control de inventarios (diario, ocasional y auditoria),
- control de vencimientos (por vencer, vencidos, devoluciones, descuentos),
- seguimiento de diferencias y ajustes.

La aplicacion esta pensada para operar con escaner (USB/PDA) y camara, y para integrarse con bases externas de stock/productos.

## 2) Alcance funcional

### Inventario

- Creacion y gestion de inventarios:
  - diario (por categoria macro),
  - ocasional (sucursal o auditoria),
  - auditoria.
- Recuento por producto con stock sistema vs stock real.
- Gestion de diferencias y verificacion de items.
- Resumen de diferencias y exportaciones para ajustes.

### Vencimientos

- Gestion de productos por vencer y vencidos.
- Marcado de vendidos (incluye ventas parciales por cantidad).
- Devoluciones y consulta de historial de devoluciones.
- Vista de descuentos por fecha de vencimiento y reglas configurables.

### Dashboard

- KPIs operativos de inventario y vencimientos.
- Listados recientes de controles.
- Navegacion a vistas detalladas desde los KPI.

## 3) Arquitectura tecnica

- **Framework principal**: Next.js 16 (App Router) + React 19 + TypeScript.
- **UI**: Tailwind CSS v4 + componentes UI propios.
- **Backend BFF**: API Routes de Next.js en `src/app/api`.
- **Base principal**: Supabase/PostgreSQL.
- **Integraciones externas**:
  - MySQL (stock y datos legacy),
  - Quantio (sincronizaciones y codebars secundarios, segun endpoints de datos).
- **Escaneo**: `@zxing/browser` + captura por teclado para lectores tipo HID.

## 4) Estructura de carpetas relevante

```text
src/
  app/
    (auth)/login/                 # Login
    (app)/dashboard/              # Dashboard y KPIs
    (app)/inventario/             # UI de inventarios
    (app)/vencimientos/           # UI de vencimientos
    api/                          # Endpoints BFF (Next API routes)
  components/                     # Componentes de UI y scanner
  lib/                            # Utilidades, auth, supabase, integraciones
  types/                          # Tipos TypeScript compartidos
supabase/
  schema.sql                      # Esquema SQL principal
docs/
  DOCUMENTACION_PROYECTO.md       # Este documento
  MANUAL_USUARIO.md               # Manual funcional para usuarios
```

## 5) Modelo de datos (alto nivel)

Tablas y entidades importantes:

- `controles_inventario`: cabecera de inventarios.
- `controles_inventario_detalle`: lineas por producto inventariado.
- `controles_vencimientos`: cabecera de controles de vencimiento.
- `controles_vencimientos_detalle`: lineas por producto/fecha de vencimiento.
- `ajustes` / `ajustes_detalle`: historico de exportaciones/ajustes.
- `base_productos`: base de asignacion para inventario diario por trimestre/categoria.
- `cantidad_inventario`: parametrizacion de cantidad diaria por sucursal/categoria/trimestre.
- `medicamentos`: maestro de productos y atributos (fraccionable, refrigeracion, codebars).
- `productoscodebars`: codebars secundarios por producto.

## 6) Reglas de negocio clave

- Inventario diario requiere seleccion de categoria macro.
- Validaciones de acceso segun rol y sucursal.
- En recuento, si cambia el stock sistema antes de confirmar, se bloquea confirmacion y se refresca el stock mostrado.
- En auditoria se cargan solo items con diferencias pendientes segun flags/estado.
- En vencimientos:
  - filtros por rango de dias,
  - manejo de productos vendidos/devoluciones sin borrar trazabilidad historica.

## 7) Variables de entorno

Archivo local: `.env.local`.

Grupos de variables esperadas:

- Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- Base legacy/MySQL.
- Datos de conexiones externas adicionales (ej. Quantio).

Importante: **no versionar credenciales reales**.

## 8) Scripts de desarrollo

- `npm run dev`: desarrollo web Next.js.
- `npm run build`: build de produccion.
- `npm run start`: correr build en modo produccion.
- `npm run lint`: analisis estatico.
- `npm run dev:api`: servicios auxiliares Node (si aplica en entorno local).

## 9) Instalacion y arranque

1. Instalar dependencias:

```bash
npm install
```

2. Configurar `.env.local`.

3. Aplicar esquema SQL en Supabase (`supabase/schema.sql`).

4. Levantar entorno:

```bash
npm run dev
```

5. Abrir `http://localhost:3000`.

## 10) Despliegue

Entorno recomendado: Vercel.

- Configurar proyecto apuntando al root del repositorio.
- Comando de build: `next build` (por defecto del framework).
- Configurar todas las variables de entorno en Vercel.
- Verificar logs de build y rutas API tras deploy.

## 11) Observabilidad y soporte

Recomendado para operacion:

- monitorear errores de API en logs de Vercel/Supabase,
- validar periodicamente sincronizaciones con bases externas,
- mantener checklist de prueba post deploy:
  - login,
  - creacion de inventario diario,
  - apertura de card y recuento,
  - KPI dashboard,
  - flujo por-vencer/vencidos.

## 12) Mantenimiento

- Versionar cambios de base de datos mediante SQL/migraciones.
- Documentar cada cambio de reglas de negocio en este archivo.
- Mantener actualizado el `MANUAL_USUARIO.md` cuando cambie la UI o los flujos.

