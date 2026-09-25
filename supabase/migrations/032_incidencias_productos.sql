-- Incidencias: productos que más veces aparecen con diferencia de inventario.
--
-- Agrupa el detalle de los controles cerrados por sucursal y producto. Se resuelve en Postgres
-- porque contar sobre `controles_inventario_detalle` trayendo filas por PostgREST no escala
-- (es el mismo problema que arreglamos en los informes con la migración 030).
--
-- APLICAR EN SUPABASE (SQL Editor):
--   supabase/migrations/032_incidencias_productos.sql

insert into app_permissions (codigo, nombre, descripcion, categoria, orden) values
  (
    'admin.incidencias',
    'Incidencias',
    'Productos con más diferencias de inventario por sucursal',
    'administracion',
    215
  )
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  orden = excluded.orden;

insert into app_role_permissions (role_id, permission_codigo)
select r.id, 'admin.incidencias'
from app_roles r
where r.codigo in ('superadmin', 'admin')
on conflict do nothing;

-- Ranking por sucursal y producto en un intervalo [p_desde, p_hasta].
-- `p_sucursal` null = todas. El signo se decide por cajas y, si empatan, por unidades sueltas.
create or replace function public.admin_incidencias_productos(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_sucursal integer default null,
  p_limite integer default 100
)
returns table (
  sucursal_id integer,
  producto_id_sistema text,
  descripcion text,
  presentacion text,
  laboratorio text,
  veces bigint,
  controles bigint,
  faltantes bigint,
  sobrantes bigint,
  dif_cajas numeric,
  dif_unidades numeric,
  primera timestamptz,
  ultima timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with lineas as (
    select
      ci.sucursal_id,
      btrim(d.producto_id_sistema) as producto_id_sistema,
      d.control_id,
      ci.fecha_fin,
      d.descripcion,
      d.presentacion,
      d.laboratorio,
      coalesce(d.stock_real_cajas, 0) - coalesce(d.stock_sist_cajas, 0) as dif_cajas,
      coalesce(d.stock_real_unidades, 0) - coalesce(d.stock_sist_unidades, 0) as dif_unidades
    from controles_inventario_detalle d
    inner join controles_inventario ci on ci.id = d.control_id
    where ci.estado = 'cerrado'
      and coalesce(d.con_diferencias, 0) = 1
      and ci.fecha_fin is not null
      and ci.fecha_fin >= p_desde
      and ci.fecha_fin <= p_hasta
      and d.producto_id_sistema is not null
      and btrim(d.producto_id_sistema) <> ''
      and (p_sucursal is null or ci.sucursal_id = p_sucursal)
  )
  select
    l.sucursal_id,
    l.producto_id_sistema,
    (array_agg(l.descripcion order by l.fecha_fin desc))[1] as descripcion,
    (array_agg(l.presentacion order by l.fecha_fin desc))[1] as presentacion,
    (array_agg(l.laboratorio order by l.fecha_fin desc))[1] as laboratorio,
    count(*)::bigint as veces,
    count(distinct l.control_id)::bigint as controles,
    count(*) filter (
      where l.dif_cajas < 0 or (l.dif_cajas = 0 and l.dif_unidades < 0)
    )::bigint as faltantes,
    count(*) filter (
      where l.dif_cajas > 0 or (l.dif_cajas = 0 and l.dif_unidades > 0)
    )::bigint as sobrantes,
    sum(l.dif_cajas)::numeric as dif_cajas,
    sum(l.dif_unidades)::numeric as dif_unidades,
    min(l.fecha_fin) as primera,
    max(l.fecha_fin) as ultima
  from lineas l
  group by l.sucursal_id, l.producto_id_sistema
  order by count(*) desc, count(distinct l.control_id) desc
  limit greatest(1, least(coalesce(p_limite, 100), 500));
$$;

grant execute on function public.admin_incidencias_productos(timestamptz, timestamptz, integer, integer)
  to authenticated, service_role;

create index if not exists idx_cid_producto_con_dif
  on controles_inventario_detalle(producto_id_sistema)
  where con_diferencias = 1;
