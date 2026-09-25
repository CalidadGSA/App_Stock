/**
 * Contrato común para leer ventas por producto desde las bases legacy
 * (Onze para farmacias, Quantio para la droguería).
 */

/** Venta neta de un producto en un día, expresada en cajas. Puede ser negativa si hubo devoluciones. */
export interface VentaDiariaProducto {
  productoId: number;
  /** Fecha de emisión en formato YYYY-MM-DD. */
  fecha: string;
  cantidad: number;
}

export type VentasLegacyErrorStatus = 'unconfigured' | 'timeout' | 'error';

export type VentasLegacyResult =
  | { ok: true; ventas: VentaDiariaProducto[]; latencyMs: number }
  | { ok: false; status: VentasLegacyErrorStatus; latencyMs: number; error: string };

export interface VentasLegacyQuery {
  /** Id de sucursal tal como lo conoce la base legacy. */
  sucursalLegacyId: number;
  productoIds: number[];
  /** Fecha de emisión mínima (inclusive), YYYY-MM-DD. */
  desdeFecha: string;
}

export type ProveedorVentasLegacy = (query: VentasLegacyQuery) => Promise<VentasLegacyResult>;

/** Lotes de IDs de producto por consulta, para no armar un IN gigante. */
export const VENTAS_LEGACY_PRODUCTOS_CHUNK = 500;

export function chunkProductoIds(ids: number[]): number[][] {
  const limpios = Array.from(new Set(ids.filter((id) => Number.isFinite(id) && id > 0)));
  const out: number[][] = [];
  for (let i = 0; i < limpios.length; i += VENTAS_LEGACY_PRODUCTOS_CHUNK) {
    out.push(limpios.slice(i, i + VENTAS_LEGACY_PRODUCTOS_CHUNK));
  }
  return out;
}

export function clasificarErrorVentasLegacy(message: string): VentasLegacyErrorStatus {
  const m = message.toLowerCase();
  if (m.includes('timeout')) return 'timeout';
  if (m.includes('no configurad') || m.includes('incompleta')) return 'unconfigured';
  return 'error';
}

/** Corre una promesa con tope de tiempo, para no dejar la vista colgada de la base legacy. */
export async function conTimeout<T>(promesa: Promise<T>, timeoutMs: number, etiqueta: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout ${etiqueta} ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
