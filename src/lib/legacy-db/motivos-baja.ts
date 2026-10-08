/**
 * Clasificación de los motivos de `stock_operaciones` de onze_center.
 *
 * Para los KPIs no da lo mismo una baja por vencimiento que una devolución al proveedor: la
 * primera es plata perdida y la segunda se recupera. El indicador «bajas sobre facturación»
 * solo tiene sentido con las pérdidas efectivas.
 *
 * Los ids son los de `stock_operaciones_motivos.idMotivoOpStock`. Si aparece un motivo nuevo
 * que no esté acá, cae en `otros` y queda fuera del ratio: mejor que contarlo mal en silencio.
 */

export type ClaseMotivoBaja =
  /** Plata que no vuelve: vencidos, roturas, consumo interno. */
  | 'perdida'
  /** Sale del stock pero se recupera: devoluciones al proveedor o a depósito. */
  | 'recuperable'
  /** Correcciones administrativas de stock, no son pérdida ni devolución. */
  | 'ajuste'
  /** Motivo nuevo o desconocido: se muestra aparte y no entra en los ratios. */
  | 'otros';

/** idMotivoOpStock → clase. Revisado sobre los motivos cargados en onze_center. */
const CLASE_POR_MOTIVO: Readonly<Record<number, ClaseMotivoBaja>> = {
  1: 'perdida', // Faltante
  2: 'recuperable', // Devolución
  3: 'recuperable', // Próximo a vencer (sale para devolver al laboratorio)
  4: 'perdida', // Vencido
  5: 'perdida', // Roto/mal estado
  6: 'ajuste', // Exceso/sobre stock
  7: 'perdida', // Uso interno
  8: 'recuperable', // Devolución a depósito
  15: 'ajuste', // Ajuste por egreso de mercadería
  16: 'ajuste', // Ajuste por trazabilidad
  17: 'perdida', // Regalos y donaciones
};

/** Respaldo por descripción, por si cambian los ids o se agrega un motivo parecido. */
function clasePorDescripcion(descripcion: string): ClaseMotivoBaja | null {
  const d = descripcion
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

  if (d.includes('devolucion') || d.includes('proximo a vencer')) return 'recuperable';
  if (d.startsWith('ajuste')) return 'ajuste';
  if (
    d.includes('vencid') ||
    d.includes('roto') ||
    d.includes('mal estado') ||
    d.includes('faltante') ||
    d.includes('uso interno') ||
    d.includes('regalo') ||
    d.includes('donacion')
  ) {
    return 'perdida';
  }
  return null;
}

export function claseMotivoBaja(
  motivoId: number | null | undefined,
  descripcion: string | null | undefined
): ClaseMotivoBaja {
  const id = Number(motivoId);
  if (Number.isFinite(id) && CLASE_POR_MOTIVO[id]) return CLASE_POR_MOTIVO[id];
  return clasePorDescripcion(String(descripcion ?? '')) ?? 'otros';
}

export function etiquetaClaseMotivo(clase: ClaseMotivoBaja): string {
  switch (clase) {
    case 'perdida':
      return 'Pérdida efectiva';
    case 'recuperable':
      return 'Recuperable';
    case 'ajuste':
      return 'Ajuste';
    default:
      return 'Sin clasificar';
  }
}
