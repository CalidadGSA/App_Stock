-- Renombrar auditoría sorpresa → auditoría integral (textos + tipo en controles_inventario).

-- 1) Prefijos en descripción
update controles_inventario
set descripcion = replace(descripcion, 'Auditoría sorpresa — ', 'Auditoría integral — ')
where descripcion ilike 'Auditoría sorpresa —%';

update controles_inventario
set descripcion = replace(descripcion, 'auditoria sorpresa — ', 'Auditoría integral — ')
where descripcion ilike 'auditoria sorpresa —%';

-- 2) Valor de tipo
update controles_inventario
set tipo = 'auditoria_integral'
where tipo = 'auditoria_sorpresa';

-- 3) CHECK: auditoria_sorpresa → auditoria_integral
alter table controles_inventario
  drop constraint if exists controles_inventario_tipo_check;

alter table controles_inventario
  add constraint controles_inventario_tipo_check
  check (
    tipo in (
      'diario',
      'ocasional_sucursal',
      'ocasional_auditoria',
      'auditoria',
      'auditoria_integral'
    )
  );
