/** Orden de columnas del resumen de diferencias (seguro para client y server). */

export type OrdenColumnaDiferenciasResumen =
  | 'descripcion'
  | 'codigo_barras'
  | 'control_origen'
  | 'control_tipo'
  | 'stock_sist'
  | 'stock_real'
  | 'diferencia'
  | 'monto'
  | 'ajustado'
  | 'fecha_control'
  | 'operador';

export type OrdenDirDiferenciasResumen = 'asc' | 'desc';

const ORDEN_COLUMNAS_VALIDAS = new Set<string>([
  'descripcion',
  'codigo_barras',
  'control_origen',
  'control_tipo',
  'stock_sist',
  'stock_real',
  'diferencia',
  'monto',
  'ajustado',
  'fecha_control',
  'operador',
]);

export function parseOrdenColumnaDiferenciasResumen(
  raw: string | null | undefined
): OrdenColumnaDiferenciasResumen {
  const v = String(raw ?? '').trim();
  if (ORDEN_COLUMNAS_VALIDAS.has(v)) return v as OrdenColumnaDiferenciasResumen;
  return 'fecha_control';
}

export function parseOrdenDirDiferenciasResumen(
  raw: string | null | undefined
): OrdenDirDiferenciasResumen {
  return String(raw ?? '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
}

type FilaOrdenable = {
  descripcion: string;
  codigo_barras: string;
  control_origen: string | null;
  control_tipo: string | null;
  stockSistCajas: number;
  stockSistUnidades: number;
  stockRealCajas: number;
  stockRealUnidades: number;
  diffCajas: number;
  diffUnidades: number;
  monto: number | null;
  ajustado: boolean;
  operador: string;
  fecha_control: string;
};

function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base', numeric: true });
}

function compararNumero(a: number, b: number): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function compararFilasDiferenciasResumen(
  a: FilaOrdenable,
  b: FilaOrdenable,
  col: OrdenColumnaDiferenciasResumen,
  dir: OrdenDirDiferenciasResumen
): number {
  let cmp = 0;
  switch (col) {
    case 'descripcion':
      cmp = compararTexto(a.descripcion, b.descripcion);
      break;
    case 'codigo_barras':
      cmp = compararTexto(String(a.codigo_barras ?? ''), String(b.codigo_barras ?? ''));
      break;
    case 'control_origen':
      cmp = compararTexto(String(a.control_origen ?? ''), String(b.control_origen ?? ''));
      break;
    case 'control_tipo':
      cmp = compararTexto(String(a.control_tipo ?? ''), String(b.control_tipo ?? ''));
      break;
    case 'stock_sist':
      cmp = compararNumero(a.stockSistCajas, b.stockSistCajas);
      if (cmp === 0) cmp = compararNumero(a.stockSistUnidades, b.stockSistUnidades);
      break;
    case 'stock_real':
      cmp = compararNumero(a.stockRealCajas, b.stockRealCajas);
      if (cmp === 0) cmp = compararNumero(a.stockRealUnidades, b.stockRealUnidades);
      break;
    case 'diferencia':
      cmp = compararNumero(a.diffCajas, b.diffCajas);
      if (cmp === 0) cmp = compararNumero(a.diffUnidades, b.diffUnidades);
      break;
    case 'monto':
      cmp = compararNumero(a.monto ?? 0, b.monto ?? 0);
      break;
    case 'ajustado':
      cmp = compararNumero(a.ajustado ? 1 : 0, b.ajustado ? 1 : 0);
      break;
    case 'operador':
      cmp = compararTexto(a.operador, b.operador);
      break;
    case 'fecha_control':
    default:
      cmp = a.fecha_control.localeCompare(b.fecha_control);
      break;
  }
  if (cmp === 0 && col !== 'descripcion') {
    cmp = compararTexto(a.descripcion, b.descripcion);
  }
  return dir === 'asc' ? cmp : -cmp;
}
