-- Permiso: consolidado de diferencias de inventario (multi-sucursal).

insert into app_permissions (codigo, nombre, descripcion, categoria, orden) values
  (
    'inventario.diferencias_consolidado',
    'Diferencias consolidado',
    'Diferencias de inventario en todas las sucursales',
    'inventario',
    65
  )
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  orden = excluded.orden;

insert into app_role_permissions (role_id, permission_codigo)
select r.id, 'inventario.diferencias_consolidado'
from app_roles r
where r.codigo in ('superadmin', 'admin')
on conflict do nothing;
