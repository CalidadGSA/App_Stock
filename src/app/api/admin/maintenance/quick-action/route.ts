import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';
import { verifyMaintenanceQuickAction } from '@/lib/maintenance-quick-action-token';

const MAINTENANCE_ROW_ID = 1;

/**
 * GET sin sesión: enlaces firmados desde el correo de alerta Onze (activar / desactivar mantenimiento).
 * Configurar MAINTENANCE_QUICK_ACTION_SECRET (≥16 caracteres).
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim() ?? '';
  const v = verifyMaintenanceQuickAction(token);
  if (!v.ok) {
    return new NextResponse('Enlace inválido o vencido.', { status: 400, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }

  const isActive = v.action === 'on' ? 1 : 0;
  const admin = await createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from('modo_mantenimiento')
    .upsert({ id: MAINTENANCE_ROW_ID, is_active: isActive, updated_at: now }, { onConflict: 'id' });

  if (error) {
    return new NextResponse(`Error: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  const msg =
    v.action === 'on'
      ? 'Modo mantenimiento activado. Los usuarios verán el bloqueo al ingresar.'
      : 'Modo mantenimiento desactivado. La app vuelve a operar con normalidad.';
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>OK</title></head>
<body style="font-family:system-ui;padding:2rem"><p>${msg}</p>
<p><a href="/login">Ir al inicio de sesión</a></p></body></html>`;
  return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
