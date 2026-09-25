import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/server';
import {
  esSucursalVisibleEnLogin,
  filtrarSucursalesVisiblesLogin,
} from '@/lib/sucursales/login-sucursales';
import { fechaHoyArgentinaYmd } from '@/lib/utils';
import {
  cargarIncidencias,
  cargarHistorialIncidencia,
  FaltaFuncionIncidencias,
} from '@/lib/inventario/incidencias';
import {
  cuatrimestreActualDesdeHoy,
  rangoCalendarioCuatrimestre,
  type Cuatrimestre,
} from '@/lib/inventario/trimestre-periodo';

export const dynamic = 'force-dynamic';

const PERMISO = 'admin.incidencias';

function rangoPorDefecto(): { desde: string; hasta: string } {
  const hoy = fechaHoyArgentinaYmd();
  const { anio, cuatrimestre } = cuatrimestreActualDesdeHoy(hoy);
  const { fecha_inicio } = rangoCalendarioCuatrimestre(anio, cuatrimestre as Cuatrimestre);
  return { desde: fecha_inicio, hasta: hoy };
}

function ymdValido(valor: string | null): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor ?? '')) ? String(valor) : null;
}

/**
 * GET /api/admin/incidencias
 *   ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&sucursal_id=N&limite=100
 *   &producto=ID  → histórico de ese producto en vez del ranking
 */
export async function GET(request: NextRequest) {
  const guard = await requirePermission(PERMISO);
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const porDefecto = rangoPorDefecto();
  const desde = ymdValido(params.get('desde')) ?? porDefecto.desde;
  const hasta = ymdValido(params.get('hasta')) ?? porDefecto.hasta;

  if (desde > hasta) {
    return NextResponse.json({ error: 'El desde no puede ser posterior al hasta' }, { status: 400 });
  }

  const sucursalRaw = String(params.get('sucursal_id') ?? '').trim();
  let sucursalId: number | null = null;
  if (sucursalRaw) {
    const n = parseInt(sucursalRaw, 10);
    if (!Number.isFinite(n) || !esSucursalVisibleEnLogin(n)) {
      return NextResponse.json({ error: 'sucursal_id inválido' }, { status: 400 });
    }
    sucursalId = n;
  }

  const admin = await createAdminClient();

  try {
    const producto = String(params.get('producto') ?? '').trim();
    if (producto) {
      const historial = await cargarHistorialIncidencia(admin, {
        productoId: producto,
        sucursalId,
        fechaInicio: desde,
        fechaFin: hasta,
      });
      return NextResponse.json({
        historial: historial.filter((h) => esSucursalVisibleEnLogin(h.sucursal_id)),
      });
    }

    const limite = Math.min(500, Math.max(10, parseInt(params.get('limite') ?? '100', 10) || 100));
    const incidencias = await cargarIncidencias(admin, {
      fechaInicio: desde,
      fechaFin: hasta,
      sucursalId,
      limite,
    });

    const { data: sucursalesRows } = await admin
      .from('sucursales')
      .select('sucursal, nombrefantasia')
      .order('sucursal');

    const sucursales = filtrarSucursalesVisiblesLogin(
      (sucursalesRows ?? []) as Array<{ sucursal: number; nombrefantasia: string | null }>
    ).map((s) => ({
      sucursal: Number(s.sucursal),
      nombre: String(s.nombrefantasia ?? `Sucursal ${s.sucursal}`),
    }));

    return NextResponse.json({
      incidencias: incidencias.filter((i) => esSucursalVisibleEnLogin(i.sucursal_id)),
      sucursales,
      periodo: { desde, hasta },
    });
  } catch (e) {
    if (e instanceof FaltaFuncionIncidencias) {
      return NextResponse.json({ error: e.message, requiere_migracion: true }, { status: 503 });
    }
    const message = e instanceof Error ? e.message : 'Error al cargar incidencias';
    console.error('GET admin/incidencias:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
