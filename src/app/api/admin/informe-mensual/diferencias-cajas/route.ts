import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import { fechaHoyArgentinaYmd, parseYm } from '@/lib/utils';
import {
  cargarDetalleDiferenciasCajasValor,
  type DiferenciaCajasValorFila,
  type DiferenciaCajasValorTotales,
  type SignoDiferenciaCajas,
} from '@/lib/inventario/informe-mensual-diferencias-cajas';
import { NextRequest, NextResponse } from 'next/server';

export type { DiferenciaCajasValorFila, DiferenciaCajasValorTotales, SignoDiferenciaCajas };

function parseSigno(raw: string | null): SignoDiferenciaCajas {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'positiva' || s === 'positivas' || s === 'positivo') return 'positiva';
  if (s === 'negativa' || s === 'negativas' || s === 'negativo') return 'negativa';
  return 'todas';
}

/** GET /api/admin/informe-mensual/diferencias-cajas?mes=YYYY-MM&sucursal_id=&signo=todas|positiva|negativa */
export async function GET(req: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const guard = await requirePermission('admin.informe_mensual_sucursales');
  if (!guard.ok) return guard.response;

  const sp = req.nextUrl.searchParams;
  const mes = sp.get('mes')?.trim() ?? '';
  const parsed = parseYm(mes);
  if (!parsed) {
    return NextResponse.json(
      { error: 'Parámetro mes inválido (use YYYY-MM)' },
      { status: 400 }
    );
  }
  const mesSeleccionYm = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;
  const mesActualYm = fechaHoyArgentinaYmd().slice(0, 7);
  if (mesSeleccionYm > mesActualYm) {
    return NextResponse.json(
      { error: 'No se puede consultar un mes posterior al mes actual (Argentina).' },
      { status: 400 }
    );
  }

  const sucursalRaw = sp.get('sucursal_id')?.trim() ?? '';
  const sucursalId = sucursalRaw ? Number(sucursalRaw) : null;
  if (sucursalRaw && !Number.isFinite(sucursalId)) {
    return NextResponse.json({ error: 'sucursal_id inválido' }, { status: 400 });
  }

  const signo = parseSigno(sp.get('signo'));

  const admin = await createAdminClient();
  const { filas, totales } = await cargarDetalleDiferenciasCajasValor(
    admin,
    parsed.year,
    parsed.month,
    { sucursalId, signo }
  );

  return NextResponse.json({
    mes,
    signo,
    sucursal_id: sucursalId,
    filas,
    totales,
  });
}
