-- Agregados por sucursal para los informes mensual y trimestral.
--
-- Estas dos consultas eran lo más caro de esas pantallas: se hacían por sucursal, trayendo
-- miles de filas por PostgREST para contarlas en Node (~4 s y ~2,3 s por sucursal, × 21).
-- Acá se resuelven en Postgres y devuelven una fila por sucursal.
--
-- La app funciona sin esta migración: si las funciones no existen, cae al camino anterior.
--
-- APLICAR EN SUPABASE (SQL Editor):
--   supabase/migrations/030_agregados_informes.sql

-- ── Productos distintos con diferencia, por sucursal ──────────────────────────
-- Mismo criterio que `esDiferenciaDeControlAuditoria`: un control es de auditoría si
-- origen = 'Auditoria' o si su tipo está en la lista. `p_auditoria` elige qué lado contar.
create or replace function public.admin_productos_con_diferencia_por_sucursal(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_auditoria boolean default false
)
returns table (
  sucursal_id integer,
  productos bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ci.sucursal_id,
    count(distinct d.producto_id_sistema)::bigint as productos
  from controles_inventario_detalle d
  inner join controles_inventario ci on ci.id = d.control_id
  where ci.estado = 'cerrado'
    and coalesce(d.con_diferencias, 0) = 1
    and ci.fecha_fin is not null
    and ci.fecha_fin >= p_desde
    and ci.fecha_fin <= p_hasta
    and d.producto_id_sistema is not null
    and btrim(d.producto_id_sistema) <> ''
    and (
      trim(coalesce(ci.origen, '')) = 'Auditoria'
      or lower(trim(coalesce(ci.tipo, ''))) in (
        'auditoria', 'ocasional_auditoria', 'auditoria_integral', 'auditoria_sorpresa'
      )
    ) = p_auditoria
  group by ci.sucursal_id;
$$;

-- ── Avance del padrón por sucursal y categoría macro ──────────────────────────
-- `suma_veces` es lo que necesitan los psicotrópicos, que cuentan vueltas completas
-- (productos × vueltas_psicos) en vez de "inventariado sí/no".
create or replace function public.admin_progreso_base_productos(
  p_trimestre text
)
returns table (
  idsucursal integer,
  categoriamacro text,
  total bigint,
  inventariados bigint,
  suma_veces bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    bp.idsucursal,
    upper(btrim(bp.categoriamacro)) as categoriamacro,
    count(*)::bigint as total,
    count(*) filter (where coalesce(bp.vecesinventariado, 0) > 0)::bigint as inventariados,
    coalesce(sum(greatest(coalesce(bp.vecesinventariado, 0), 0)), 0)::bigint as suma_veces
  from base_productos bp
  where bp.trimestre = p_trimestre
  group by bp.idsucursal, upper(btrim(bp.categoriamacro));
$$;

grant execute on function public.admin_productos_con_diferencia_por_sucursal(timestamptz, timestamptz, boolean) to authenticated, service_role;
grant execute on function public.admin_progreso_base_productos(text) to authenticated, service_role;

-- Índices que estas consultas necesitan (idempotentes).
create index if not exists idx_ci_estado_fecha_fin on controles_inventario(estado, fecha_fin);
create index if not exists idx_bp_trimestre_sucursal on base_productos(trimestre, idsucursal);
