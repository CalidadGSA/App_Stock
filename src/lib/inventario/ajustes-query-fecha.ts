import { rangoFechasArgentinaIso } from '@/lib/utils';

/** Rango ISO (días calendario Argentina) para filtrar ajustes por fecha de cierre del control (no por fecha_inicio). */
export function rangoUtcAjustesInventario(desde: string, hasta: string) {
  return rangoFechasArgentinaIso(desde, hasta);
}
