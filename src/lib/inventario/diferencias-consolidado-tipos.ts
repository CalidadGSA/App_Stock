/** Valores de `controles_inventario.tipo` para filtros. */
export const TIPOS_INVENTARIO_FILTRO = [
  { value: '', label: 'Todos los tipos' },
  { value: 'diario', label: 'Inventario diario' },
  { value: 'ocasional_sucursal', label: 'Ocasional sucursal' },
  { value: 'ocasional_auditoria', label: 'Ocasional auditoría' },
  { value: 'auditoria', label: 'Auditoría' },
  { value: 'auditoria_integral', label: 'Auditoría integral' },
] as const;

export const ORIGENES_DIFERENCIA_FILTRO = [
  { value: '', label: 'Todos los orígenes' },
  { value: 'sucursal', label: 'Sucursal' },
  { value: 'auditoria', label: 'Auditoría' },
] as const;

/** Tipos habituales en controles de sucursal (sin auditoría). */
export const TIPOS_INVENTARIO_SUCURSAL_FILTRO = [
  { value: '', label: 'Todos los tipos' },
  { value: 'diario', label: 'Inventario diario' },
  { value: 'ocasional_sucursal', label: 'Ocasional sucursal' },
] as const;

/** Tipos de controles de auditoría. */
export const TIPOS_INVENTARIO_AUDITORIA_FILTRO = [
  { value: '', label: 'Todos los tipos' },
  { value: 'ocasional_auditoria', label: 'Ocasional auditoría' },
  { value: 'auditoria', label: 'Auditoría' },
  { value: 'auditoria_integral', label: 'Auditoría integral' },
  { value: 'auditoria_sorpresa', label: 'Auditoría sorpresa' },
] as const;
