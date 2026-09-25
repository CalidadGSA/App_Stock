-- Snapshot mensual del stock valorizado por sucursal (KPIs mensuales).
-- onze_center.stock solo tiene el stock ACTUAL: para que el KPI «diferencias vs stock valorizado»
-- de meses pasados no use el stock de hoy, se guarda el último valor visto de cada mes.
-- Se actualiza cada vez que alguien abre la vista KPIs en el mes en curso y por el cron diario
-- (scripts/run-inventario-cierre-once.cjs), que a las 00:00 del día 1 cierra el mes anterior.
--
-- APLICAR EN SUPABASE (SQL Editor):
--   supabase/migrations/028_kpi_stock_valorizado_mensual.sql

create table if not exists kpi_stock_valorizado_mensual (
  sucursal_id  integer     not null,
  ym           char(7)     not null,              -- 'YYYY-MM' (calendario Argentina)
  valor_costo  numeric(16,2) not null default 0,  -- a costo de lista (medicamentos.Costo)
  valor_ppp    numeric(16,2) not null default 0,  -- a costo PPP (stock.costoPPP → UltimoCosto → Costo)
  cajas        numeric(14,2) not null default 0,
  productos    integer     not null default 0,
  tomado_at    timestamptz not null default now(),
  primary key (sucursal_id, ym)
);

create index if not exists idx_kpi_stock_val_ym on kpi_stock_valorizado_mensual(ym);

-- Índices para el KPI de diferencias (controles cerrados del mes → detalle con diferencia).
create index if not exists idx_ci_sucursal_estado_fecha_fin
  on controles_inventario(sucursal_id, estado, fecha_fin);
create index if not exists idx_cid_control_con_diferencias
  on controles_inventario_detalle(control_id)
  where con_diferencias = 1;
