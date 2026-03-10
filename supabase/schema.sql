-- ============================================================
-- SCHEMA: GestionStock Farmacia
-- Base: Supabase (Postgres)
-- ============================================================

-- Tipos enumerados (idempotente: no falla si ya existen)
do $$
begin
  if not exists (select 1 from pg_type where typname = 'rol_usuario') then
    create type rol_usuario as enum ('admin', 'operador_sucursal');
  end if;
  if not exists (select 1 from pg_type where typname = 'estado_control') then
    create type estado_control as enum ('en_progreso', 'cerrado');
  end if;
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
-- CONTROLES DE INVENTARIO  (cabecera)
-- ------------------------------------------------------------
create table controles_inventario (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  integer not null references sucursales(Sucursal),
  usuario_id   integer not null references operadores(IDOperador),
  fecha_inicio timestamptz not null default now(),
  fecha_fin    timestamptz,
  estado       estado_control not null default 'en_progreso',
  descripcion  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_ci_sucursal on controles_inventario(sucursal_id);
create index idx_ci_estado   on controles_inventario(estado);
create index idx_ci_usuario on controles_inventario(usuario_id);
create index idx_ci_fecha_inicio on controles_inventario(fecha_inicio);

-- ------------------------------------------------------------
-- CONTROLES DE INVENTARIO  (detalle)
-- ------------------------------------------------------------
create table controles_inventario_detalle (
  id                  uuid primary key default gen_random_uuid(),
  control_id          uuid not null references controles_inventario(id) on delete cascade,
  producto_id_sistema text not null,
  codigo_barras       text not null,
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
  diferencia          numeric(12,2) generated always as (stock_real - stock_sistema) stored,
  fecha_registro      timestamptz not null default now()
);
create index idx_cid_control on controles_inventario_detalle(control_id);
create index idx_cid_producto_sistema on controles_inventario_detalle(producto_id_sistema);

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
  codigo_barras       text not null,
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

-- Políticas: el service_role bypassa RLS automáticamente.
-- (Operadores se gestiona por sync legacy; sin tabla usuarios no hay política por auth.uid.)
