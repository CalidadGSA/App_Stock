-- Nombre completo del operador en presencia (denormalizado para lecturas rápidas / listados).
alter table public.operador_presencia
  add column if not exists nombrecompleto text;

comment on column public.operador_presencia.nombrecompleto is
  'Nombre completo del operador al momento del último ping (desde sesión).';

-- Backfill desde operadores para filas ya existentes.
update public.operador_presencia p
set nombrecompleto = o.nombrecompleto
from public.operadores o
where o.idoperador = p.idoperador
  and (p.nombrecompleto is null or btrim(p.nombrecompleto) = '');
