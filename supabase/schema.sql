-- ============================================================
-- SCHEMA: GestionStock Farmacia
-- Base: Supabase (Postgres)
-- ============================================================

-- Tipos enumerados (idempotente: no falla si ya existen)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'rol_usuario') then
    create type rol_usuario as enum ('superadmin', 'admin', 'operador_sucursal');
  end if;
  if not exists (select 1 from pg_type where typname = 'estado_control') then
    create type estado_control as enum ('en_progreso', 'cerrado');
  end if;
end
$$;

do $$
begin
  alter type rol_usuario add value if not exists 'superadmin';
exception
  when duplicate_object then null;
end
$$;

-- ------------------------------------------------------------
-- SUCURSALES
-- ------------------------------------------------------------
create table sucursales (
  Sucursal           integer primary key,
  NombreFantasia        text not null,
  Domicilio     text,
  Telefono      text,
  Email         text,
  _CodPostal    text,
  contraseña text not null,
  activa        boolean not null default true,
  creada    timestamptz not null default now(),
  actualizada    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- USUARIOS  (extiende auth.users de Supabase; para login app)
-- ------------------------------------------------------------
-- Operadores (sincronizado desde base legacy)
create table operadores (
  IDOperador         integer primary key,
  Operador     text not null unique,
  NombreCompleto      text not null ,
  Codigo       integer not null,
  rol        rol_usuario not null default 'operador_sucursal',
  Activo     char(1) not null,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now()
);

-- ------------------------------------------------------------
-- CACHE DE PRODUCTOS  (sincronizado desde base legacy)
-- ------------------------------------------------------------
create table medicamentos (
  CodPlex       bigint primary key,
  Troquel       bigint,
  CodLab        integer,
  codebar          text ,
  codebar2         text,
  codebar3         text,
  codebar4         text,
  Producto         text,
  Presentaci          text,
  Precio              double precision,
  Costo              double precision,
  Activo             char(1),
  cod_rubro            integer not null,
  IDSubrubro            integer,
  IDPsicofarmaco        text,
  visible                smallint,
  Refrigeracion        char(1),
  Fraccionable         smallint,
  actualizado           timestamptz not null default now()
);
create index idx_medicamentos_codebar on medicamentos(codebar);
create index idx_medicamentos_cod_rubro on medicamentos(cod_rubro);
create index idx_medicamentos_id_subrubro on medicamentos(IDSubrubro);

create table rubros (
  CodRubro        integer primary key,
  Rubro           text
);

create table subrubros (
  IDSubRubro        integer primary key,
  Nombre            text,
  IDRubro           integer not null,
  IDCategoria       integer
);
create index idx_subrubros_id_rubro on subrubros(IDRubro);
create index idx_subrubros_id_categoria on subrubros(IDCategoria);

create table categorias (
  IDCategoria        integer primary key not null,
  Nombre             text 
);


create table psicofarmacos (
  IDPsicofarmaco        text primary key not null,
  Nombre                text 
);


-- ------------------------------------------------------------
-- LABORATORIOS
-- ------------------------------------------------------------
create table laboratorios (
  CodLab   integer primary key,
  Laborato text
);


-- ------------------------------------------------------------
-- STOCK ACTUAL POR SUCURSAL Y PRODUCTO (sincronizado desde base legacy)
-- ------------------------------------------------------------
create table stock (
  Sucursal      integer not null references sucursales(Sucursal),
  IDProducto    bigint  not null,
  Cantidad      numeric(14,3) not null default 0,
  Unidades      integer       not null default 0,
  UnidadesProd  integer       not null default 1,
  actualizado   timestamptz   not null default now(),
  primary key (Sucursal, IDProducto)
);
create index idx_stock_idproducto on stock(IDProducto);


-- ------------------------------------------------------------
-- BASE DE PRODUCTOS POR SUCURSAL / CATEGORÍA / TRIMESTRE
-- ------------------------------------------------------------
create table base_productos (
  idSucursal        integer    not null references sucursales(Sucursal),
  idProducto        bigint     not null,
  categoriamacro    text       not null,
  trimestre         text       not null,
  fechaInicio       date       not null,
  fechaFin          date       not null,
  orden             integer    not null default 0,
  vecesInventariado integer    not null default 0,
  primary key (idSucursal, idProducto, categoriamacro, trimestre)
);
create index idx_baseprod_producto  on base_productos(idProducto);
create index idx_baseprod_categoriamacro on base_productos(categoriamacro);
create index idx_baseprod_trimestre on base_productos(trimestre);


-- ------------------------------------------------------------
-- PRODUCTOS ↔ CODEBARS (múltiples códigos por producto, desde Quantio)
-- ------------------------------------------------------------
create table productoscodebars (
  IDProducto  bigint not null,
  codebar     text   not null,
  primary key (IDProducto, codebar)
);
create index idx_productoscodebars_codebar on productoscodebars(codebar);


-- ------------------------------------------------------------
-- CONTROLES DE INVENTARIO  (cabecera)
-- ------------------------------------------------------------
create table controles_inventario (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  integer not null references sucursales(Sucursal),
  usuario_id   integer not null references operadores(IDOperador),
  fecha_inicio timestamptz not null default now(),
  fecha_fin    timestamptz,
  estado       estado_control not null default 'en_progreso',
  origen       text not null default 'Sucursal',
  tipo         text not null default 'ocasional_sucursal',
  descripcion  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Categoría macro opcional para el inventario (FARMA / BIENESTAR / PSICOTROPICOS)
alter table controles_inventario
  add column if not exists categoria_macro text;
alter table controles_inventario
  add column if not exists tipo text;
create index idx_ci_sucursal on controles_inventario(sucursal_id);
create index idx_ci_estado   on controles_inventario(estado);
create index idx_ci_usuario on controles_inventario(usuario_id);
create index idx_ci_fecha_inicio on controles_inventario(fecha_inicio);
create index if not exists idx_ci_tipo on controles_inventario(tipo);

update controles_inventario
set tipo = case
  when categoria_macro is not null then 'diario'
  when origen = 'Auditoria' and coalesce(lower(descripcion), '') like '%ocasional%' then 'ocasional_auditoria'
  when origen = 'Auditoria' then 'auditoria'
  else 'ocasional_sucursal'
end
where tipo is null
   or tipo not in ('diario', 'ocasional_sucursal', 'ocasional_auditoria', 'auditoria', 'auditoria_integral');

alter table controles_inventario
  drop constraint if exists controles_inventario_tipo_check;

alter table controles_inventario
  add constraint controles_inventario_tipo_check
  check (
    tipo in (
      'diario',
      'ocasional_sucursal',
      'ocasional_auditoria',
      'auditoria',
      'auditoria_integral'
    )
  );

-- ------------------------------------------------------------
-- CONTROLES DE INVENTARIO  (detalle)
-- ------------------------------------------------------------
create table controles_inventario_detalle (
  id                  uuid primary key default gen_random_uuid(),
  control_id          uuid not null references controles_inventario(id) on delete cascade,
  producto_id_sistema text not null,
  codigo_barras       text,
  descripcion         text not null,
  presentacion        text,
  laboratorio         text,
  stock_sistema       numeric(12,2) not null default 0,
  -- stock de sistema expresado en cajas/unidades (si se disponía al momento del conteo)
  stock_sist_cajas    numeric(12,2),
  stock_sist_unidades numeric(12,2),
  -- Cantidad contada en cajas (opcional, para que el usuario ingrese en cajas)
  stock_real_cajas    numeric(12,2),
  -- Cantidad contada en unidades sueltas (opcional)
  stock_real_unidades numeric(12,2),
  -- Total contado en unidades (cajas*unidades_por_caja + unidades_sueltas)
  stock_real          numeric(12,2) not null default 0,
  estado              text not null default 'en_progreso',
  con_diferencias     smallint not null default 0,
  auditado            smallint not null default 0,
  ajustado            smallint not null default 0,
  diferencia          numeric(12,2) generated always as (stock_real - stock_sistema) stored,
  fecha_registro      timestamptz not null default now()
);
create index idx_cid_control on controles_inventario_detalle(control_id);
create index idx_cid_producto_sistema on controles_inventario_detalle(producto_id_sistema);

alter table controles_inventario_detalle
  add column if not exists estado text;
alter table controles_inventario_detalle
  add column if not exists con_diferencias smallint not null default 0;
alter table controles_inventario_detalle
  add column if not exists auditado smallint not null default 0;
alter table controles_inventario_detalle
  add column if not exists ajustado smallint not null default 0;

update controles_inventario_detalle
set estado = case
  when ajustado = 1 and auditado = 1 then 'ajustado_auditoria'
  when ajustado = 1 then 'ajustado_sucursal'
  when auditado = 1 then 'auditado'
  when con_diferencias = 1 then 'con_diferencia'
  else 'sin_diferencias'
end
where estado is null
   or estado not in (
     'en_progreso',
     'con_diferencia',
     'sin_diferencias',
     'auditado',
     'ajustado_auditoria',
     'ajustado_sucursal'
   );

alter table controles_inventario_detalle
  drop constraint if exists chk_cid_estado;

alter table controles_inventario_detalle
  add constraint chk_cid_estado
  check (
    estado in (
      'en_progreso',
      'con_diferencia',
      'sin_diferencias',
      'auditado',
      'ajustado_auditoria',
      'ajustado_sucursal'
    )
  );

-- ------------------------------------------------------------
-- CONTROLES DE VENCIMIENTOS  (cabecera)
-- ------------------------------------------------------------
create table controles_vencimientos (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  integer not null references sucursales(Sucursal),
  usuario_id   integer not null references operadores(IDOperador),
  fecha_inicio timestamptz not null default now(),
  fecha_fin    timestamptz,
  estado       estado_control not null default 'en_progreso',
  observaciones text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Categoría macro opcional para el control de vencimientos (FARMA / BIENESTAR / PSICOTROPICOS)
alter table controles_vencimientos
  add column if not exists categoria_macro text;
create index idx_cv_sucursal on controles_vencimientos(sucursal_id);
create index idx_cv_estado   on controles_vencimientos(estado);
create index idx_cv_usuario on controles_vencimientos(usuario_id);
create index idx_cv_fecha_inicio on controles_vencimientos(fecha_inicio);

-- ------------------------------------------------------------
-- CONTROLES DE VENCIMIENTOS  (detalle)
-- ------------------------------------------------------------
create table controles_vencimientos_detalle (
  id                  uuid primary key default gen_random_uuid(),
  control_id          uuid not null references controles_vencimientos(id) on delete cascade,
  producto_id_sistema text not null,
  codigo_barras       text,
  descripcion         text not null,
  presentacion        text,
  laboratorio         text,
  fecha_vencimiento   date not null,
  cantidad            numeric(12,2) not null,
  fecha_registro      timestamptz not null default now()
);
create index idx_cvd_control    on controles_vencimientos_detalle(control_id);
create index idx_cvd_vencimiento on controles_vencimientos_detalle(fecha_vencimiento);
create index idx_cvd_producto_sistema on controles_vencimientos_detalle(producto_id_sistema);

-- Flag para marcar un registro como vendido en la vista "por vencer" sin borrarlo del control
alter table controles_vencimientos_detalle
  add column if not exists vendido smallint not null default 0;

-- Flag para marcar un registro como devuelto (devolución registrada)
alter table controles_vencimientos_detalle
  add column if not exists devuelto smallint not null default 0;

-- Acción u observación (p. ej. vencidos / criterio de devolución)
alter table controles_vencimientos_detalle
  add column if not exists accion_observacion text;

-- Línea anulada por error de carga (no es venta; no aparece en listados operativos)
alter table controles_vencimientos_detalle
  add column if not exists eliminado smallint not null default 0;

-- Historial de ventas desde “por vencer” (cada bajada de stock / marca vendido).
-- Permite auditar por controles_vencimientos_detalle qué se vendió parcialmente y cuándo quedó liquidado.
create table if not exists vencimientos_detalle_ventas (
  id                         uuid primary key default gen_random_uuid(),
  detalle_id                 uuid not null references controles_vencimientos_detalle(id) on delete cascade,
  cantidad_vendida           numeric(12,2) not null,
  cantidad_restante_despues  numeric(12,2) not null check (cantidad_restante_despues >= 0),
  linea_vendida_completa     smallint not null default 0,
  es_ajuste                  smallint not null default 0,
  usuario_id                 integer references operadores(IDOperador),
  sucursal_id                integer not null references sucursales(Sucursal),
  created_at                 timestamptz not null default now(),
  check (
    (es_ajuste = 0 and cantidad_vendida > 0)
    or (es_ajuste = 1 and cantidad_vendida <> 0)
  )
);
create index if not exists idx_vdv_detalle on vencimientos_detalle_ventas(detalle_id);
create index if not exists idx_vdv_sucursal on vencimientos_detalle_ventas(sucursal_id);
create index if not exists idx_vdv_created on vencimientos_detalle_ventas(created_at);

-- ------------------------------------------------------------
-- DEVOLUCIONES DE VENCIMIENTOS
-- ------------------------------------------------------------
create table if not exists devoluciones_vencimientos (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  integer not null references sucursales(Sucursal),
  usuario_id   integer not null references operadores(IDOperador),
  fecha        timestamptz not null default now()
);

create table if not exists devoluciones_vencimientos_detalle (
  id                       uuid primary key default gen_random_uuid(),
  devolucion_id            uuid not null references devoluciones_vencimientos(id) on delete cascade,
  detalle_vencimiento_id   uuid not null references controles_vencimientos_detalle(id),
  control_id               uuid not null references controles_vencimientos(id) on delete cascade,
  producto_id_sistema      text not null,
  codigo_barras            text not null,
  descripcion              text not null,
  presentacion             text,
  laboratorio              text,
  fecha_vencimiento        date not null,
  cantidad                 numeric(12,2) not null,
  categoria_macro          text
);

alter table devoluciones_vencimientos_detalle
  add column if not exists accion_observacion text;

-- ------------------------------------------------------------
-- REGLAS DE DESCUENTOS POR VENCIMIENTOS
-- ------------------------------------------------------------
create table if not exists categorias_finales (
  id              serial primary key,
  subrubro_nombre text not null,
  categoria       text not null,
  categoria_final text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (subrubro_nombre, categoria)
);

create table if not exists descuentos_vencimientos_reglas (
  id             serial primary key,
  id_categoriafinal integer not null references categorias_finales(id) on delete cascade,
  descuento      numeric(5,2) not null,
  dias_min       integer not null,
  dias_max       integer not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_dvr_categoriafinal on descuentos_vencimientos_reglas(id_categoriafinal);

-- ------------------------------------------------------------
-- SYNC LEGACY → SUPABASE  (estado y auditoría)
-- ------------------------------------------------------------
create table if not exists sync_status (
  key         text primary key,
  completed   boolean not null default false,
  updated_at  timestamptz not null default now()
);

create table if not exists audit_log (
  id         serial primary key,
  entity     text not null,
  action     text not null,
  status     text not null,
  message    text,
  created_at timestamptz not null default now()
);

create table if not exists auth_log (
  id              serial primary key,
  username        text,
  sucursal_nombre text,
  ip_address      text,
  action          text,
  session_id      text,
  user_agent      text,
  success         boolean,
  created_at      timestamptz not null default now()
);

-- ------------------------------------------------------------
-- ESTADO GLOBAL DEL FRONTEND (MODO MANTENIMIENTO)
-- ------------------------------------------------------------
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

-- Throttle de alertas Onze (opcional; puede actualizarlo n8n al enviar mails)
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

-- Historial de lapsos en mantenimiento (escritura desde n8n)
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
create unique index if not exists idx_historial_mantenimiento_periodo_abierto
  on historial_modo_mantenimiento ((true))
  where fin_at is null;
create index if not exists idx_historial_mantenimiento_inicio
  on historial_modo_mantenimiento (inicio_at desc);
create index if not exists idx_historial_mantenimiento_fin
  on historial_modo_mantenimiento (fin_at desc nulls last);

-- Compatibilidad con instalaciones existentes
alter table if exists controles_inventario_detalle
  alter column codigo_barras drop not null;
alter table if exists controles_vencimientos_detalle
  alter column codigo_barras drop not null;

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY  (habilitado; acceso via service_role desde backend)
-- ------------------------------------------------------------
alter table sucursales                   enable row level security;
alter table operadores                   enable row level security;
alter table medicamentos                 enable row level security;
alter table stock                        enable row level security;
alter table rubros                      enable row level security;
alter table subrubros                   enable row level security;
alter table categorias                  enable row level security;
alter table psicofarmacos               enable row level security;
alter table controles_inventario         enable row level security;
alter table controles_inventario_detalle enable row level security;
alter table controles_vencimientos       enable row level security;
alter table controles_vencimientos_detalle enable row level security;
alter table vencimientos_detalle_ventas enable row level security;
alter table modo_mantenimiento           enable row level security;
alter table historial_modo_mantenimiento enable row level security;

-- ------------------------------------------------------------
-- FUNCIÓN: incrementar vecesInventariado al cerrar un inventario diario
-- ------------------------------------------------------------
create or replace function incrementar_veces_inventariado(
  p_sucursal_id integer,
  p_categoria_macro text,
  p_trimestre text,
  p_id_productos bigint[]
)
returns void
language sql
security definer
set search_path = public
as $$
  update base_productos
  set vecesinventariado = vecesinventariado + 1
  where idsucursal = p_sucursal_id
    and lower(categoriamacro) = lower(p_categoria_macro)
    and trimestre = p_trimestre
    and idproducto = any(p_id_productos);
$$;

-- Políticas: el service_role bypassa RLS automáticamente.
-- (Operadores se gestiona por sync legacy; sin tabla usuarios no hay política por auth.uid.)

-- RBAC (roles y permisos configurables): ver supabase/migrations/001_rbac.sql
