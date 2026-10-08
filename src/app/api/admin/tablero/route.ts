import { NextRequest, NextResponse } from 'next/server';
import { requireAnyPermission } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/server';
import { filtrarSucursalesVisiblesLogin } from '@/lib/sucursales/login-sucursales';
import { esSucursalDrogueriaPorId } from '@/lib/sucursales/drogueria';
import { fechaHoyArgentinaYmd, parseYm } from '@/lib/utils';
import { calendarioActualArgentina, clampYmNoFuturo } from '@/lib/vencimientos-mes-anio-filtro';
import { cargarTableroSucursales } from '@/lib/kpis/tablero-sucursales';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * GET /api/admin/tablero?mes=YYYY-MM
 * Resumen mensual de todas las sucursales en una sola respuesta.
 */
export async function GET(request: NextRequest) {
  const guard = await requireAnyPermission(['admin.tablero', 'admin.resumen_trimestral']);
  if (!guard.ok) return guard.response;

  const mesRaw = String(request.nextUrl.searchParams.get('mes') ?? '').trim();
  const ym = mesRaw ? clampYmNoFuturo(mesRaw) : calendarioActualArgentina().ym;
  const parsed = parseYm(ym);
  if (!parsed) {
    return NextResponse.json({ error: 'mes inválido (YYYY-MM)' }, { status: 400 });
  }

  const admin = await createAdminClient();

  const { data, error } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, activa')
    .order('sucursal');

  if (error) {
    return NextResponse.json(
      { error: `No se pudieron leer las sucursales: ${error.message}` },
      { status: 500 }
    );
  }

  const sucursales = filtrarSucursalesVisiblesLogin(
    (data ?? []) as Array<{ sucursal: number; nombrefantasia: string | null; activa: boolean | null }>
  )
    .filter((s) => s.activa !== false)
    .map((s) => ({
      sucursal: Number(s.sucursal),
      nombre: String(s.nombrefantasia ?? `Sucursal ${s.sucursal}`),
      es_drogueria: esSucursalDrogueriaPorId(Number(s.sucursal)),
    }));

  try {
    const tablero = await cargarTableroSucursales(admin, {
      year: parsed.year,
      month: parsed.month,
      sucursales,
      hoyYmd: fechaHoyArgentinaYmd(),
    });
    return NextResponse.json({ data: tablero });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Error al cargar el tablero';
    console.error('GET admin/tablero:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
