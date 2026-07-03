-- Asegurar que un operador sea superadmin (ajustar IDOperador y código según tu usuario)
-- Ejemplo: operador login "ADMIN" con id 1

update operadores
set rol = 'superadmin'
where lower(operador) in ('admin', 'superadmin', 'sa')
   or idoperador = 1;

-- Vincular al rol de sistema superadmin si existe RBAC
update operadores o
set app_role_id = r.id
from app_roles r
where r.codigo = 'superadmin'
  and o.rol = 'superadmin'
  and (o.app_role_id is distinct from r.id);
