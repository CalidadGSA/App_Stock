# Ventas automáticas en Por Vencer (modo desactivado)

> **Estado actual (2026-09-14):** el descuento de ventas vuelve a ser **solo manual**
> (botones **Vendido** / **Arreglar vendido**). El código del modo automático **sigue en el repo**
> pero **no se invoca** desde la UI ni desde `para-devolver`.
>
> Pasá este archivo al agente si querés **volver a activar** el modo automático.

---

## Qué hace el modo automático

Al entrar a **Por vencer** o **Para devolver**, el sistema:

1. Lee líneas activas de `controles_vencimientos_detalle` (`eliminado=0`, `devuelto=0`, `vendido=0`, `cantidad>0`).
2. Consulta ventas diarias en la base legacy:
   - Farmacias → Onze (`onze_center`): FV/TF/TK menos NC, solo cajas.
   - Droguería → Quantio (`plexdr`): signo por `comprobantes.OperacionStock` (PD/FV/TF/TK/…).
3. Asigna ventas en **FIFO** por producto: primero vencimiento más próximo; a igual vencimiento, carga más antigua.
4. Respeta tope `cantidad_original` y no pisa vendido ya registrado a mano.
5. Persiste deltas en `controles_vencimientos_detalle` y historial en `vencimientos_detalle_ventas` con `origen='auto'`.
6. Cuando `cantidad` llega a 0 → `vendido=1` (liquidado). No se vuelven a chequear líneas liquidadas.

**Quitar** (error de carga) se mantiene en ambos modos: baja cantidad / `cantidad_original` sin insertar venta.

---

## Archivos del modo automático (no borrar)

| Path | Rol |
|------|-----|
| `src/lib/vencimientos/sincronizar-ventas-auto.ts` | Orquestador `sincronizarVentasAutoSucursal` (cache ~60s, anti-concurrencia) |
| `src/lib/vencimientos/ventas-auto-asignacion.ts` | Motor FIFO puro |
| `src/lib/vencimientos/ventas-legacy-router.ts` | Elige Onze vs Quantio por sucursal |
| `src/lib/legacy-db/mysql-ventas-onze.ts` | Query ventas Onze |
| `src/lib/legacy-db/quantio-ventas.ts` | Query ventas Quantio |
| `src/lib/legacy-db/ventas-legacy-types.ts` | Tipos / helpers comunes |
| `src/app/api/vencimientos/por-vencer/sincronizar-ventas/route.ts` | `POST` (opcional `?forzar=1`) |
| `supabase/migrations/027_vencimientos_ventas_automaticas.sql` | Columnas + índice |

### Columnas (migración 027 — dejarlas)

- `controles_vencimientos_detalle.cantidad_original`
- `controles_vencimientos_detalle.cantidad_vendida_auto`
- `controles_vencimientos_detalle.ventas_auto_check_at`
- `vencimientos_detalle_ventas.origen` (`'manual' | 'auto'`, default `'manual'`)

Son compatibles con el modo manual. Al cargar un detalle nuevo ya se setea `cantidad_original`.

---

## Checklist para reactivar el automático

1. **Aplicar migración 027** en Supabase SQL Editor (`supabase/migrations/027_vencimientos_ventas_automaticas.sql`).
2. **Volver a seleccionar/escribir las columnas** en el código de listado y carga:
   - `vencimientos-por-vencer-list.ts`: incluir `cantidad_original`, `cantidad_vendida_auto`, `ventas_auto_check_at` en el `select`.
   - `vencimientos/[id]/detalles`: al insertar, setear `cantidad_original = cantidad`.
   - `reducir-carga`: al quitar, ajustar también `cantidad_original`.
   - Inserts de historial: `origen: 'auto'` / `'manual'`.
3. **Cablear sync al entrar**
   - En `src/app/(app)/vencimientos/por-vencer/page.tsx`:
     - Antes del `GET` del listado, llamar `POST /api/vencimientos/por-vencer/sincronizar-ventas`.
     - Mostrar banner de resultado (`ok` / `skipped_unavailable` / `error`).
     - Una sola sync por navegación; «Actualizar» con `?forzar=1`.
   - En `src/app/api/vencimientos/para-devolver/route.ts`:
     - Llamar `sincronizarVentasAutoSucursal` antes de armar el listado.
     - Devolver `ventas_auto` en el JSON y banner en la página.
4. **Quitar acciones manuales de venta**
   - Botones **Vendido** / **Arreglar vendido** (desktop + `PorVencerListMobile`).
   - Handlers `eliminarRegistro` / `arreglarCantidadVendida`.
   - Opcional: dejar de exponer `DELETE` en `por-vencer/route.ts` y `POST .../ajustar-vendido` (o dejarlos solo para admin).
   - Conservar **Quitar** → `POST .../reducir-carga`.
5. **Filtro / badges**
   - Filtro «solo con ventas detectadas» → `solo_con_ventas=1` filtrando por `cantidad_vendida_auto > 0`.
   - Badge «N vendidas tras la carga» con `cantidad_vendida_auto`.
6. **Manual de usuario** (`docs/MANUAL_USUARIO.md` §9–10): describir descuento automático al entrar.
7. **Env útiles**
   - `QUANTIO_VENTAS_SUCURSAL` (mapeo sucursal droguería → Quantio).
   - Timeouts Onze/Quantio si ya existen en `.env.local`.
8. **Probar**
   - Farmacia: venta Onze posterior a carga descuenta cajas.
   - Droguería: ventas Quantio con signo correcto.
   - Mismo producto en 2 controles / mismo vencimiento → FIFO por fecha de carga.
   - Legacy caído → no rompe listado; banner de aviso.

---

## Checklist para volver a solo manual (referencia)

Hecho el 2026-09-14:

- [x] Dejar de llamar sync en por-vencer UI y para-devolver API.
- [x] Restaurar `ajustar-cantidad-vendida.ts` + `POST .../ajustar-vendido`.
- [x] Restaurar `DELETE /api/vencimientos/por-vencer?id=&cantidad=` (marcar vendido).
- [x] Restaurar botones **Vendido** / **Arreglar vendido**.
- [x] Filtro «solo con ventas» basado en `cantidad_vendida_acumulada` (historial), no en auto.
- [x] Actualizar `MANUAL_USUARIO.md`.
- [x] Conservar libs/API auto + este `.md` para reactivación.

---

## Decisiones de diseño (no perder)

- Solo **cajas** (unidades sueltas no restan del control de vencimientos).
- Ventana de ventas consultada: ~400 días hacia atrás desde hoy (ver orquestador).
- Cache in-memory del resumen: ~60 s (usar `forzar=1` para saltarla).
- En Quantio la sucursal de la app droguería suele mapear a sucursal `1` en `plexdr` (revisar `getSucursalVentasQuantio`).
- No restaurar el viejo flag informativo `venta_posterior` / `vencimientos-venta-posterior.ts`: el automático lo reemplazó con descuento real.
