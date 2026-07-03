import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { canSeeAllInventarioTipos, getOperadorRbacContext } from '@/lib/auth/rbac';
import {
  validarAccesoControlPorSucursal,
  sincronizarCookieSucursal,
} from '@/lib/inventario/acceso-control-sucursal';
import {
  esTipoAuditoria,
  esTipoControlVisibleParaOperadorSucursal,
  inferirTipoControlInventario,
} from '@/lib/inventario/tipo-control';
import {
  cargarDiferenciasSucursalPorProducto,
  diferenciaSucursalParaProducto,
} from '@/lib/inventario/diferencia-sucursal-auditoria';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** GET /api/inventario/[id] - obtener un control con sus detalles */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const { id } = await params;
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  const rbac = await getOperadorRbacContext();
  if (!rbac) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const esAdmin = canSeeAllInventarioTipos(rbac);

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('controles_inventario')
    .select(
      '*, sucursales(nombrefantasia), operadores(nombrecompleto), controles_inventario_detalle(*)'
    )
    .eq('id', id)
    .order('fecha_registro', {
      foreignTable: 'controles_inventario_detalle',
      ascending: true,
    })
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message ?? 'No encontrado' }, { status: 404 });

  const tipoControl = inferirTipoControlInventario(data);
  if (!esAdmin && !esTipoControlVisibleParaOperadorSucursal(tipoControl)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }
  if (
    !validarAccesoControlPorSucursal({
      controlSucursalId: data.sucursal_id,
      cookieSucursalId: sucursalId,
      esAdmin,
      tipoControl,
    })
  ) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  }

  const sucursalJoin = data.sucursales as { nombrefantasia?: string } | { nombrefantasia?: string }[] | null;
  const sucursalNombre = Array.isArray(sucursalJoin)
    ? sucursalJoin[0]?.nombrefantasia
    : sucursalJoin?.nombrefantasia;
  if (sucursalNombre && String(data.sucursal_id) !== String(sucursalId ?? '')) {
    await sincronizarCookieSucursal(data.sucursal_id, sucursalNombre);
  }
  // Si el inventario está en progreso, solo puede ingresar el operador que lo abrió o un admin.
  if (
    !esAdmin &&
    data.estado === 'en_progreso' &&
    String(data.usuario_id ?? '') !== String(operador.idoperador ?? '')
  ) {
    return NextResponse.json(
      { error: 'Este inventario en progreso solo puede abrirlo el operador que lo inició.' },
      { status: 403 }
    );
  }

  let payload = data;

  if (
    esTipoAuditoria(tipoControl) &&
    Array.isArray(data.controles_inventario_detalle) &&
    data.controles_inventario_detalle.length > 0
  ) {
    const productoIds = data.controles_inventario_detalle.map(
      (d: { producto_id_sistema?: string }) => String(d.producto_id_sistema ?? '')
    );
    try {
      const difSucursalMap = await cargarDiferenciasSucursalPorProducto(
        admin,
        Number(data.sucursal_id),
        productoIds
      );
      payload = {
        ...data,
        controles_inventario_detalle: data.controles_inventario_detalle.map(
          (d: { producto_id_sistema?: string }) => {
            const dif = diferenciaSucursalParaProducto(
              difSucursalMap,
              String(d.producto_id_sistema ?? '')
            );
            return {
              ...d,
              diferencia_sucursal_cajas: dif?.cajas ?? null,
              diferencia_sucursal_unidades: dif?.unidades ?? null,
            };
          }
        ),
      };
    } catch (e) {
      console.warn('[inventario/id] diferencia sucursal auditoría:', (e as Error).message);
    }
  }

  return NextResponse.json({ data: payload });
}
