-- Corrige vencidos_costo: fecha de vencimiento en el mes y saldo pendiente (no cargados ni vendidos del todo).

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
  vencidos_costo numeric,
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
  vc_costo as (
    select
      cv.sucursal_id as sid,
      coalesce(
        sum(
          case
            when coalesce(d.vendido, 0) = 1 then 0::double precision
            when coalesce(d.cantidad, 0) <= 0 then 0::double precision
            else d.cantidad * coalesce(m.costo, 0::double precision)
          end
        ),
        0
      )::numeric as valor
    from controles_vencimientos_detalle d
    inner join controles_vencimientos cv on cv.id = d.control_id
    left join medicamentos m on m.codplex::text = trim(d.producto_id_sistema)
    where coalesce(d.eliminado, 0) = 0
      and d.fecha_vencimiento >= (p_desde at time zone 'America/Argentina/Buenos_Aires')::date
      and d.fecha_vencimiento < (p_hasta at time zone 'America/Argentina/Buenos_Aires')::date
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
    coalesce(vcc.valor, 0::numeric),
    coalesce(vv.u, 0::numeric),
    coalesce(inv.n, 0::bigint)
  from sucursales s
  left join inv_prod ip on ip.sid = s.sucursal
  left join vc on vc.sid = s.sucursal
  left join vc_costo vcc on vcc.sid = s.sucursal
  left join vv on vv.sid = s.sucursal
  left join inv on inv.sid = s.sucursal
  order by s.nombrefantasia asc nulls last;
$$;

comment on function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz) is
  'Agregados por sucursal: inventariados, vencidos cargados (registro), costo vencidos (fecha_vencimiento, saldo), vendidas, líneas con diferencia.';

grant execute on function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz)
  to service_role;
grant execute on function public.admin_estadisticas_mensual_sucursal(timestamptz, timestamptz)
  to authenticated;
