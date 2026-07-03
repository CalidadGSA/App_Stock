import type { VentaPosteriorInput } from '@/lib/legacy-db/mysql-stock';

export type VentaPosteriorCheckStatus =
  | 'off'
  | 'full'
  | 'skipped_slow_db'
  | 'skipped_unavailable';

export type VentaPosteriorResolveResult = {
  map: Map<string, boolean>;
  status: VentaPosteriorCheckStatus;
  mysqlLatencyMs: number | null;
};

/**
 * Health check Onze + consulta de ventas posteriores (misma lógica que por-vencer).
 */
export async function resolverVentaPosteriorFlags(
  detalles: VentaPosteriorInput[],
  enabled: boolean
): Promise<VentaPosteriorResolveResult> {
  if (!enabled || detalles.length === 0) {
    return { map: new Map(), status: 'off', mysqlLatencyMs: null };
  }

  const { checkOnzeDbReadyForHeavyRead, getVentaPosteriorFlagsForDetalles } = await import(
    '@/lib/legacy-db/mysql-stock'
  );
  const readiness = await checkOnzeDbReadyForHeavyRead();

  if (!readiness.ready) {
    const status: VentaPosteriorCheckStatus =
      readiness.reason === 'slow' ? 'skipped_slow_db' : 'skipped_unavailable';
    console.warn(
      '[vencimientos] Verificación venta posterior omitida:',
      readiness.reason,
      readiness.latencyMs,
      'ms',
      readiness.detail ?? ''
    );
    return { map: new Map(), status, mysqlLatencyMs: readiness.latencyMs };
  }

  const map = await getVentaPosteriorFlagsForDetalles(detalles);
  return { map, status: 'full', mysqlLatencyMs: readiness.latencyMs };
}
