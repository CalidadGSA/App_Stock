export function claveDupAjuste(producto_id_sistema: string, codigo_barras: string | null | undefined) {
  return `${String(producto_id_sistema).trim()}::${String(codigo_barras ?? '').trim()}`;
}

export type DiferenciaAjusteConFecha = {
  id: string;
  producto_id_sistema: string;
  codigo_barras: string | null | undefined;
  fecha_registro?: string | null;
  fecha_fin_control?: string | null;
};

/** Timestamp para ordenar: cierre del control o registro de la línea. */
export function fechaReferenciaDiferenciaAjuste(d: DiferenciaAjusteConFecha): number {
  const f = String(d.fecha_registro ?? d.fecha_fin_control ?? '').trim();
  const t = Date.parse(f);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Por cada producto+código repetido, devuelve los ids de las filas más viejas
 * (se conserva solo la más reciente).
 */
export function idsDuplicadosMasViejosADescartar<T extends DiferenciaAjusteConFecha>(
  items: T[]
): string[] {
  const porClave = new Map<string, T[]>();
  for (const d of items) {
    const k = claveDupAjuste(d.producto_id_sistema, d.codigo_barras);
    const arr = porClave.get(k) ?? [];
    arr.push(d);
    porClave.set(k, arr);
  }

  const ids: string[] = [];
  for (const grupo of porClave.values()) {
    if (grupo.length <= 1) continue;
    const ordenado = [...grupo].sort(
      (a, b) => fechaReferenciaDiferenciaAjuste(b) - fechaReferenciaDiferenciaAjuste(a)
    );
    for (let i = 1; i < ordenado.length; i++) {
      ids.push(ordenado[i].id);
    }
  }
  return ids;
}
