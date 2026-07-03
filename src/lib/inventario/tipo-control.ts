export type TipoControlInventario =
  | 'diario'
  | 'ocasional_sucursal'
  | 'ocasional_auditoria'
  | 'auditoria'
  | 'auditoria_integral';

/** Prefijo en `controles_inventario.descripcion`. */
export const PREFIJO_DESCRIPCION_AUDITORIA_INTEGRAL = 'Auditoría integral — ';
const PREFIJO_DESCRIPCION_AUDITORIA_INTEGRAL_LEGACY = 'Auditoría sorpresa — ';

interface ControlInventarioBasico {
  origen?: string | null;
  tipo?: string | null;
  categoria_macro?: string | null;
  descripcion?: string | null;
}

function normalizarTexto(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

export function esDescripcionAuditoriaIntegral(descripcion: string | null | undefined): boolean {
  const d = normalizarTexto(descripcion);
  return (
    d.includes('auditoría integral') ||
    d.includes('auditoria integral') ||
    d.includes('auditoría sorpresa') ||
    d.includes('auditoria sorpresa')
  );
}

export function extraerReferenciaAuditoriaIntegral(descripcion: string | null | undefined): string {
  const d = String(descripcion ?? '').trim();
  for (const prefijo of [
    PREFIJO_DESCRIPCION_AUDITORIA_INTEGRAL,
    PREFIJO_DESCRIPCION_AUDITORIA_INTEGRAL_LEGACY,
  ]) {
    if (d.startsWith(prefijo)) return d.slice(prefijo.length).trim() || d;
  }
  return d;
}

export function inferirTipoControlInventario(
  control: ControlInventarioBasico
): TipoControlInventario {
  if (
    control.tipo === 'diario' ||
    control.tipo === 'ocasional_sucursal' ||
    control.tipo === 'ocasional_auditoria' ||
    control.tipo === 'auditoria' ||
    control.tipo === 'auditoria_integral'
  ) {
    return control.tipo;
  }

  // Compatibilidad pre-migración 008
  if (control.tipo === 'auditoria_sorpresa') {
    return 'auditoria_integral';
  }

  if (esDescripcionAuditoriaIntegral(control.descripcion)) {
    return 'auditoria_integral';
  }

  if (control.categoria_macro) {
    return 'diario';
  }
  if (normalizarTexto(control.descripcion).includes('ocasional')) {
    return control.origen === 'Auditoria'
      ? 'ocasional_auditoria'
      : 'ocasional_sucursal';
  }

  if (control.origen === 'Auditoria') {
    return 'auditoria';
  }

  return 'ocasional_sucursal';
}

export function nombreTipoControlInventario(tipo: TipoControlInventario) {
  if (tipo === 'diario') return 'inventario diario';
  if (tipo === 'ocasional_sucursal') return 'inventario ocasional de sucursal';
  if (tipo === 'ocasional_auditoria') return 'inventario ocasional de auditoría';
  if (tipo === 'auditoria_integral') return 'auditoría integral';
  return 'auditoría';
}

export function etiquetaTipoControlInventario(tipo: TipoControlInventario) {
  if (tipo === 'diario') return 'Inventario diario';
  if (tipo === 'auditoria_integral') return 'Auditoría integral';
  if (tipo === 'ocasional_sucursal' || tipo === 'ocasional_auditoria') {
    return 'Inventario ocasional';
  }
  return 'Auditoría';
}

/** Escaneo libre + búsqueda en medicamentos; stock on-demand (como ocasional). */
export function esTipoInventarioEscaneoLibre(tipo: TipoControlInventario) {
  return (
    tipo === 'ocasional_sucursal' ||
    tipo === 'ocasional_auditoria' ||
    tipo === 'auditoria_integral'
  );
}

export function esTipoControlVisibleParaOperadorSucursal(
  tipo: TipoControlInventario
) {
  return tipo === 'diario' || tipo === 'ocasional_sucursal';
}

/** Tipos que cuentan en el KPI «inventarios este mes» del dashboard de sucursal. */
export const TIPOS_CONTROL_INVENTARIO_KPI_SUCURSAL = ['diario', 'ocasional_sucursal'] as const;

export function esTipoAuditoria(tipo: TipoControlInventario) {
  return tipo === 'auditoria';
}

export function esTipoDiario(tipo: TipoControlInventario) {
  return tipo === 'diario';
}

export function detalleEstaInventariado(detalle: {
  stock_real_cajas?: number | null;
  stock_real_unidades?: number | null;
}): boolean {
  return detalle.stock_real_cajas != null || detalle.stock_real_unidades != null;
}

/** Lista precargada: pendientes arriba (orden original), ya contados abajo. */
export function ordenarDetallesListaPrecargada<
  T extends {
    fecha_registro: string;
    stock_real_cajas?: number | null;
    stock_real_unidades?: number | null;
  },
>(detalles: T[]): T[] {
  return [...detalles].sort((a, b) => {
    const aInventariado = detalleEstaInventariado(a);
    const bInventariado = detalleEstaInventariado(b);
    if (aInventariado !== bInventariado) {
      return aInventariado ? 1 : -1;
    }
    return new Date(a.fecha_registro).getTime() - new Date(b.fecha_registro).getTime();
  });
}

/** Lista precargada: pendientes arriba, contados abajo. */
export function esInventarioListaPrecargada(
  tipo: TipoControlInventario,
  categoriaMacro?: string | null,
  descripcion?: string | null
): boolean {
  if (tipo === 'auditoria_integral') return true;
  if (esDescripcionAuditoriaIntegral(descripcion)) return true;
  return categoriaMacro != null && tipo === 'diario';
}

/** Ítems editables tras cerrar el control (salvo líneas ya ajustadas). */
export function esTipoInventarioEditableCerrado(tipo: TipoControlInventario): boolean {
  return (
    tipo === 'diario' ||
    tipo === 'auditoria' ||
    tipo === 'auditoria_integral' ||
    tipo === 'ocasional_sucursal' ||
    tipo === 'ocasional_auditoria'
  );
}
