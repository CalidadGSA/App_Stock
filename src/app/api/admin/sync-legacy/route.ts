import { NextResponse } from 'next/server';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import {
  getOperadorRbacContext,
  isSuperAdminContext,
} from '@/lib/auth/rbac';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

declare global {
   
  var __gestionstockLegacySyncManual: {
    inProgress: boolean;
    startedAt: string | null;
    requestedBy: string | null;
    child: ChildProcess | null;
  } | undefined;
}

function getManualSyncState() {
  if (!globalThis.__gestionstockLegacySyncManual) {
    globalThis.__gestionstockLegacySyncManual = {
      inProgress: false,
      startedAt: null,
      requestedBy: null,
      child: null,
    };
  }
  return globalThis.__gestionstockLegacySyncManual;
}

function isChildAlive(child: ChildProcess | null | undefined): boolean {
  return Boolean(child && child.exitCode === null && !child.killed);
}

/** GET — estado del sync manual en este proceso. */
export async function GET() {
  const ctx = await getOperadorRbacContext();
  if (!ctx) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!isSuperAdminContext(ctx)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const state = getManualSyncState();
  const alive = isChildAlive(state.child);
  if (state.inProgress && !alive) {
    state.inProgress = false;
    state.child = null;
  }

  return NextResponse.json({
    inProgress: state.inProgress && alive,
    startedAt: state.startedAt,
    requestedBy: state.requestedBy,
  });
}

/**
 * POST /api/admin/sync-legacy — dispara el lote legacy → Supabase (mismo que `npm run sync:now`).
 * Solo superadmin. Corre en un proceso Node hijo (evita bundler Turbopack/`createRequire`).
 */
export async function POST() {
  const ctx = await getOperadorRbacContext();
  if (!ctx) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (!isSuperAdminContext(ctx)) {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const state = getManualSyncState();
  if (state.inProgress && isChildAlive(state.child)) {
    return NextResponse.json(
      {
        ok: false,
        code: 'ALREADY_RUNNING',
        message: 'Ya hay un sync de la app en curso en este servidor.',
        startedAt: state.startedAt,
        requestedBy: state.requestedBy,
      },
      { status: 409 }
    );
  }

  const scriptPath = path.join(process.cwd(), 'scripts', 'run-legacy-sync-now.cjs');
  const requestedBy =
    ctx.operador.operador ||
    String(ctx.operador.idoperador) ||
    'superadmin';

  let child: ChildProcess;
  try {
    child = spawn(process.execPath, [scriptPath], {
      cwd: process.cwd(),
      env: { ...process.env, LEGACY_SYNC_MANUAL: '1' },
      stdio: 'inherit',
      windowsHide: true,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo iniciar el sync';
    console.error('[sync-legacy] spawn:', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  state.inProgress = true;
  state.startedAt = new Date().toISOString();
  state.requestedBy = requestedBy;
  state.child = child;

  console.log(
    `[sync-legacy] Manual START by ${requestedBy} pid=${child.pid ?? '?'} script=${scriptPath}`
  );

  child.on('error', (err) => {
    console.error('[sync-legacy] child error:', err);
    if (state.child === child) {
      state.inProgress = false;
      state.child = null;
    }
  });

  child.on('exit', (code, signal) => {
    console.log(
      `[sync-legacy] Manual END by ${requestedBy} code=${code} signal=${signal ?? ''}`
    );
    if (state.child === child) {
      state.inProgress = false;
      state.child = null;
    }
  });

  return NextResponse.json(
    {
      ok: true,
      message:
        'Sync de la app iniciado (sucursales, operadores, medicamentos, catálogos, Quantio). Puede tardar varios minutos; revisá la consola del servidor.',
      startedAt: state.startedAt,
      requestedBy,
      pid: child.pid ?? null,
    },
    { status: 202 }
  );
}
