import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
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
  const en30dias = new Date(hoy.getTime() + 30 * 86400000).toISOString().split('T')[0];
  const en60dias = new Date(hoy.getTime() + 60 * 86400000).toISOString().split('T')[0];
  const en90dias = new Date(hoy.getTime() + 90 * 86400000).toISOString().split('T')[0];
  const hoyStr = hoy.toISOString().split('T')[0];
  const esAdmin = operador.rol === 'admin';
  const trimestreActual = `Q${Math.floor(hoy.getMonth() / 3) + 1}${hoy.getFullYear()}`;

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
    .select('producto_id_sistema, con_diferencias, estado, diferencia, controles_inventario!inner(sucursal_id, origen, tipo)')
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

  const baseProductosQuery = admin
    .from('base_productos')
    .select('*');

  const [invTotal, invMes, invDetalles, vencTotal, vencidos, porVencer30, porVencer60, porVencer90, ultimosInv, ultimosVenc, baseProductosRows] =
    await Promise.all([
      invTotalQuery,
      invMesQuery,
      invDetallesQuery,
      admin.from('controles_vencimientos').select('id', { count: 'exact', head: true }).eq('sucursal_id', sucursalId),
      admin.from('controles_vencimientos_detalle')
        .select('id', { count: 'exact', head: true })
        .eq('controles_vencimientos.sucursal_id', sucursalId)
        .lt('fecha_vencimiento', hoyStr)
        .not('controles_vencimientos', 'is', null),
      admin.from('controles_vencimientos_detalle')
        .select('id', { count: 'exact', head: true })
        .gte('fecha_vencimiento', hoyStr)
        .lte('fecha_vencimiento', en30dias),
      admin.from('controles_vencimientos_detalle')
        .select('id', { count: 'exact', head: true })
        .gte('fecha_vencimiento', hoyStr)
        .lte('fecha_vencimiento', en60dias),
      admin.from('controles_vencimientos_detalle')
        .select('id', { count: 'exact', head: true })
        .gte('fecha_vencimiento', hoyStr)
        .lte('fecha_vencimiento', en90dias),
      ultimosInvQuery,
      admin.from('controles_vencimientos')
        .select(
          'id, fecha_inicio, estado, observaciones, categoria_macro, sucursales(nombrefantasia), operadores(nombrecompleto)'
        )
        .eq('sucursal_id', sucursalId)
        .order('created_at', { ascending: false })
        .limit(5),
      baseProductosQuery,
    ]);

  const itemsConDiferenciaUnicos = new Set<string>();
  for (const det of invDetalles.data ?? []) {
    const d = det as {
      producto_id_sistema?: string | number | null;
      con_diferencias?: number | null;
      estado?: string | null;
      diferencia?: number | null;
    };
    const productoId = String(d.producto_id_sistema ?? '').trim();
    if (!productoId) continue;
    const estadoNorm = String(d.estado ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
    if (
      estadoNorm === 'sin diferencias' ||
      estadoNorm === 'ajustado' ||
      estadoNorm === 'ajustado_sucursal' ||
      estadoNorm === 'ajustado_auditoria'
    ) {
      continue;
    }
    const tieneDiferencia =
      Number(d.con_diferencias ?? 0) === 1 ||
      Number(d.diferencia ?? 0) !== 0;
    if (!tieneDiferencia) continue;
    itemsConDiferenciaUnicos.add(productoId);
  }

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

  const attempts = [
    {
      idField: 'idsucursal',
      vecesField: 'vecesinventariado',
      fechaInicioField: 'fechainicio',
      fechaFinField: 'fechafin',
      trimestreField: 'trimestre',
    },
    {
      idField: 'idSucursal',
      vecesField: 'vecesInventariado',
      fechaInicioField: 'fechaInicio',
      fechaFinField: 'fechaFin',
      trimestreField: 'trimestre',
    },
    {
      idField: 'id_sucursal',
      vecesField: 'veces_inventariado',
      fechaInicioField: 'fecha_inicio',
      fechaFinField: 'fecha_fin',
      trimestreField: 'trimestre',
    },
  ];

  async function countBase(
    sucId: number,
    soloContados: boolean
  ): Promise<number> {
    for (const a of attempts) {
      // Intento 1: trimestre por rango de fechas.
      let q1 = admin
        .from('base_productos')
        .select('*', { count: 'exact', head: true })
        .eq(a.idField, sucId)
        .lte(a.fechaInicioField, hoyStr)
        .gte(a.fechaFinField, hoyStr);
      if (soloContados) q1 = q1.gt(a.vecesField, 0);
      const r1 = await q1;
      if (!r1.error) return r1.count ?? 0;

      // Intento 2: fallback por texto de trimestre.
      let q2 = admin
        .from('base_productos')
        .select('*', { count: 'exact', head: true })
        .eq(a.idField, sucId)
        .ilike(a.trimestreField, trimestreActual);
      if (soloContados) q2 = q2.gt(a.vecesField, 0);
      const r2 = await q2;
      if (!r2.error) return r2.count ?? 0;
    }
    return 0;
  }

  const inventarioBasePorSucursal = idsSucursales
    .map(async (idSuc) => {
      const total = await countBase(idSuc, false);
      const inventariados = await countBase(idSuc, true);
      const pendientes = Math.max(0, total - inventariados);
      const porcentaje = total > 0 ? Math.round((inventariados / total) * 100) : 0;
      return {
        sucursal_id: idSuc,
        sucursal_nombre: sucursalNombreMap.get(idSuc) ?? String(idSuc),
        inventariados,
        pendientes,
        total,
        porcentaje,
      };
    })
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
      productos_por_vencer_30: porVencer30.count ?? 0,
      productos_por_vencer_60: porVencer60.count ?? 0,
      productos_por_vencer_90: porVencer90.count ?? 0,
      ultimos_inventarios: ultimosInv.data ?? [],
      ultimos_vencimientos: ultimosVenc.data ?? [],
      inventario_base_por_sucursal: inventarioBasePorSucursalResuelto,
    },
  });
}
