-- Rellenar nombrecompleto en presencia desde operadores (evita NULL si el ping
-- manda vacío o si la cookie de sesión no trae el nombre).
create or replace function public.operador_presencia_fill_nombre()
returns trigger
language plpgsql
as $$
declare
  nombre text;
begin
  if new.nombrecompleto is not null and btrim(new.nombrecompleto) <> '' then
    new.nombrecompleto := btrim(new.nombrecompleto);
    return new;
  end if;

  select coalesce(
    nullif(btrim(o.nombrecompleto), ''),
    nullif(btrim(o.operador), '')
  )
  into nombre
  from public.operadores o
  where o.idoperador = new.idoperador;

  new.nombrecompleto := nombre;
  return new;
end;
$$;

drop trigger if exists trg_operador_presencia_fill_nombre on public.operador_presencia;

create trigger trg_operador_presencia_fill_nombre
  before insert or update on public.operador_presencia
  for each row
  execute function public.operador_presencia_fill_nombre();

comment on function public.operador_presencia_fill_nombre() is
  'Si nombrecompleto viene vacío, lo completa desde operadores.nombrecompleto/operador.';

-- Backfill de filas ya existentes con NULL o vacío.
update public.operador_presencia p
set nombrecompleto = coalesce(
  nullif(btrim(o.nombrecompleto), ''),
  nullif(btrim(o.operador), '')
)
from public.operadores o
where o.idoperador = p.idoperador
  and (p.nombrecompleto is null or btrim(p.nombrecompleto) = '');
