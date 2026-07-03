-- RBAC: roles y permisos configurables
-- Ejecutar en Supabase SQL Editor (idempotente donde sea posible)

create table if not exists app_permissions (
  codigo      text primary key,
  nombre      text not null,
  descripcion text,
  categoria   text not null default 'general',
  orden       smallint not null default 0
);

create table if not exists app_roles (
  id          serial primary key,
  codigo      text not null unique,
  nombre      text not null,
  descripcion text,
  rol_legacy  rol_usuario not null default 'operador_sucursal',
  es_sistema  boolean not null default false,
  activo      boolean not null default true,
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

create table if not exists app_role_permissions (
  role_id           integer not null references app_roles(id) on delete cascade,
  permission_codigo text not null references app_permissions(codigo) on delete cascade,
  primary key (role_id, permission_codigo)
);

alter table operadores add column if not exists app_role_id integer references app_roles(id);

create index if not exists idx_operadores_app_role_id on operadores(app_role_id);

-- Catálogo de permisos
insert into app_permissions (codigo, nombre, descripcion, categoria, orden) values
  ('dashboard.view', 'Ver dashboard', 'Acceso al panel principal', 'general', 10),
  ('inventario.diario', 'Inventario diario', 'Crear controles de inventario diario', 'inventario', 20),
  ('inventario.ocasional', 'Inventario ocasional', 'Inventarios ocasionales de sucursal', 'inventario', 30),
  ('inventario.auditoria', 'Auditoría de inventario', 'Controles de auditoría', 'inventario', 40),
  ('inventario.lista', 'Lista de inventarios', 'Ver historial de controles', 'inventario', 50),
  ('inventario.diferencias_resumen', 'Resumen de diferencias', 'Reporte consolidado de diferencias', 'inventario', 60),
  ('vencimientos.nuevo', 'Nuevo control vencimientos', 'Iniciar control de vencimientos', 'vencimientos', 70),
  ('vencimientos.lista', 'Lista vencimientos', 'Historial de controles de vencimientos', 'vencimientos', 80),
  ('vencimientos.por_vencer', 'Por vencer', 'Listado de productos por vencer', 'vencimientos', 90),
  ('vencimientos.consolidado', 'Por vencer consolidado', 'Vista multi-sucursal por vencer', 'vencimientos', 100),
  ('vencimientos.vencidos', 'Vencidos', 'Productos vencidos', 'vencimientos', 110),
  ('vencimientos.devoluciones', 'Devoluciones', 'Devoluciones de vencimientos', 'vencimientos', 120),
  ('vencimientos.descuentos', 'Descuentos', 'Gestión de descuentos por vencimiento', 'vencimientos', 130),
  ('admin.resumen_trimestral', 'Resumen trimestral', 'Progreso trimestral por sucursal', 'administracion', 200),
  ('admin.diferencias_psico', 'Dif. psico / estupefacientes', 'Diferencias en controlados', 'administracion', 210),
  ('admin.ajustes', 'Ajustes', 'Exportar y gestionar ajustes', 'administracion', 220),
  ('admin.ajustes_historial', 'Historial de ajustes', 'Ver historial de ajustes', 'administracion', 230),
  ('admin.roles_manage', 'Roles y permisos', 'Administrar roles y asignaciones', 'administracion', 240),
  ('admin.operadores_manage', 'Gestionar operadores', 'Asignar roles a operadores', 'administracion', 250),
  ('admin.maintenance', 'Modo mantenimiento', 'Activar/desactivar mantenimiento', 'sistema', 300),
  ('admin.sync', 'Sincronización legacy', 'Sync sucursales y medicamentos', 'sistema', 310)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  orden = excluded.orden;

-- Roles de sistema (mapean al enum rol_usuario)
insert into app_roles (codigo, nombre, descripcion, rol_legacy, es_sistema) values
  ('superadmin', 'Superadministrador', 'Acceso total incluyendo mantenimiento', 'superadmin', true),
  ('admin', 'Administrador', 'Administración y reportes', 'admin', true),
  ('operador_sucursal', 'Operador de sucursal', 'Operación diaria en sucursal', 'operador_sucursal', true)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  rol_legacy = excluded.rol_legacy,
  es_sistema = true;

-- Permisos por rol de sistema
insert into app_role_permissions (role_id, permission_codigo)
select r.id, p.codigo
from app_roles r
cross join app_permissions p
where r.codigo = 'superadmin'
on conflict do nothing;

insert into app_role_permissions (role_id, permission_codigo)
select r.id, p.codigo
from app_roles r
cross join app_permissions p
where r.codigo = 'admin'
  and p.codigo not in ('admin.maintenance', 'inventario.diario', 'vencimientos.nuevo')
on conflict do nothing;

insert into app_role_permissions (role_id, permission_codigo)
select r.id, p.codigo
from app_roles r
cross join app_permissions p
where r.codigo = 'operador_sucursal'
  and p.codigo in (
    'dashboard.view',
    'inventario.diario', 'inventario.ocasional', 'inventario.lista', 'inventario.diferencias_resumen',
    'vencimientos.nuevo', 'vencimientos.lista', 'vencimientos.por_vencer',
    'vencimientos.vencidos', 'vencimientos.devoluciones'
  )
on conflict do nothing;

-- Vincular operadores existentes a roles de sistema por enum
update operadores o
set app_role_id = r.id
from app_roles r
where o.app_role_id is null
  and r.codigo = o.rol::text;
