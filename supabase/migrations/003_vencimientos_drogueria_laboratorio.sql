-- Destino de devolución por droguería según laboratorio (FARMA).
-- Cada fila indica a qué droguería debe enviarse un producto cuyo laboratorio coincide por codlab.

create table if not exists vencimientos_drogueria_laboratorio (
  id          bigserial primary key,
  drogueria   text not null,
  laboratorio text not null,
  codlab      integer not null,
  creado      timestamptz not null default now(),
  constraint vencimientos_drogueria_laboratorio_codlab_unique unique (codlab),
  constraint vencimientos_drogueria_laboratorio_drogueria_codlab_unique unique (drogueria, codlab)
);

create index if not exists idx_venc_drogueria_lab_drogueria
  on vencimientos_drogueria_laboratorio (drogueria);

create index if not exists idx_venc_drogueria_lab_codlab
  on vencimientos_drogueria_laboratorio (codlab);

comment on table vencimientos_drogueria_laboratorio is
  'Asignación droguería de devolución por laboratorio (codlab) para productos FARMA vencidos.';

comment on column vencimientos_drogueria_laboratorio.drogueria is
  'Nombre de la droguería destino (ej. COFARMEN).';

comment on column vencimientos_drogueria_laboratorio.laboratorio is
  'Nombre del laboratorio (referencia; la coincidencia en app usa codlab).';

comment on column vencimientos_drogueria_laboratorio.codlab is
  'Código de laboratorio (medicamentos.codlab / laboratorios.codlab).';

-- Datos de ejemplo (eliminar o ampliar según operación)
insert into vencimientos_drogueria_laboratorio (drogueria, laboratorio, codlab) values
  ('COFARMEN', 'ADIUM', 192),
  ('COFARMEN', 'ALCON', 5),
  ('COFARMEN', 'ANDROMACO', 9)
on conflict (codlab) do update set
  drogueria = excluded.drogueria,
  laboratorio = excluded.laboratorio;
