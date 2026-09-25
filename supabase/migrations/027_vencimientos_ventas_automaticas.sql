-- Descuento automático de ventas en «por vencer».
-- `cantidad` sigue siendo el saldo restante; se agrega la cantidad cargada original
-- para poder recalcular el vendido acumulado de forma idempotente.
--
-- APLICAR EN SUPABASE (SQL Editor) si aún no corrió:
--   supabase/migrations/027_vencimientos_ventas_automaticas.sql
-- El modo manual de la app ya no exige estas columnas; hacen falta para reactivar
-- el sync automático (docs/VENTAS_AUTO_POR_VENCER.md).

alter table controles_vencimientos_detalle
  add column if not exists cantidad_original numeric(12,2);

-- Backfill: hasta ahora `cantidad` se decrementaba de forma destructiva al marcar vendido,
-- así que la carga original se reconstruye con el historial de ventas.
update controles_vencimientos_detalle d
set cantidad_original = coalesce(d.cantidad, 0) + coalesce(
  (
    select sum(v.cantidad_vendida)
    from vencimientos_detalle_ventas v
    where v.detalle_id = d.id
  ),
  0
)
where d.cantidad_original is null;

alter table controles_vencimientos_detalle
  add column if not exists cantidad_vendida_auto numeric(12,2) not null default 0;

alter table controles_vencimientos_detalle
  add column if not exists ventas_auto_check_at timestamptz;

-- Origen del movimiento de venta: 'manual' (histórico) / 'auto' (descuento por ventas legacy).
alter table vencimientos_detalle_ventas
  add column if not exists origen text not null default 'manual';

alter table vencimientos_detalle_ventas
  drop constraint if exists vencimientos_detalle_ventas_origen_check;

alter table vencimientos_detalle_ventas
  add constraint vencimientos_detalle_ventas_origen_check
  check (origen in ('manual', 'auto'));

create index if not exists idx_cvd_producto_vencimiento
  on controles_vencimientos_detalle(producto_id_sistema, fecha_vencimiento);

create index if not exists idx_vdv_origen on vencimientos_detalle_ventas(origen);
