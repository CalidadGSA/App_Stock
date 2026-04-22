import { NextRequest, NextResponse } from 'next/server';
import {
  canSignMaintenanceQuickAction,
  signMaintenanceQuickAction,
} from '@/lib/maintenance-quick-action-token';

function appBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;
  return 'http://localhost:3000';
}

function quickActionUrl(base: string, token: string): string {
  return `${base}/api/admin/maintenance/quick-action?token=${encodeURIComponent(token)}`;
}

function authorized(request: NextRequest): boolean {
  const secret = process.env.N8N_ONZE_HEALTH_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }
    console.warn(
      '[n8n/onze-health-mail-context] N8N_ONZE_HEALTH_SECRET ausente: se permite solo en desarrollo.'
    );
    return true;
  }
  const auth = request.headers.get('authorization') ?? '';
  return auth === `Bearer ${secret}`;
}

/**
 * Llamada desde n8n (cada 5 min u otro schedule) después de evaluar MySQL y modo_mantenimiento.
 * Devuelve las URLs firmadas para los botones del correo. No envía mail ni consulta Onze.
 *
 * POST (body opcional {})
 * Header: Authorization: Bearer <N8N_ONZE_HEALTH_SECRET>
 */
export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const base = appBaseUrl();
  const can = canSignMaintenanceQuickAction();
  const tokenOn = can ? signMaintenanceQuickAction('on') : null;
  const tokenOff = can ? signMaintenanceQuickAction('off') : null;

  return NextResponse.json({
    ok: true,
    appBaseUrl: base,
    tokenOn,
    tokenOff,
    tokensConfigured: can,
    urls: {
      activateMaintenance: tokenOn ? quickActionUrl(base, tokenOn) : null,
      deactivateMaintenance: tokenOff ? quickActionUrl(base, tokenOff) : null,
    },
  });
}
