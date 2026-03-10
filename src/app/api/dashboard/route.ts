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
  const en30dias = new Date(hoy.getTime() + 30 * 86400000).toISOString().split('T')[0];
  const en60dias = new Date(hoy.getTime() + 60 * 86400000).toISOString().split('T')[0];
  const hoyStr = hoy.toISOString().split('T')[0];

  const [invTotal, invMes, invDetalles, vencTotal, vencidos, porVencer30, porVencer60, ultimosInv, ultimosVenc] =
    await Promise.all([
      admin.from('controles_inventario').select('id', { count: 'exact', head: true }).eq('sucursal_id', sucursalId),
      admin.from('controles_inventario').select('id', { count: 'exact', head: true }).eq('sucursal_id', sucursalId).gte('created_at', inicioMes),
      admin.from('controles_inventario_detalle')
        .select('diferencia, controles_inventario!inner(sucursal_id)')
        .eq('controles_inventario.sucursal_id', sucursalId)
        .neq('diferencia', 0),
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
      admin.from('controles_inventario')
        .select('id, fecha_inicio, estado, descripcion, sucursales(nombrefantasia)')
        .eq('sucursal_id', sucursalId)
        .order('created_at', { ascending: false })
        .limit(5),
      admin.from('controles_vencimientos')
        .select('id, fecha_inicio, estado, sucursales(nombrefantasia)')
        .eq('sucursal_id', sucursalId)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

  return NextResponse.json({
    data: {
      inventarios_total: invTotal.count ?? 0,
      inventarios_mes: invMes.count ?? 0,
      items_con_diferencia: invDetalles.data?.length ?? 0,
      controles_vencimientos_total: vencTotal.count ?? 0,
      productos_vencidos: vencidos.count ?? 0,
      productos_por_vencer_30: porVencer30.count ?? 0,
      productos_por_vencer_60: porVencer60.count ?? 0,
      ultimos_inventarios: ultimosInv.data ?? [],
      ultimos_vencimientos: ultimosVenc.data ?? [],
    },
  });
}
