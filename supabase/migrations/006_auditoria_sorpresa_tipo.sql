-- Tipo de control: auditoría sorpresa (lista CSV precargada, flujo como inventario ocasional)
update controles_inventario
set tipo = 'auditoria_sorpresa'
where tipo is null
   or tipo not in (
     'diario',
     'ocasional_sucursal',
     'ocasional_auditoria',
     'auditoria',
     'auditoria_sorpresa'
   );
