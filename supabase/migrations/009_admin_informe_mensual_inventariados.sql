-- Productos inventariados (distintos) por sucursal en el mes del informe mensual.
-- La firma de retorno cambió respecto a 004: hay que eliminar la función anterior.

drop function if exists public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz);

create function public.admin_estadisticas_mensual_sucursal(
  p_desde timestamptz,
  p_hasta timestamptz
)
returns table (
  sucursal_id integer,
  nombrefantasia text,
  productos_inventariados bigint,
  vencidos_cargados bigint,
  vencidos_vendidas_unidades numeric,
  inventario_lineas_con_diferencia bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with vc as (
    select cv.sucursal_id as sid, count(*)::bigint as n
    from controles_vencimientos_detalle d
    inner join controles_vencimientos cv on cv.id = d.control_id
    where coalesce(d.eliminado, 0) = 0
      and d.fecha_registro >= p_desde
      and d.fecha_registro < p_hasta
    group by cv.sucursal_id
  ),
  vv as (
    select v.sucursal_id as sid, coalesce(sum(v.cantidad_vendida), 0)::numeric as u
    from vencimientos_detalle_ventas v
    where v.created_at >= p_desde
      and v.created_at < p_hasta
    group by v.sucursal_id
  ),
  inv as (
    select ci.sucursal_id as sid, count(*)::bigint as n
    from controles_inventario_detalle d
    inner join controles_inventario ci on ci.id = d.control_id
    where ci.estado = 'cerrado'
      and coalesce(d.con_diferencias, 0) = 1
      and ci.fecha_fin is not null
      and ci.fecha_fin >= p_desde
      and ci.fecha_fin < p_hasta
    group by ci.sucursal_id
  ),
  inv_prod as (
    select ci.sucursal_id as sid, count(distinct d.producto_id_sistema)::bigint as n
    from controles_inventario_detalle d
    inner join controles_inventario ci on ci.id = d.control_id
    where ci.estado = 'cerrado'
      and ci.fecha_fin is not null
      and ci.fecha_fin >= p_desde
      and ci.fecha_fin < p_hasta
    group by ci.sucursal_id
  )
  select
    s.sucursal as sucursal_id,
    coalesce(nullif(trim(s.nombrefantasia::text), ''), 'Sin nombre'::text) as nombrefantasia,
    coalesce(ip.n, 0::bigint) as productos_inventariados,
    coalesce(vc.n, 0::bigint),
    coalesce(vv.u, 0::numeric),
    coalesce(inv.n, 0::bigint)
  from sucursales s
  left join inv_prod ip on ip.sid = s.sucursal
  left join vc on vc.sid = s.sucursal
  left join vv on vv.sid = s.sucursal
  left join inv on inv.sid = s.sucursal
  order by s.nombrefantasia asc nulls last;
$$;

comment on function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz) is
  'Agregados por sucursal: productos distintos en inventarios cerrados (fecha_fin), líneas de vencimientos cargadas, unidades vendidas vencimiento, líneas inventario con diferencia.';

grant execute on function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz)
  to service_role;
grant execute on function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz)
  to authenticated;
