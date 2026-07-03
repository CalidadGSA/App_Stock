-- =============================================================================
-- Historial de períodos en modo mantenimiento (escritura desde n8n, no desde la app)
-- Ejecutá en Supabase → SQL Editor. Es idempotente.
-- =============================================================================

create table if not exists historial_modo_mantenimiento (
  id         uuid primary key default gen_random_uuid(),
  inicio_at  timestamptz not null,
  fin_at     timestamptz,
  origen     text,
  notas      text,
  created_at timestamptz not null default now(),
  constraint historial_mantenimiento_fin_despues_inicio_chk
    check (fin_at is null or fin_at >= inicio_at)
);

comment on table historial_modo_mantenimiento is
  'Lapsos en que la app estuvo en modo mantenimiento. Lo escribe n8n al activar/desactivar.';

comment on column historial_modo_mantenimiento.inicio_at is
  'Momento en que se activó el modo mantenimiento.';
comment on column historial_modo_mantenimiento.fin_at is
  'Momento en que se desactivó. NULL = período aún abierto.';
comment on column historial_modo_mantenimiento.origen is
  'Opcional: workflow n8n, cron, acción manual, etc.';
comment on column historial_modo_mantenimiento.notas is
  'Opcional: detalle del evento (ej. motivo Onze desactualizado).';

-- Período abierto (fin_at IS NULL): como máximo uno activo a la vez (n8n debe cerrar antes de abrir otro)
create unique index if not exists idx_historial_mantenimiento_periodo_abierto
  on historial_modo_mantenimiento ((true))
  where fin_at is null;

create index if not exists idx_historial_mantenimiento_inicio
  on historial_modo_mantenimiento (inicio_at desc);

create index if not exists idx_historial_mantenimiento_fin
  on historial_modo_mantenimiento (fin_at desc nulls last);

alter table historial_modo_mantenimiento enable row level security;

-- Sin políticas: solo service_role / backend / n8n con clave de servicio.
