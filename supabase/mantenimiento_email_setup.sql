-- =============================================================================
-- Modo mantenimiento + throttle de emails del cron Onze
-- (ver /api/n8n/onze-health-mail-context y /api/admin/maintenance/quick-action)
-- Ejecutá este script en Supabase → SQL Editor. Es idempotente.
-- =============================================================================

-- Fila única: is_active 1 = mantenimiento ON, 0 = OFF
create table if not exists modo_mantenimiento (
  id         integer primary key default 1,
  is_active  smallint not null default 1,
  updated_at timestamp without time zone not null default now(),
  constraint modo_mantenimiento_singleton_chk check (id = 1),
  constraint modo_mantenimiento_active_chk check (is_active in (0, 1))
);

insert into modo_mantenimiento (id, is_active)
values (1, 0)
on conflict (id) do nothing;

-- Evita spam: una alerta cada N minutos (lo usa el backend con upsert)
create table if not exists onze_health_cron_state (
  id smallint primary key default 1,
  last_maintenance_alert_at timestamptz,
  last_recovery_alert_at timestamptz,
  constraint onze_health_cron_state_singleton_chk check (id = 1)
);

insert into onze_health_cron_state (id) values (1) on conflict (id) do nothing;

create or replace function set_modo_mantenimiento_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_modo_mantenimiento_updated_at on modo_mantenimiento;
create trigger trg_modo_mantenimiento_updated_at
before update on modo_mantenimiento
for each row
execute function set_modo_mantenimiento_updated_at();

-- El backend usa SUPABASE_SERVICE_ROLE_KEY (bypass RLS). Anon no debe leer/escribir esto.
alter table modo_mantenimiento enable row level security;
