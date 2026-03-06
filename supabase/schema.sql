-- ============================================================
-- SCHEMA: GestionStock Farmacia
-- Base: Supabase (Postgres)
-- ============================================================

-- Tipos enumerados
create type rol_usuario as enum ('admin', 'operador_sucursal');
create type estado_control as enum ('en_progreso', 'cerrado');

-- ------------------------------------------------------------
-- SUCURSALES
-- ------------------------------------------------------------
create table sucursales (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  codigo_interno text unique not null,
  ubicacion     text,
  telefono      text,
  email         text,
  cod_postal    text,
  password_hash text not null,
  activa        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ------------------------------------------------------------
-- USUARIOS  (extiende auth.users de Supabase)
-- ------------------------------------------------------------
create table usuarios (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  email      text not null unique,
  rol        rol_usuario not null default 'operador_sucursal',
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- CACHE DE PRODUCTOS  (sincronizado desde base legacy)
-- ------------------------------------------------------------
create table productos_cache (
  id                   uuid primary key default gen_random_uuid(),
  producto_id_sistema  text not null unique,
  codigo_barras        text not null,
  descripcion          text not null,
  presentacion         text,
  laboratorio          text,
  troquel              text,
  cod_rubro            text,
  refrigeracion        boolean,
  updated_at           timestamptz not null default now()
);
create index idx_productos_cache_barras on productos_cache(codigo_barras);

-- ------------------------------------------------------------
-- CONTROLES DE INVENTARIO  (cabecera)
-- ------------------------------------------------------------
create table controles_inventario (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  uuid not null references sucursales(id),
  usuario_id   uuid not null references usuarios(id),
  fecha_inicio timestamptz not null default now(),
  fecha_fin    timestamptz,
  estado       estado_control not null default 'en_progreso',
  observaciones text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_ci_sucursal on controles_inventario(sucursal_id);
create index idx_ci_estado   on controles_inventario(estado);

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
  stock_real          numeric(12,2) not null default 0,
  diferencia          numeric(12,2) generated always as (stock_real - stock_sistema) stored,
  fecha_registro      timestamptz not null default now()
);
create index idx_cid_control on controles_inventario_detalle(control_id);

-- ------------------------------------------------------------
-- CONTROLES DE VENCIMIENTOS  (cabecera)
-- ------------------------------------------------------------
create table controles_vencimientos (
  id           uuid primary key default gen_random_uuid(),
  sucursal_id  uuid not null references sucursales(id),
  usuario_id   uuid not null references usuarios(id),
  fecha_inicio timestamptz not null default now(),
  fecha_fin    timestamptz,
  estado       estado_control not null default 'en_progreso',
  observaciones text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_cv_sucursal on controles_vencimientos(sucursal_id);
create index idx_cv_estado   on controles_vencimientos(estado);

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

-- ------------------------------------------------------------
-- ROW LEVEL SECURITY  (habilitado; acceso via service_role desde backend)
-- ------------------------------------------------------------
alter table sucursales                   enable row level security;
alter table usuarios                     enable row level security;
alter table productos_cache              enable row level security;
alter table controles_inventario         enable row level security;
alter table controles_inventario_detalle enable row level security;
alter table controles_vencimientos       enable row level security;
alter table controles_vencimientos_detalle enable row level security;

-- Políticas: el service_role bypassa RLS automáticamente.
-- Las siguientes políticas permiten a usuarios autenticados leer sus propios datos.
create policy "usuarios ven su propio perfil"
  on usuarios for select using (auth.uid() = id);

-- ------------------------------------------------------------
-- FUNCIÓN: auto-crear perfil de usuario al registrarse
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.usuarios (id, nombre, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
