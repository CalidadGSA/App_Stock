-- Snapshot mensual del avance de inventario por sucursal (KPI «esperado vs real»).
-- `base_productos.vecesinventariado` solo refleja el estado de HOY: para que el KPI de un mes
-- pasado no muestre el avance actual, se guarda el último valor visto de cada mes.
-- Se actualiza cada vez que alguien abre la vista KPIs en el mes en curso y por el cron diario
-- (scripts/run-inventario-cierre-once.cjs), que a las 00:00 del día 1 cierra el mes anterior.
--
-- APLICAR EN SUPABASE (SQL Editor):
--   supabase/migrations/029_kpi_avance_inventario_mensual.sql

create table if not exists kpi_avance_inventario_mensual (
  sucursal_id   integer     not null,
  ym            char(7)     not null,            -- 'YYYY-MM' (calendario Argentina)
  trimestre     text        not null,            -- 'Q42026'
  total         integer     not null default 0,  -- meta del trimestre (psicos: productos × vueltas)
  inventariados integer     not null default 0,
  por_macro     jsonb       not null default '[]'::jsonb,
  tomado_at     timestamptz not null default now(),
  primary key (sucursal_id, ym)
);

create index if not exists idx_kpi_avance_inv_ym on kpi_avance_inventario_mensual(ym);
create index if not exists idx_kpi_avance_inv_trimestre on kpi_avance_inventario_mensual(trimestre);

comment on table kpi_avance_inventario_mensual is
  'Avance de inventario del mes por sucursal, para comparar contra el avance esperado (días hábiles transcurridos del trimestre).';
comment on column kpi_avance_inventario_mensual.por_macro is
  'Arreglo [{macro, total, inventariados, pendientes, porcentaje}] tal como lo calcula la app.';
