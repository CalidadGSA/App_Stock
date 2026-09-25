-- Permite marcar diferencias descartadas en ajustes (repetidos / quitar manual)
-- sin confundirlas con un ajuste real exportado a Plex (ajustado_sucursal).

alter table controles_inventario_detalle
  drop constraint if exists chk_cid_estado;

alter table controles_inventario_detalle
  add constraint chk_cid_estado
  check (
    estado in (
      'en_progreso',
      'con_diferencia',
      'sin_diferencias',
      'auditado',
      'ajustado_auditoria',
      'ajustado_sucursal',
      'descartado'
    )
  );

comment on constraint chk_cid_estado on controles_inventario_detalle is
  'Estados de línea de inventario. descartado = quitada en ajustes sin exportar (no habilita auditoría).';
