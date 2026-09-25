-- padron_final.activomanual — activación manual de productos para GestiónStock.
--
-- Por qué: `activo` la sincroniza Plex (plexdr) y se pisa en cada corrida del sync, así que no
-- sirve para "reactivar" a mano un producto dado de baja en el ERP. `activomanual` es una columna
-- propia de GSA (ningún sync la toca) y la app considera vigente un producto cuando
-- `activo = 'S'` **o** `activomanual = 'S'`.
--
-- Se ejecuta contra la base del padrón (PADRON_DB_*, la misma de abastecimiento), no contra Supabase.
--   psql "$PADRON_DB_URL" -f scripts/sql/padron-final-activomanual.sql

alter table public.padron_final
  add column if not exists activomanual text;

-- Estado inicial: ninguno activado a mano.
update public.padron_final
set activomanual = 'N'
where activomanual is null or btrim(activomanual) = '';

-- Búsquedas/escaneo filtran por activo o activomanual: índice sobre los productos activados a mano
-- (son pocos, el índice parcial se mantiene chico).
create index if not exists idx_padron_final_activomanual
  on public.padron_final (upper(btrim(activomanual)))
  where upper(btrim(activomanual)) = 'S';
