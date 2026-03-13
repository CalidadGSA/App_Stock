export type TipoControlInventario =
  | 'diario'
  | 'ocasional_sucursal'
  | 'ocasional_auditoria'
  | 'auditoria';

interface ControlInventarioBasico {
  origen?: string | null;
  tipo?: string | null;
  categoria_macro?: string | null;
  descripcion?: string | null;
}

function normalizarTexto(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

export function inferirTipoControlInventario(
  control: ControlInventarioBasico
): TipoControlInventario {
  if (
    control.tipo === 'diario' ||
    control.tipo === 'ocasional_sucursal' ||
    control.tipo === 'ocasional_auditoria' ||
    control.tipo === 'auditoria'
  ) {
    return control.tipo;
  }

  if (control.categoria_macro) {
    return 'diario';
  }

  const descripcion = normalizarTexto(control.descripcion);
  if (descripcion.includes('ocasional')) {
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
  return 'auditoría';
}

export function etiquetaTipoControlInventario(tipo: TipoControlInventario) {
  if (tipo === 'diario') return 'Inventario diario';
  if (tipo === 'ocasional_sucursal' || tipo === 'ocasional_auditoria') {
    return 'Inventario ocasional';
  }
  return 'Auditoría';
}

export function esTipoControlVisibleParaOperadorSucursal(
  tipo: TipoControlInventario
) {
  return tipo === 'diario' || tipo === 'ocasional_sucursal';
}

export function esTipoAuditoria(tipo: TipoControlInventario) {
  return tipo === 'auditoria';
}
