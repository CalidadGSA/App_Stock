import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import {
  normalizarVueltasPsicos,
  VUELTAS_PSICOS_DEFAULT,
} from '@/lib/inventario/vueltas-psicos-sucursal';
import { filtroSucursalesExcluidasLogin } from '@/lib/sucursales/login-sucursales';
import { createAdminClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export type VueltasPsicosSucursalRow = {
  sucursal_id: number;
  nombre: string;
  vueltas_psicos: number;
  es_drogueria: boolean;
};

/** GET /api/admin/sucursales/vueltas-psicos */
export async function GET() {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const guard = await requirePermission('admin.resumen_trimestral');
  if (!guard.ok) return guard.response;

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, vueltas_psicos, es_drogueria, activa')
    .eq('activa', true)
    .not('sucursal', 'in', filtroSucursalesExcluidasLogin())
    .order('nombrefantasia');

  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('vueltas_psicos')) {
      return NextResponse.json(
        {
          error:
            'Falta la columna sucursales.vueltas_psicos. Aplicá la migración 016_sucursales_vueltas_psicos.sql en Supabase.',
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: VueltasPsicosSucursalRow[] = (data ?? []).map(
    (r: {
      sucursal: number;
      nombrefantasia: string;
      vueltas_psicos?: number | null;
      es_drogueria?: boolean | null;
    }) => ({
      sucursal_id: Number(r.sucursal),
      nombre: String(r.nombrefantasia ?? '').trim() || `Sucursal ${r.sucursal}`,
      vueltas_psicos: normalizarVueltasPsicos(r.vueltas_psicos ?? VUELTAS_PSICOS_DEFAULT),
      es_drogueria: Boolean(r.es_drogueria),
    })
  );

  return NextResponse.json({ data: rows, default: VUELTAS_PSICOS_DEFAULT });
}

/** PATCH /api/admin/sucursales/vueltas-psicos — actualizar una sucursal */
export async function PATCH(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const guard = await requirePermission('admin.resumen_trimestral');
  if (!guard.ok) return guard.response;

  let body: { sucursal_id?: number | string; vueltas_psicos?: number | string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const sucursalId = Number(body.sucursal_id);
  const vueltas = normalizarVueltasPsicos(body.vueltas_psicos);

  if (!Number.isFinite(sucursalId) || sucursalId <= 0) {
    return NextResponse.json({ error: 'sucursal_id inválido' }, { status: 400 });
  }

  if (vueltas < 1 || vueltas > 20) {
    return NextResponse.json(
      { error: 'vueltas_psicos debe estar entre 1 y 20' },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();

  const { data: existente, error: fetchError } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia')
    .eq('sucursal', sucursalId)
    .eq('activa', true)
    .maybeSingle();

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!existente) {
    return NextResponse.json({ error: 'Sucursal no encontrada o inactiva' }, { status: 404 });
  }

  const { data, error } = await admin
    .from('sucursales')
    .update({ vueltas_psicos: vueltas })
    .eq('sucursal', sucursalId)
    .select('sucursal, nombrefantasia, vueltas_psicos, es_drogueria')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const row: VueltasPsicosSucursalRow = {
    sucursal_id: Number(data.sucursal),
    nombre: String(data.nombrefantasia ?? '').trim(),
    vueltas_psicos: normalizarVueltasPsicos(data.vueltas_psicos),
    es_drogueria: Boolean(data.es_drogueria),
  };

  return NextResponse.json({ data: row });
}
