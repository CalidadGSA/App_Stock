import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';

/** GET /api/ajustes - lista de ajustes realizados (solo admin) */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);

  const admin = await createAdminClient();

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await admin
    .from('ajustes')
    .select('id, sucursal_id, usuario_id, fecha_creado, fecha_desde, fecha_hasta, archivo_nombre', {
      count: 'exact',
    })
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

