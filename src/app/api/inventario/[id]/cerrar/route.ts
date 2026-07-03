import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { canSeeAllInventarioTipos, getOperadorRbacContext } from '@/lib/auth/rbac';
import { validarAccesoControlPorSucursal } from '@/lib/inventario/acceso-control-sucursal';
import { cerrarControlInventario } from '@/lib/inventario/cerrar-control-inventario';
import {
  esTipoControlVisibleParaOperadorSucursal,
  inferirTipoControlInventario,
} from '@/lib/inventario/tipo-control';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** POST /api/inventario/[id]/cerrar */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: controlId } = await params;
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  const rbac = await getOperadorRbacContext();
  if (!rbac) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const esAdmin = canSeeAllInventarioTipos(rbac);

  const admin = await createAdminClient();
  const { data: control } = await admin
    .from('controles_inventario')
    .select('estado, sucursal_id, categoria_macro, fecha_inicio, origen, tipo, descripcion')
    .eq('id', controlId)
    .single();

  if (!control) return NextResponse.json({ error: 'Control no encontrado' }, { status: 404 });
  const tipoControl = inferirTipoControlInventario(control);
  if (!esAdmin && !esTipoControlVisibleParaOperadorSucursal(tipoControl)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }
  if (
    !validarAccesoControlPorSucursal({
      controlSucursalId: control.sucursal_id,
      cookieSucursalId: sucursalId,
      esAdmin,
      tipoControl,
    })
  ) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }

  const now = new Date().toISOString();
  const result = await cerrarControlInventario(admin, controlId, {
    fechaCierreIso: now,
    consolidarDiferencias: true,
  });

  if (!result.ok) {
    const status = result.code === 'ya_cerrado' ? 400 : result.code === 'no_encontrado' ? 404 : 500;
    return NextResponse.json({ error: result.message }, { status });
  }

  const { data } = await admin.from('controles_inventario').select('*').eq('id', controlId).single();

  return NextResponse.json({ data });
}
