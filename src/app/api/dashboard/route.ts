import { createAdminClient } from '@/lib/supabase/server';
import {
  canSeeAllInventarioTipos,
  getOperadorRbacContext,
  isSuperAdminContext,
  permissionsToArray,
} from '@/lib/auth/rbac';
import { fechaHoyArgentinaYmd, ymdAddDays } from '@/lib/utils';
import {
  TIPOS_CONTROL_INVENTARIO_KPI_SUCURSAL,
} from '@/lib/inventario/tipo-control';
import { obtenerProgresoTrimestreSucursal, sumarCantidadDetalle, trimestrePadronCompleto } from '@/lib/inventario/trimestre-base';
import { contarProductosParaDevolver } from '@/lib/vencimientos/devolver-para-devolver-masivo';
import {
  filtroUsuarioIds,
  idsOperadoresAdminLike,
  debeOcultarInventariosDeAdmin,
} from '@/lib/auth/operadores-admin-like';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const rbac = await getOperadorRbacContext();
  if (!rbac) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const operador = rbac.operador;

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();
  const hoy = new Date();
  const inicioMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString();
  const inicio60dias = new Date(hoy.getTime() - 60 * 86400000).toISOString();
  /** Vencimientos: mismo “hoy” calendario AR que /api/vencimientos/por-vencer. */
  const hoyVen = fechaHoyArgentinaYmd();
  const en30dias = ymdAddDays(hoyVen, 30);
  const en60dias = ymdAddDays(hoyVen, 60);
  const en90dias = ymdAddDays(hoyVen, 90);
  /** Para base_productos: misma lógica que POST /api/inventario (fechainicio/fechafin vs “hoy” local AR). */
  const hoyStrArgentina = hoyVen;
  const esAdmin = canSeeAllInventarioTipos(rbac);
  const idsAdminLike = await idsOperadoresAdminLike(admin);
  const excluirUsuariosAdmin = filtroUsuarioIds(idsAdminLike);
  const ocultarAdminInv = debeOcultarInventariosDeAdmin(rbac);

  let invTotalQuery = admin
    .from('controles_inventario')
    .select('id', { count: 'exact', head: true })
    .eq('sucursal_id', sucursalId)
    // No contamos inventarios de auditoría en los KPIs.
    .neq('tipo', 'auditoria')
    .neq('tipo', 'ocasional_auditoria')
    .neq('tipo', 'auditoria_integral');

  let invMesQuery = admin
    .from('controles_inventario')
    .select('id', { count: 'exact', head: true })
    .eq('sucursal_id', sucursalId)
    .gte('created_at', inicioMes)
    // KPI mensual de sucursal: siempre solo controles de sucursal (aunque quien vea sea admin).
    .neq('origen', 'Auditoria')
    .in('tipo', [...TIPOS_CONTROL_INVENTARIO_KPI_SUCURSAL]);

  // Inventarios hechos por admin/superadmin no cuentan para el KPI del mes.
  if (excluirUsuariosAdmin) {
    invMesQuery = invMesQuery.not('usuario_id', 'in', excluirUsuariosAdmin);
  }

  /** Líneas de detalle marcadas con diferencia (BD), de controles de esta sucursal y ventana de fechas. */
  let invItemsConDiferenciaQuery = admin
    .from('controles_inventario_detalle')
    .select('id, controles_inventario!inner(sucursal_id, tipo, fecha_inicio, usuario_id)', {
      count: 'exact',
      head: true,
    })
    .eq('con_diferencias', 1)
    .eq('controles_inventario.sucursal_id', sucursalId)
    .gte('controles_inventario.fecha_inicio', inicio60dias)
    .neq('controles_inventario.tipo', 'auditoria')
    .neq('controles_inventario.tipo', 'ocasional_auditoria')
    .neq('controles_inventario.tipo', 'auditoria_integral');

  let ultimosInvQuery = admin
    .from('controles_inventario')
    .select(
      'id, fecha_inicio, estado, descripcion, origen, tipo, categoria_macro, sucursales(nombrefantasia), operadores(nombrecompleto)'
    )
    .eq('sucursal_id', sucursalId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!esAdmin) {
    invTotalQuery = invTotalQuery.in('tipo', [...TIPOS_CONTROL_INVENTARIO_KPI_SUCURSAL]);
    invItemsConDiferenciaQuery = invItemsConDiferenciaQuery.in('controles_inventario.tipo', [
      ...TIPOS_CONTROL_INVENTARIO_KPI_SUCURSAL,
    ]);
    ultimosInvQuery = ultimosInvQuery.in('tipo', [...TIPOS_CONTROL_INVENTARIO_KPI_SUCURSAL]);
  }

  // Operadores de sucursal: ocultar inventarios creados por admin/superadmin.
  if (ocultarAdminInv && excluirUsuariosAdmin) {
    invTotalQuery = invTotalQuery.not('usuario_id', 'in', excluirUsuariosAdmin);
    ultimosInvQuery = ultimosInvQuery.not('usuario_id', 'in', excluirUsuariosAdmin);
    invItemsConDiferenciaQuery = invItemsConDiferenciaQuery.not(
      'controles_inventario.usuario_id',
      'in',
      excluirUsuariosAdmin
    );
  }

  const sucursalActualNum = parseInt(sucursalId, 10);

  const [invTotal, invMes, invItemsConDiferencia, vencTotal, porVencer30, porVencer60, porVencer90, ultimosInv, ultimosVenc, productosParaDevolver] =
    await Promise.all([
      invTotalQuery,
      invMesQuery,
      invItemsConDiferenciaQuery,
      admin.from('controles_vencimientos').select('id', { count: 'exact', head: true }).eq('sucursal_id', sucursalId),
      admin
        .from('controles_vencimientos_detalle')
        .select('cantidad, controles_vencimientos!inner(sucursal_id)')
        .eq('controles_vencimientos.sucursal_id', sucursalId)
        .gte('fecha_vencimiento', hoyVen)
        .lte('fecha_vencimiento', en30dias)
        .eq('devuelto', 0)
        .eq('eliminado', 0),
      admin
        .from('controles_vencimientos_detalle')
        .select('cantidad, controles_vencimientos!inner(sucursal_id)')
        .eq('controles_vencimientos.sucursal_id', sucursalId)
        .gte('fecha_vencimiento', hoyVen)
        .lte('fecha_vencimiento', en60dias)
        .eq('devuelto', 0)
        .eq('eliminado', 0),
      admin
        .from('controles_vencimientos_detalle')
        .select('cantidad, controles_vencimientos!inner(sucursal_id)')
        .eq('controles_vencimientos.sucursal_id', sucursalId)
        .gte('fecha_vencimiento', hoyVen)
        .lte('fecha_vencimiento', en90dias)
        .eq('devuelto', 0)
        .eq('eliminado', 0),
      ultimosInvQuery,
      admin.from('controles_vencimientos')
        .select(
          'id, fecha_inicio, estado, observaciones, categoria_macro, sucursales(nombrefantasia), operadores(nombrecompleto)'
        )
        .eq('sucursal_id', sucursalId)
        .order('created_at', { ascending: false })
        .limit(5),
      contarProductosParaDevolver(admin, sucursalActualNum, hoyVen),
    ]);

  const idsSucursales = [sucursalActualNum];

  const sucursalNombreMap = new Map<number, string>();
  if (idsSucursales.length > 0) {
    const { data: sucursalesRows } = await admin
      .from('sucursales')
      .select('sucursal, nombrefantasia')
      .in('sucursal', idsSucursales);
    for (const s of (sucursalesRows ?? []) as Array<{ sucursal: number; nombrefantasia: string | null }>) {
      sucursalNombreMap.set(Number(s.sucursal), String(s.nombrefantasia ?? s.sucursal));
    }
  }

  const inventarioBasePorSucursal = idsSucursales.map(async (idSuc) => {
    const progreso = await obtenerProgresoTrimestreSucursal(admin, idSuc, hoyStrArgentina);
    const { total, inventariados, pendientes, porcentaje } = progreso;
    return {
      sucursal_id: idSuc,
      sucursal_nombre: sucursalNombreMap.get(idSuc) ?? String(idSuc),
      inventariados,
      pendientes,
      total,
      porcentaje,
      trimestre_padron_completo: trimestrePadronCompleto(progreso),
      por_macro: progreso.por_macro ?? [],
    };
  });
  const inventarioBasePorSucursalResuelto = (
    await Promise.all(inventarioBasePorSucursal)
  ).sort((a, b) => a.sucursal_nombre.localeCompare(b.sucursal_nombre));

  return NextResponse.json({
    data: {
      rol: operador.rol ?? 'operador_sucursal',
      es_superadmin: isSuperAdminContext(rbac),
      permissions: permissionsToArray(rbac),
      inventarios_total: invTotal.count ?? 0,
      inventarios_mes: invMes.count ?? 0,
      items_con_diferencia: invItemsConDiferencia.count ?? 0,
      controles_vencimientos_total: vencTotal.count ?? 0,
      productos_para_devolver: productosParaDevolver,
      productos_por_vencer_30: sumarCantidadDetalle(
        (porVencer30.data ?? []) as Array<{ cantidad?: number | null }>
      ),
      productos_por_vencer_60: sumarCantidadDetalle(
        (porVencer60.data ?? []) as Array<{ cantidad?: number | null }>
      ),
      productos_por_vencer_90: sumarCantidadDetalle(
        (porVencer90.data ?? []) as Array<{ cantidad?: number | null }>
      ),
      ultimos_inventarios: ultimosInv.data ?? [],
      ultimos_vencimientos: ultimosVenc.data ?? [],
      inventario_base_por_sucursal: inventarioBasePorSucursalResuelto,
    },
  });
}
