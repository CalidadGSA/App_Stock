-- Permitir tipo auditoria_sorpresa en controles_inventario (CHECK existente en Supabase).

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
      'auditoria_sorpresa'
    )
  );
