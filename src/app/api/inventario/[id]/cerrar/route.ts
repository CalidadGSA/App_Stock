import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
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
  const esAdmin = operador.rol === 'admin';

  const admin = await createAdminClient();
  const { data: control } = await admin
    .from('controles_inventario')
    .select('estado, sucursal_id, categoria_macro, fecha_inicio, origen, tipo, descripcion')
    .eq('id', controlId)
    .single();

  if (!control) return NextResponse.json({ error: 'Control no encontrado' }, { status: 404 });
  if (String(control.sucursal_id) !== sucursalId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  const tipoControl = inferirTipoControlInventario(control);
  if (!esAdmin && !esTipoControlVisibleParaOperadorSucursal(tipoControl)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 });
  if (control.estado !== 'en_progreso') return NextResponse.json({ error: 'Ya está cerrado' }, { status: 400 });

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from('controles_inventario')
    .update({ estado: 'cerrado', fecha_fin: now, updated_at: now })
    .eq('id', controlId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Si el control tiene categoria_macro, incrementar vecesInventariado en base_productos
  const categoriaMacro = control.categoria_macro as 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null;
  if (categoriaMacro && sucursalId) {
    const fechaControl = (control.fecha_inicio as string).slice(0, 10);
    const sucursalNum = parseInt(sucursalId, 10);

    const { data: trRows, error: trError } = await admin
      .from('base_productos')
      .select('trimestre')
      .eq('idsucursal', sucursalNum)
      .eq('categoriamacro', categoriaMacro)
      .lte('fechainicio', fechaControl)
      .gte('fechafin', fechaControl)
      .limit(1);

    if (!trError && trRows && trRows.length > 0) {
      const trimestre = (trRows[0] as { trimestre: string }).trimestre;

      const { data: detRows, error: detError } = await admin
        .from('controles_inventario_detalle')
        .select('producto_id_sistema, stock_real_cajas, stock_real_unidades')
        .eq('control_id', controlId);

      if (!detError && detRows && detRows.length > 0) {
        const idProductos = Array.from(
          new Set(
            detRows
              // Solo contamos productos que fueron efectivamente recontados (tienen algún stock_real)
              .filter(
                (d: { stock_real_cajas: number | null; stock_real_unidades: number | null }) =>
                  d.stock_real_cajas != null || d.stock_real_unidades != null
              )
              .map((d: { producto_id_sistema: string }) => Number(d.producto_id_sistema))
              .filter((n: number) => !Number.isNaN(n))
          )
        ) as number[];

        if (idProductos.length > 0) {
          const { error: rpcError } = await admin.rpc('incrementar_veces_inventariado', {
            p_sucursal_id: sucursalNum,
            p_categoria_macro: categoriaMacro,
            p_trimestre: trimestre,
            p_id_productos: idProductos,
          });

          if (rpcError) {
            console.error('Error al incrementar vecesInventariado en base_productos:', rpcError);
          }
        }
      }
    }
  }

  return NextResponse.json({ data });
}
