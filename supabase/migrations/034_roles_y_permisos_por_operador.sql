-- Reestructuración de roles y permisos por operador.
--
-- 1) Permisos nuevos: KPIs mensuales, psicotrópicos en stock y «cerrar sesión en otros
--    dispositivos» colgaban de `dashboard.view` o no tenían permiso, así que no se podían dar
--    o quitar por separado.
-- 2) Los cuatro roles quedan con un set definido (ver ROLES_PREDETERMINADOS en
--    src/lib/auth/permissions-catalog.ts, que es la fuente de verdad).
-- 3) `operador_permisos` permite sumar o restar permisos a un operador puntual sin cambiarle
--    el rol: el permiso efectivo es (permisos del rol + concedidos − revocados).
--
-- APLICAR EN SUPABASE (SQL Editor):
--   supabase/migrations/034_roles_y_permisos_por_operador.sql

-- ── 1. Permisos nuevos ───────────────────────────────────────────────────────
insert into app_permissions (codigo, nombre, descripcion, categoria, orden) values
  ('kpis.mensuales', 'KPIs mensuales', 'Indicadores mensuales de la sucursal', 'general', 12),
  ('stock.psicotropicos', 'Psicotrópicos en stock', 'Consulta de psicotrópicos con existencia', 'general', 14),
  ('sesiones.revocar', 'Cerrar sesión en otros dispositivos', 'Invalidar las sesiones abiertas del propio usuario', 'general', 16)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  orden = excluded.orden;

-- ── 2. Roles ─────────────────────────────────────────────────────────────────
insert into app_roles (codigo, nombre) values
  ('superadmin', 'Superadministrador'),
  ('admin', 'Administrador'),
  ('responsable_de_sucursal', 'Responsable'),
  ('operador_sucursal', 'Operador de sucursal')
on conflict (codigo) do update set nombre = excluded.nombre;

-- Se reescriben las asignaciones de los cuatro roles predeterminados.
delete from app_role_permissions
where role_id in (
  select id from app_roles
  where codigo in ('superadmin', 'admin', 'responsable_de_sucursal', 'operador_sucursal')
);

-- Superadmin: todo el catálogo.
insert into app_role_permissions (role_id, permission_codigo)
select r.id, p.codigo
from app_roles r cross join app_permissions p
where r.codigo = 'superadmin'
on conflict do nothing;

-- Administrador: todo menos generar bases, sincronización y mantenimiento.
insert into app_role_permissions (role_id, permission_codigo)
select r.id, p.codigo
from app_roles r cross join app_permissions p
where r.codigo = 'admin'
  and p.codigo not in ('admin.base_productos', 'admin.sync', 'admin.maintenance')
on conflict do nothing;

-- Responsable.
insert into app_role_permissions (role_id, permission_codigo)
select r.id, c.codigo
from app_roles r
cross join (values
  ('dashboard.view'), ('kpis.mensuales'), ('stock.psicotropicos'), ('sesiones.revocar'),
  ('inventario.diario'), ('inventario.ocasional'), ('inventario.lista'),
  ('inventario.diferencias_resumen'),
  ('vencimientos.nuevo'), ('vencimientos.lista'), ('vencimientos.por_vencer'),
  ('vencimientos.vencidos'), ('vencimientos.devoluciones')
) as c(codigo)
where r.codigo = 'responsable_de_sucursal'
on conflict do nothing;

-- Operador de sucursal.
insert into app_role_permissions (role_id, permission_codigo)
select r.id, c.codigo
from app_roles r
cross join (values
  ('dashboard.view'), ('sesiones.revocar'),
  ('inventario.diario'), ('inventario.ocasional'), ('inventario.lista'),
  ('inventario.diferencias_resumen'),
  ('vencimientos.nuevo'), ('vencimientos.lista'), ('vencimientos.por_vencer')
) as c(codigo)
where r.codigo = 'operador_sucursal'
on conflict do nothing;

-- ── 3. Permisos por operador ─────────────────────────────────────────────────
create table if not exists operador_permisos (
  idoperador        integer not null references operadores(idoperador) on delete cascade,
  permission_codigo text    not null references app_permissions(codigo) on delete cascade,
  -- true = se le suma aunque el rol no lo tenga; false = se le quita aunque el rol sí lo tenga.
  concedido         boolean not null,
  motivo            text,
  creado_por        integer,
  creado            timestamptz not null default now(),
  primary key (idoperador, permission_codigo)
);

create index if not exists idx_operador_permisos_operador on operador_permisos(idoperador);

comment on table operador_permisos is
  'Ajustes de permisos por operador, por encima de los del rol. Efectivo = rol + concedidos − revocados.';
comment on column operador_permisos.concedido is
  'true suma el permiso; false lo quita aunque el rol lo incluya.';
