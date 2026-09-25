import { createAdminClient } from '@/lib/supabase/server';
import { canSeeAllInventarioTipos, getOperadorRbacContext } from '@/lib/auth/rbac';
import { validarAccesoControlPorSucursal } from '@/lib/inventario/acceso-control-sucursal';
import { cerrarControlInventario } from '@/lib/inventario/cerrar-control-inventario';
import { marcarNoControladosAuditoriaYLiberarOrigen } from '@/lib/inventario/marcar-no-controlados-auditoria';
import {
  esTipoAuditoria,
  esTipoControlVisibleParaOperadorSucursal,
  inferirTipoControlInventario,
} from '@/lib/inventario/tipo-control';
import { NextRequest, NextResponse } from 'next/server';
import { getSucursalIdSesion } from '@/lib/sucursales/sucursal-session';

/** POST /api/inventario/[id]/cerrar */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const rbac = await getOperadorRbacContext();
  if (!rbac) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id: controlId } = await params;
  const sucursalId = await getSucursalIdSesion();
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

  let marcarNoControlados = false;
  try {
    const body = (await request.json()) as { marcar_no_controlados?: boolean };
    marcarNoControlados = Boolean(body?.marcar_no_controlados);
  } catch {
    // body vacío = cierre normal
  }

  if (marcarNoControlados) {
    if (!esTipoAuditoria(tipoControl)) {
      return NextResponse.json(
        { error: 'Marcar no controlados solo aplica a auditoría de stock.' },
        { status: 400 }
      );
    }
    try {
      await marcarNoControladosAuditoriaYLiberarOrigen(
        admin,
        controlId,
        Number(control.sucursal_id)
      );
    } catch (e) {
      console.error('marcar_no_controlados:', e);
      return NextResponse.json(
        {
          error:
            e instanceof Error
              ? e.message
              : 'No se pudieron marcar los productos no controlados.',
        },
        { status: 500 }
      );
    }
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
