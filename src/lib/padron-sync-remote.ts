/**
 * Dispara el sync de padron_final en abastecimiento-gsa
 * (GET /api/abastecimiento/cron/padron-sync con CRON_SECRET).
 */

export function isPadronSyncConfigured(): boolean {
  const base = String(process.env.PADRON_SYNC_BASE_URL ?? '').trim();
  const secret = String(process.env.PADRON_SYNC_CRON_SECRET ?? '').trim();
  return Boolean(base && secret);
}

export type PadronSyncRemoteResult = {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
};

export async function triggerPadronSyncRemote(opts?: {
  force?: boolean;
  phase?: 'all' | 'plexdr' | 'proveedores';
  signal?: AbortSignal;
}): Promise<PadronSyncRemoteResult> {
  const base = String(process.env.PADRON_SYNC_BASE_URL ?? '')
    .trim()
    .replace(/\/$/, '');
  const secret = String(process.env.PADRON_SYNC_CRON_SECRET ?? '').trim();

  if (!base || !secret) {
    throw new Error(
      'Faltan PADRON_SYNC_BASE_URL o PADRON_SYNC_CRON_SECRET en el entorno'
    );
  }

  const url = new URL(`${base}/api/abastecimiento/cron/padron-sync`);
  const phase = opts?.phase ?? 'all';
  if (phase !== 'all') url.searchParams.set('phase', phase);
  if (opts?.force) url.searchParams.set('force', '1');

  const timeoutMs = (() => {
    const raw = Number(process.env.PADRON_SYNC_FETCH_TIMEOUT_MS ?? 900_000);
    return Number.isFinite(raw) && raw > 0 ? raw : 900_000;
  })();

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  opts?.signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: 'application/json',
      },
      signal: ac.signal,
    });

    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = { error: `Respuesta no JSON (HTTP ${res.status})` };
    }

    return {
      ok: res.ok && body.ok !== false,
      status: res.status,
      body,
    };
  } finally {
    clearTimeout(timer);
    opts?.signal?.removeEventListener('abort', onAbort);
  }
}
