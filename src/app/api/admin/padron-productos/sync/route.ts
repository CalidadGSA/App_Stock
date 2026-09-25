import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/rbac';
import {
  isPadronSyncConfigured,
  triggerPadronSyncRemote,
} from '@/lib/padron-sync-remote';

export const dynamic = 'force-dynamic';
export const maxDuration = 900;

/** POST /api/admin/padron-productos/sync — dispara sync padron_final en abastecimiento. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission('admin.padron_productos');
  if (!guard.ok) return guard.response;

  if (!isPadronSyncConfigured()) {
    return NextResponse.json(
      {
        error:
          'Sync no configurado: definí PADRON_SYNC_BASE_URL y PADRON_SYNC_CRON_SECRET (mismo CRON_SECRET que abastecimiento-gsa).',
      },
      { status: 503 }
    );
  }

  let force = false;
  let phase: 'all' | 'plexdr' | 'proveedores' = 'all';
  try {
    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
      phase?: string;
    };
    force = Boolean(body.force);
    const p = String(body.phase ?? 'all').trim().toLowerCase();
    if (p === 'plexdr' || p === 'proveedores' || p === 'all') phase = p;
  } catch {
    // body vacío ok
  }

  try {
    const result = await triggerPadronSyncRemote({ force, phase });
    return NextResponse.json(result.body, { status: result.status });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error al disparar sync de padrón';
    const aborted =
      e instanceof Error &&
      (e.name === 'AbortError' || /aborted|timeout/i.test(e.message));
    return NextResponse.json(
      {
        ok: false,
        error: aborted
          ? 'El sync tardó demasiado o se interrumpió. Puede seguir corriendo en abastecimiento; reintentá más tarde.'
          : message,
      },
      { status: aborted ? 504 : 500 }
    );
  }
}
