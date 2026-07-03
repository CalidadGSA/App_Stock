-- Permiso: CRUD padrón productos (padron_final / abastecimiento)
insert into app_permissions (codigo, nombre, descripcion, categoria, orden) values
  ('admin.padron_productos', 'Padrón productos', 'CRUD padron_final (abastecimiento)', 'administracion', 245)
on conflict (codigo) do update set
  nombre = excluded.nombre,
  descripcion = excluded.descripcion,
  categoria = excluded.categoria,
  orden = excluded.orden;

insert into app_role_permissions (role_id, permission_codigo)
select r.id, 'admin.padron_productos'
from app_roles r
where r.codigo in ('superadmin', 'admin')
on conflict do nothing;
