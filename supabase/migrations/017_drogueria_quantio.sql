-- Droguería central (Quantio): sucursal, operadores y catálogo de productos.

alter table sucursales
  add column if not exists es_drogueria boolean not null default false;

comment on column sucursales.es_drogueria is
  'Sucursal de droguería central (Quantio). Usa operadores fuente=quantio y productos_quantio.';

-- Operadores Onze vs Quantio (mismo login: nombre + código).
alter table operadores
  add column if not exists fuente text not null default 'onze';

comment on column operadores.fuente is
  'Origen del operador: onze (sucursales) o quantio (droguería).';

alter table operadores drop constraint if exists operadores_operador_key;

create unique index if not exists operadores_operador_fuente_unique
  on operadores (operador, fuente);

-- Cache de productos Quantio (tabla productos).
create table if not exists productos_quantio (
  idproducto       bigint primary key,
  producto         text,
  presentacion     text,
  prod_pres        text,
  codebar          text,
  troquel          bigint,
  unidades         integer,
  activo           char(1),
  refrigeracion    char(1),
  idlaboratorio    integer,
  idrubro          integer,
  idsubrubro       integer,
  idpsicofarmaco   varchar(20),
  gtin             varchar(50),
  costo            double precision not null default 0,
  ultimoprecio     double precision not null default 0,
  actualizado      timestamptz not null default now()
);

create index if not exists idx_productos_quantio_codebar
  on productos_quantio (codebar)
  where codebar is not null and codebar <> '';

create index if not exists idx_productos_quantio_troquel
  on productos_quantio (troquel)
  where troquel is not null;

create index if not exists idx_productos_quantio_prod_pres
  on productos_quantio (prod_pres);

comment on table productos_quantio is
  'Catálogo Quantio (productos) sincronizado para la droguería.';
