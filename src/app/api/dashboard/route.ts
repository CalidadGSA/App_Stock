import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { fechaHoyArgentinaYmd, ymdAddDays } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

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
  const esAdmin = operador.rol === 'admin';

  let invTotalQuery = admin
    .from('controles_inventario')
    .select('id', { count: 'exact', head: true })
    .eq('sucursal_id', sucursalId)
    // No contamos inventarios de auditoría en los KPIs.
    .neq('tipo', 'auditoria')
    .neq('tipo', 'ocasional_auditoria');

  let invMesQuery = admin
    .from('controles_inventario')
    .select('id', { count: 'exact', head: true })
    .eq('sucursal_id', sucursalId)
    .gte('created_at', inicioMes)
    // No contamos inventarios de auditoría en los KPIs.
    .neq('tipo', 'auditoria')
    .neq('tipo', 'ocasional_auditoria');

  let invDetallesQuery = admin
    .from('controles_inventario_detalle')
    .select('producto_id_sistema, con_diferencias, controles_inventario!inner(sucursal_id, origen, tipo)')
    .eq('controles_inventario.sucursal_id', sucursalId)
    .gte('controles_inventario.fecha_inicio', inicio60dias)
    .neq('controles_inventario.tipo', 'auditoria')
    .neq('controles_inventario.tipo', 'ocasional_auditoria');

  let ultimosInvQuery = admin
    .from('controles_inventario')
    .select(
      'id, fecha_inicio, estado, descripcion, origen, tipo, categoria_macro, sucursales(nombrefantasia), operadores(nombrecompleto)'
    )
    .eq('sucursal_id', sucursalId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (!esAdmin) {
    invTotalQuery = invTotalQuery.in('tipo', ['diario', 'ocasional_sucursal']);
    invMesQuery = invMesQuery.in('tipo', ['diario', 'ocasional_sucursal']);
    invDetallesQuery = invDetallesQuery.in('controles_inventario.tipo', ['diario', 'ocasional_sucursal']);
    ultimosInvQuery = ultimosInvQuery.in('tipo', ['diario', 'ocasional_sucursal']);
  }

  const [invTotal, invMes, invDetalles, vencTotal, vencidos, porVencer30, porVencer60, porVencer90, ultimosInv, ultimosVenc] =
    await Promise.all([
      invTotalQuery,
      invMesQuery,
      invDetallesQuery,
      admin.from('controles_vencimientos').select('id', { count: 'exact', head: true }).eq('sucursal_id', sucursalId),
      admin
        .from('controles_vencimientos_detalle')
        .select('id, controles_vencimientos!inner(sucursal_id)', { count: 'exact', head: true })
        .eq('controles_vencimientos.sucursal_id', sucursalId)
        .lt('fecha_vencimiento', hoyVen)
        .eq('devuelto', 0)
        .eq('eliminado', 0),
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
    ]);

  const itemsConDiferenciaUnicos = new Set<string>();
  for (const det of invDetalles.data ?? []) {
    const d = det as {
      producto_id_sistema?: string | number | null;
      con_diferencias?: number | boolean | string | null;
    };
    const productoId = String(d.producto_id_sistema ?? '').trim();
    if (!productoId) continue;
    // KPI por ítem: solo cuenta productos con flag de diferencia activo.
    if (Number(d.con_diferencias ?? 0) !== 1 && d.con_diferencias !== true) continue;
    itemsConDiferenciaUnicos.add(productoId);
  }

  const sumarCantidad = (rows: Array<{ cantidad?: number | null }> | null | undefined): number =>
    Math.max(
      0,
      Math.round(
        (rows ?? []).reduce((acc: number, r) => {
          return acc + Number(r.cantidad ?? 0);
        }, 0)
      )
    );

  const sucursalActualNum = parseInt(sucursalId, 10);
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

  /**
   * Misma idea que POST /api/inventario: el trimestre vigente sale de base_productos
   * (fechainicio <= hoy <= fechafin), no de un string fijo tipo Q12026.
   */
  async function contarProgresoBaseProductos(sucId: number): Promise<{
    total: number;
    inventariados: number;
    pendientes: number;
    porcentaje: number;
  }> {
    const variantes = [
      {
        id: 'idsucursal',
        ini: 'fechainicio',
        fin: 'fechafin',
        veces: 'vecesinventariado',
        trim: 'trimestre',
      },
      {
        id: 'idSucursal',
        ini: 'fechaInicio',
        fin: 'fechaFin',
        veces: 'vecesInventariado',
        trim: 'trimestre',
      },
    ] as const;

    for (const v of variantes) {
      const { data: muestra, error: errMuestra } = await admin
        .from('base_productos')
        .select(v.trim)
        .eq(v.id, sucId)
        .lte(v.ini, hoyStrArgentina)
        .gte(v.fin, hoyStrArgentina)
        .limit(1);

      if (errMuestra) continue;

      const trimestreDb = String((muestra?.[0] as { trimestre?: string } | undefined)?.trimestre ?? '').trim();
      if (!trimestreDb) {
        return { total: 0, inventariados: 0, pendientes: 0, porcentaje: 0 };
      }

      const { count: total, error: errTotal } = await admin
        .from('base_productos')
        .select('*', { count: 'exact', head: true })
        .eq(v.id, sucId)
        .eq(v.trim, trimestreDb);

      if (errTotal) continue;

      const { count: inventariados, error: errInv } = await admin
        .from('base_productos')
        .select('*', { count: 'exact', head: true })
        .eq(v.id, sucId)
        .eq(v.trim, trimestreDb)
        .gt(v.veces, 0);

      if (errInv) continue;

      const t = total ?? 0;
      const inv = inventariados ?? 0;
      const pendientes = Math.max(0, t - inv);
      const porcentaje = t > 0 ? Math.round((inv / t) * 100) : 0;
      return { total: t, inventariados: inv, pendientes, porcentaje };
    }

    return { total: 0, inventariados: 0, pendientes: 0, porcentaje: 0 };
  }

  const inventarioBasePorSucursal = idsSucursales.map(async (idSuc) => {
    const { total, inventariados, pendientes, porcentaje } = await contarProgresoBaseProductos(idSuc);
    return {
      sucursal_id: idSuc,
      sucursal_nombre: sucursalNombreMap.get(idSuc) ?? String(idSuc),
      inventariados,
      pendientes,
      total,
      porcentaje,
    };
  });
  const inventarioBasePorSucursalResuelto = (
    await Promise.all(inventarioBasePorSucursal)
  ).sort((a, b) => a.sucursal_nombre.localeCompare(b.sucursal_nombre));

  return NextResponse.json({
    data: {
      rol: operador.rol ?? 'operador_sucursal',
      inventarios_total: invTotal.count ?? 0,
      inventarios_mes: invMes.count ?? 0,
      items_con_diferencia: itemsConDiferenciaUnicos.size,
      controles_vencimientos_total: vencTotal.count ?? 0,
      productos_vencidos: vencidos.count ?? 0,
      productos_por_vencer_30: sumarCantidad((porVencer30.data ?? []) as Array<{ cantidad?: number | null }>),
      productos_por_vencer_60: sumarCantidad((porVencer60.data ?? []) as Array<{ cantidad?: number | null }>),
      productos_por_vencer_90: sumarCantidad((porVencer90.data ?? []) as Array<{ cantidad?: number | null }>),
      ultimos_inventarios: ultimosInv.data ?? [],
      ultimos_vencimientos: ultimosVenc.data ?? [],
      inventario_base_por_sucursal: inventarioBasePorSucursalResuelto,
    },
  });
}
