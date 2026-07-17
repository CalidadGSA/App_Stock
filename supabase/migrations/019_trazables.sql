-- Productos trazables: no se asignan a bultos de droguería (COFARMEN, DEL SUD, AMERICA, sin droguería).
create table if not exists trazables (
  idproducto bigint primary key,
  creado     timestamptz not null default now()
);

comment on table trazables is
  'Productos trazables (idproducto = CodPlex / IDProducto). En «Para devolver» se marcan como trazables y no van a bultos de droguería.';

comment on column trazables.idproducto is
  'ID de producto (medicamentos.codplex / IDProducto del sistema).';

create index if not exists idx_trazables_idproducto on trazables (idproducto);
