-- Ubicación física de droguería en líneas de inventario (snapshot desde base_productos_drogueria).
alter table controles_inventario_detalle
  add column if not exists sector integer,
  add column if not exists modulo text,
  add column if not exists fila integer,
  add column if not exists posicion integer;

comment on column controles_inventario_detalle.sector is
  'Sector de ubicación en droguería (base_productos_drogueria).';
comment on column controles_inventario_detalle.modulo is
  'Módulo de ubicación en droguería.';
comment on column controles_inventario_detalle.fila is
  'Fila de ubicación en droguería.';
comment on column controles_inventario_detalle.posicion is
  'Posición de ubicación en droguería.';

-- Documentación de la tabla de padrón trimestral de droguería (creada en Supabase).
create table if not exists base_productos_drogueria (
  idproducto         bigint not null,
  categoriamacro     text,
  sector             integer,
  modulo             text,
  fila               integer,
  posicion           integer,
  producto           text,
  presentacion       text,
  orden              integer,
  trimestre          text not null,
  vecesinventariado  integer not null default 0,
  fechainicio        date,
  fechafin           date,
  primary key (idproducto, trimestre)
);

create index if not exists idx_base_prod_drogueria_trimestre
  on base_productos_drogueria (trimestre);
create index if not exists idx_base_prod_drogueria_macro
  on base_productos_drogueria (categoriamacro);
create index if not exists idx_base_prod_drogueria_ubicacion
  on base_productos_drogueria (sector, modulo, fila, posicion);

comment on table base_productos_drogueria is
  'Padrón trimestral de inventario diario de droguería (ubicación: sector/módulo/fila/posición).';
