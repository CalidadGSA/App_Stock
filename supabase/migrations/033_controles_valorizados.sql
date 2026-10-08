-- Valorización del control de inventario, guardada al cerrarlo.
--
-- El KPI de diferencias necesita como denominador el stock teórico **de lo que realmente se
-- controló**, no el stock total de la sucursal: si solo se contó el 30 % del padrón, comparar
-- los faltantes contra todo el stock subestima el problema.
--
-- Recorrer el detalle en cada carga del tablero no escala (≈52.000 líneas por mes), así que se
-- calcula una sola vez al cerrar el control y se guarda acá. Como ventaja, queda valorizado con
-- el costo del momento del conteo, que es más fiel que recalcularlo con el costo de hoy.
--
-- APLICAR EN SUPABASE (SQL Editor):
--   supabase/migrations/033_controles_valorizados.sql

alter table controles_inventario
  add column if not exists lineas_controladas integer,
  add column if not exists stock_controlado_costo numeric(16,2),
  add column if not exists dif_negativa_costo numeric(16,2),
  add column if not exists dif_positiva_costo numeric(16,2),
  add column if not exists valorizado_at timestamptz;

comment on column controles_inventario.lineas_controladas is
  'Líneas contadas en el control (todas, no solo las que dieron diferencia).';
comment on column controles_inventario.stock_controlado_costo is
  'Stock teórico de lo controlado, a costo: Σ (cajas + unidades/unidadesPorCaja) × costo de lista.';
comment on column controles_inventario.dif_negativa_costo is
  'Faltantes a costo, en valor absoluto.';
comment on column controles_inventario.dif_positiva_costo is
  'Sobrantes a costo.';
comment on column controles_inventario.valorizado_at is
  'Cuándo se calcularon los valores de arriba. Null = control viejo sin valorizar.';

-- El tablero filtra por sucursal y fecha de cierre sobre los controles cerrados.
create index if not exists idx_ci_sucursal_fecha_fin_valorizado
  on controles_inventario(sucursal_id, fecha_fin)
  where estado = 'cerrado';
