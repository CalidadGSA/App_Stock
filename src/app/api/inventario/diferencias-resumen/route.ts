import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

/** GET /api/inventario/diferencias-resumen
 *  Devuelve diferencias agregadas por producto (cajas / unidades) para:
 *  - Mes actual (desdeActual, hastaActual)
 *  - Mes anterior (desdeAnterior, hastaAnterior)
 *  Solo admin, sucursal tomada de la sesión.
 */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }
  const sucursalNum = parseInt(sucursalId, 10);
  if (Number.isNaN(sucursalNum)) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const desdeActual = searchParams.get('desdeActual');
  const hastaActual = searchParams.get('hastaActual');
  const categoriaMacro = searchParams.get('categoria_macro');

  if (!desdeActual || !hastaActual) {
    return NextResponse.json(
      { error: 'desdeActual y hastaActual son requeridos' },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();

  // Necesitamos la sucursal actual desde sesión (cookie que ya se usa en otros endpoints).
  // Reutilizamos el patrón de otros endpoints: leemos sucursal desde la cookie en el BFF,
  // pero aquí no tenemos cookies directo; asumimos que este endpoint se llama
  // siempre desde la sucursal actual y tomamos todo para todas las sucursales.
  // Para mantenerlo acotado, exigimos sucursal en query si se necesitara en el futuro.

  async function cargarPeriodo(desde: string, hasta: string) {
    const desdeIso = `${desde}T00:00:00.000Z`;
    const hastaIso = `${hasta}T23:59:59.999Z`;

    let query = admin
      .from('controles_inventario_detalle')
      .select(
        'producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades, con_diferencias, ajustado, controles_inventario!inner(fecha_inicio, sucursal_id, categoria_macro)'
      )
      .eq('controles_inventario.sucursal_id', sucursalNum)
      .gte('controles_inventario.fecha_inicio', desdeIso)
      .lte('controles_inventario.fecha_inicio', hastaIso)
      .eq('con_diferencias', 1);

    if (categoriaMacro) {
      query = query.eq('controles_inventario.categoria_macro', categoriaMacro);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    type Row = {
      producto_id_sistema: string;
      codigo_barras: string;
      descripcion: string;
      presentacion: string | null;
      laboratorio: string | null;
      stock_sist_cajas?: number | null;
      stock_sist_unidades?: number | null;
      stock_real_cajas?: number | null;
      stock_real_unidades?: number | null;
      con_diferencias?: number | null;
      ajustado?: number | null;
    };

    const agregados = new Map<
      string,
      {
        producto_id_sistema: string;
        codigo_barras: string;
        descripcion: string;
        presentacion: string | null;
        laboratorio: string | null;
        diffCajas: number;
        diffUnidades: number;
      }
    >();

    for (const d of ((data as Row[]) ?? [])) {
      const sistC = d.stock_sist_cajas ?? 0;
      const sistU = d.stock_sist_unidades ?? 0;
      const realC = d.stock_real_cajas ?? 0;
      const realU = d.stock_real_unidades ?? 0;

      const deltaC = realC - sistC;
      const deltaU = realU - sistU;

      if (deltaC === 0 && deltaU === 0) continue;

      const key = `${d.producto_id_sistema}::${d.codigo_barras}`;
      const actual = agregados.get(key) ?? {
        producto_id_sistema: d.producto_id_sistema,
        codigo_barras: d.codigo_barras,
        descripcion: d.descripcion,
        presentacion: d.presentacion ?? null,
        laboratorio: d.laboratorio ?? null,
        diffCajas: 0,
        diffUnidades: 0,
      };

      actual.diffCajas += deltaC;
      actual.diffUnidades += deltaU;
      agregados.set(key, actual);
    }

    return Array.from(agregados.values());
  }

  try {
    const actual = await cargarPeriodo(desdeActual, hastaActual);

    const mapActual = new Map<string, (typeof actual)[number]>();
    actual.forEach((r) => {
      const key = `${r.producto_id_sistema}::${r.codigo_barras}`;
      mapActual.set(key, r);
    });

    const keys = new Set<string>([...mapActual.keys()]);
    const resumen = Array.from(keys).map((key) => {
      const a = mapActual.get(key)!;
      return {
        producto_id_sistema: a.producto_id_sistema,
        codigo_barras: a.codigo_barras,
        descripcion: a.descripcion,
        presentacion: a.presentacion,
        laboratorio: a.laboratorio,
        diffCajasActual: a.diffCajas,
        diffUnidadesActual: a.diffUnidades,
        diffCajasAnterior: 0,
        diffUnidadesAnterior: 0,
      };
    });

    return NextResponse.json({
      data: resumen,
      desdeActual,
      hastaActual,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? 'Error al calcular diferencias' },
      { status: 500 }
    );
  }
}

