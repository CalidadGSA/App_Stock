import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

/** GET /api/inventario - listar controles de inventario de la sucursal (con paginación y filtros) */
export async function GET(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');

  let query = admin
    .from('controles_inventario')
    .select('*, sucursales(nombrefantasia), operadores(nombrecompleto)', { count: 'exact' })
    .eq('sucursal_id', sucursalId);

  if (desde) {
    query = query.gte('fecha_inicio', desde);
  }
  if (hasta) {
    // sumar un día para incluir todo el día hasta
    query = query.lte('fecha_inicio', `${hasta}T23:59:59.999Z`);
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    data: data ?? [],
    total: count ?? data?.length ?? 0,
    page,
    pageSize,
  });
}

/** POST /api/inventario - crear nuevo control de inventario */
export async function POST(request: NextRequest) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const body = await request.json() as { descripcion?: string; categoria_macro?: 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | null };

  const admin = await createAdminClient();

  // 1) Crear el control de inventario
  const { data: control, error: createError } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      origen: 'Sucursal',
      categoria_macro: body.categoria_macro ?? null,
      descripcion: body.descripcion ?? null,
    })
    .select()
    .single();

  if (createError || !control) {
    return NextResponse.json({ error: createError?.message ?? 'Error al crear control' }, { status: 500 });
  }

  const controlId = control.id as string;

  // 2) Si no se eligió categoría macro, devolvemos solo el control (inventario libre)
  const categoriaMacro = body.categoria_macro;
  if (!categoriaMacro || (categoriaMacro !== 'FARMA' && categoriaMacro !== 'BIENESTAR' && categoriaMacro !== 'PSICOTROPICOS')) {
    return NextResponse.json({ data: control }, { status: 201 });
  }

  // 3) Determinar trimestre actual para la sucursal según base_productos (fecha hoy dentro de [fechainicio, fechafin])
  const hoy = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'
  const sucursalNum = parseInt(sucursalId, 10);

  const { data: trRows, error: trError } = await admin
    .from('base_productos')
    .select('trimestre, fechainicio, fechafin')
    .eq('idsucursal', sucursalNum)
    .eq('categoriamacro', categoriaMacro)
    .lte('fechainicio', hoy)
    .gte('fechafin', hoy)
    .limit(1);

  if (trError) {
    console.error('Error obteniendo trimestre base_productos:', trError);
    return NextResponse.json({ data: control }, { status: 201 });
  }

  const trimestreActual = trRows && trRows.length > 0 ? (trRows[0] as { trimestre: string }).trimestre : null;
  if (!trimestreActual) {
    return NextResponse.json({ data: control }, { status: 201 });
  }

  // 4) Seleccionar productos según categoría macro
  let idsProductos: number[] = [];

  if (categoriaMacro === 'FARMA' || categoriaMacro === 'BIENESTAR') {
    const { data: baseRows, error: baseError } = await admin
      .from('base_productos')
      .select('idproducto')
      .eq('idsucursal', sucursalNum)
      .eq('categoriamacro', categoriaMacro)
      .eq('trimestre', trimestreActual)
      .eq('vecesinventariado', 0)
      .order('orden', { ascending: true })
      .limit(50);

    if (!baseError && baseRows) {
      idsProductos = baseRows.map((r: { idproducto: number }) => Number(r.idproducto)).filter((n) => !Number.isNaN(n));
    }
  } else if (categoriaMacro === 'PSICOTROPICOS') {
    const { data: minRows, error: minError } = await admin
      .from('base_productos')
      .select('vecesinventariado')
      .eq('idsucursal', sucursalNum)
      .eq('categoriamacro', categoriaMacro)
      .eq('trimestre', trimestreActual)
      .order('vecesinventariado', { ascending: true })
      .limit(1);

    if (!minError && minRows && minRows.length > 0) {
      const minV = (minRows[0] as { vecesinventariado: number }).vecesinventariado;

      const { data: baseRows, error: baseError } = await admin
        .from('base_productos')
        .select('idproducto')
        .eq('idsucursal', sucursalNum)
        .eq('categoriamacro', categoriaMacro)
        .eq('trimestre', trimestreActual)
        .eq('vecesinventariado', minV)
        .order('orden', { ascending: true })
        .limit(15);

      if (!baseError && baseRows) {
        idsProductos = baseRows.map((r: { idproducto: number }) => Number(r.idproducto)).filter((n) => !Number.isNaN(n));
      }
    }
  }

  // 5) Precrear líneas de detalle para esos productos desde medicamentos + nombre de laboratorio
  if (idsProductos.length > 0) {
    const { data: meds, error: medsError } = await admin
      .from('medicamentos')
      .select('codplex, codebar, producto, presentaci, codlab')
      .in('codplex', idsProductos);

    if (!medsError && meds && meds.length > 0) {
      // Resolver nombre de laboratorio para cada CodLab
      const codlabs = Array.from(
        new Set(
          meds
            .map((m: { codlab: number | null }) => m.codlab)
            .filter((v): v is number => v != null)
        )
      );

      const labMap = new Map<number, string>();
      if (codlabs.length > 0) {
        const { data: labs } = await admin
          .from('laboratorios')
          .select('codlab, laborato')
          .in('codlab', codlabs);

        (labs ?? []).forEach((l: { codlab: number; laborato: string | null }) => {
          labMap.set(l.codlab, l.laborato ?? String(l.codlab));
        });
      }

      const filas = meds.map(
        (m: {
          codplex: number;
          codebar: string | null;
          producto: string | null;
          presentaci: string | null;
          codlab: number | null;
        }) => ({
          control_id: controlId,
          producto_id_sistema: String(m.codplex),
          codigo_barras: m.codebar ?? '',
          descripcion: m.producto ?? '',
          presentacion: m.presentaci ?? null,
          laboratorio:
            m.codlab != null
              ? labMap.get(m.codlab) ?? String(m.codlab)
              : null,
          stock_sistema: 0,
          stock_sist_cajas: null,
          stock_sist_unidades: null,
          stock_real_cajas: null,
          stock_real_unidades: null,
          stock_real: 0,
        })
      );

      await admin.from('controles_inventario_detalle').insert(filas);
    }
  }

  return NextResponse.json({ data: control }, { status: 201 });
}
