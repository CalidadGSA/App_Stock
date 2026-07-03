import { createAdminClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/rbac';
import { NextRequest, NextResponse } from 'next/server';

/** GET /api/ajustes - lista de ajustes realizados (solo admin) */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('admin.ajustes_historial');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);
  const month = searchParams.get('month'); // formato esperado: YYYY-MM
  const sucursalId = searchParams.get('sucursal_id');

  const admin = await createAdminClient();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = admin
    .from('ajustes')
    .select('id, sucursal_id, usuario_id, fecha_creado, fecha_desde, fecha_hasta, archivo_nombre', {
      count: 'exact',
    });

  if (sucursalId) {
    query = query.eq('sucursal_id', Number(sucursalId));
  }

  if (month) {
    // Filtrar por mes de fecha_creado usando un rango [primer día, primer día del mes siguiente)
    const [yearStr, monthStr] = month.split('-');
    const year = parseInt(yearStr, 10);
    const monthNum = parseInt(monthStr, 10);
    if (!Number.isNaN(year) && !Number.isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
      const start = new Date(Date.UTC(year, monthNum - 1, 1));
      const end = new Date(Date.UTC(year, monthNum, 1));
      const toIsoDate = (d: Date) => d.toISOString().slice(0, 10);
      const startStr = toIsoDate(start);
      const endStr = toIsoDate(end);
      query = query.gte('fecha_creado', startStr).lt('fecha_creado', endStr);
    }
  }

  const { data, error, count } = await query
    .order('fecha_creado', { ascending: false })
    .range(from, to);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const lista = data ?? [];

  // Para cada ajuste, inferir el origen (Sucursal / Auditoría / Ambos) a partir del estado de los detalles
  const conOrigen = await Promise.all(
    lista.map(async (a) => {
      const { data: detalles, error: detError } = await admin
        .from('ajustes_detalle')
        .select('detalle_id, controles_inventario_detalle!inner(estado)')
        .eq('ajuste_id', a.id);

      if (detError || !detalles || detalles.length === 0) {
        return { ...a, origen: null as string | null };
      }

      const estados = new Set<string>();
      for (const d of detalles as any[]) {
        const estado = d.controles_inventario_detalle?.estado as string | undefined;
        if (estado) estados.add(estado);
      }

      let origen: string | null = null;
      const tieneAuditoria = Array.from(estados).some((e) => e === 'ajustado_auditoria');
      const tieneSucursal = Array.from(estados).some((e) => e === 'ajustado_sucursal');

      if (tieneAuditoria && tieneSucursal) origen = 'Ambos';
      else if (tieneAuditoria) origen = 'Auditoria';
      else if (tieneSucursal) origen = 'Sucursal';

      return { ...a, origen };
    })
  );

  return NextResponse.json({
    data: conOrigen,
    total: count ?? lista.length,
    page,
    pageSize,
  });
}

