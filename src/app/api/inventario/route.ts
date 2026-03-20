import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { nombreTipoControlInventario } from '@/lib/inventario/tipo-control';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

type CategoriaMacro = 'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS';

async function obtenerIdsMedicamentosExistentes(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  idsProductos: number[]
) {
  if (idsProductos.length === 0) return new Set<number>();

  const { data, error } = await admin
    .from('medicamentos')
    .select('codplex')
    .in('codplex', idsProductos);

  if (error) {
    throw error;
  }

  return new Set(
    (data ?? [])
      .map((row: { codplex: number }) => Number(row.codplex))
      .filter((n) => !Number.isNaN(n))
  );
}

async function seleccionarIdsInventarioDiario(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  sucursalNum: number,
  categoriaMacro: CategoriaMacro,
  trimestreActual: string,
  idsExcluidos: Set<number>
) {
  const objetivo = categoriaMacro === 'PSICOTROPICOS' ? 15 : 50;
  const seleccionados: number[] = [];
  const vistos = new Set<number>();

  if (categoriaMacro === 'FARMA' || categoriaMacro === 'BIENESTAR') {
    let offset = 0;
    const fetchSize = 200;

    while (seleccionados.length < objetivo) {
      const { data: baseRows, error: baseError } = await admin
        .from('base_productos')
        .select('idproducto')
        .eq('idsucursal', sucursalNum)
        .eq('categoriamacro', categoriaMacro)
        .eq('trimestre', trimestreActual)
        .eq('vecesinventariado', 0)
        .order('orden', { ascending: true })
        .range(offset, offset + fetchSize - 1);

      if (baseError) {
        throw baseError;
      }

      if (!baseRows || baseRows.length === 0) {
        break;
      }

      const candidatos = baseRows
        .map((r: { idproducto: number }) => Number(r.idproducto))
        .filter((n) => !Number.isNaN(n) && !vistos.has(n) && !idsExcluidos.has(n));

      const existentes = await obtenerIdsMedicamentosExistentes(admin, candidatos);

      for (const id of candidatos) {
        vistos.add(id);
        if (!existentes.has(id)) continue;
        seleccionados.push(id);
        if (seleccionados.length === objetivo) break;
      }

      offset += baseRows.length;
    }

    return seleccionados;
  }

  const { data: baseRows, error: baseError } = await admin
    .from('base_productos')
    .select('idproducto, vecesinventariado')
    .eq('idsucursal', sucursalNum)
    .eq('categoriamacro', categoriaMacro)
    .eq('trimestre', trimestreActual)
    .order('vecesinventariado', { ascending: true })
    .order('orden', { ascending: true });

  if (baseError) {
    throw baseError;
  }

  const rows = (baseRows ?? []) as Array<{ idproducto: number; vecesinventariado: number }>;
  const niveles = Array.from(new Set(rows.map((row) => row.vecesinventariado)));

  for (const nivel of niveles) {
    const candidatos = rows
      .filter((row) => row.vecesinventariado === nivel)
      .map((row) => Number(row.idproducto))
      .filter((n) => !Number.isNaN(n) && !vistos.has(n) && !idsExcluidos.has(n));

    const existentes = await obtenerIdsMedicamentosExistentes(admin, candidatos);

    for (const id of candidatos) {
      vistos.add(id);
      if (!existentes.has(id)) continue;
      seleccionados.push(id);
      if (seleccionados.length === objetivo) break;
    }

    if (seleccionados.length === objetivo) {
      break;
    }
  }

  return seleccionados;
}

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
  const esAdmin = operador.rol === 'admin';

  let query = admin
    .from('controles_inventario')
    .select('*, sucursales(nombrefantasia), operadores(nombrecompleto)', { count: 'exact' })
    .eq('sucursal_id', sucursalId);

  if (!esAdmin) {
    query = query.in('tipo', ['diario', 'ocasional_sucursal']);
  }

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

  const body = await request.json() as {
    descripcion?: string;
    categoria_macro?: CategoriaMacro | null;
    confirm_override?: boolean;
  };

  const admin = await createAdminClient();
  const tipoObjetivo = 'diario';
  const categoriaMacro = body.categoria_macro;

  const { data: controlesAbiertosMismaCategoria, error: abiertosError } = await admin
    .from('controles_inventario')
    .select('id')
    .eq('sucursal_id', parseInt(sucursalId, 10))
    .eq('estado', 'en_progreso')
    .eq('tipo', 'diario')
    .eq('categoria_macro', categoriaMacro ?? null);

  if (abiertosError) {
    return NextResponse.json({ error: abiertosError.message }, { status: 500 });
  }

  const warning =
    categoriaMacro && (controlesAbiertosMismaCategoria?.length ?? 0) > 0
      ? `Ya hay un ${nombreTipoControlInventario(tipoObjetivo)} abierto para la categoría ${categoriaMacro}. Se abrirá uno nuevo y se omitirán los productos ya asignados en los diarios abiertos de esa categoría.`
      : null;

  if (warning && body.confirm_override !== true) {
    return NextResponse.json(
      {
        error: warning,
        warning,
        requires_confirmation: true,
      },
      { status: 409 }
    );
  }

  // 1) Crear el control de inventario
  const { data: control, error: createError } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      origen: 'Sucursal',
      tipo: 'diario',
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
  if (!categoriaMacro || (categoriaMacro !== 'FARMA' && categoriaMacro !== 'BIENESTAR' && categoriaMacro !== 'PSICOTROPICOS')) {
    return NextResponse.json({ data: control, warning }, { status: 201 });
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
    return NextResponse.json({ data: control, warning }, { status: 201 });
  }

  // 4) Seleccionar productos según categoría macro
  let idsProductos: number[] = [];
  let idsExcluidos = new Set<number>();

  if ((controlesAbiertosMismaCategoria?.length ?? 0) > 0) {
    const idsControlesAbiertos = controlesAbiertosMismaCategoria!.map(
      (row: { id: string }) => row.id
    );

    const { data: detallesAbiertos, error: detallesAbiertosError } = await admin
      .from('controles_inventario_detalle')
      .select('producto_id_sistema')
      .in('control_id', idsControlesAbiertos);

    if (detallesAbiertosError) {
      console.error(
        'Error obteniendo productos ya asignados en inventarios diarios abiertos:',
        detallesAbiertosError
      );
    } else {
      idsExcluidos = new Set(
        (detallesAbiertos ?? [])
          .map((row: { producto_id_sistema: string }) =>
            Number(row.producto_id_sistema)
          )
          .filter((n) => !Number.isNaN(n))
      );
    }
  }

  try {
    idsProductos = await seleccionarIdsInventarioDiario(
      admin,
      sucursalNum,
      categoriaMacro,
      trimestreActual,
      idsExcluidos
    );
  } catch (selectionError) {
    console.error('Error seleccionando productos para inventario diario:', selectionError);
  }

  // 5) Precrear líneas de detalle para esos productos desde medicamentos + nombre de laboratorio
  if (idsProductos.length > 0) {
    const { data: meds, error: medsError } = await admin
      .from('medicamentos')
      .select('codplex, codebar, producto, presentaci, codlab')
      .in('codplex', idsProductos);

    if (!medsError && meds && meds.length > 0) {
      const medsOrdenados = idsProductos
        .map((idProducto) =>
          meds.find((m: { codplex: number }) => Number(m.codplex) === idProducto) ?? null
        )
        .filter(Boolean) as Array<{
          codplex: number;
          codebar: string | null;
          producto: string | null;
          presentaci: string | null;
          codlab: number | null;
        }>;

      // Resolver nombre de laboratorio para cada CodLab
      const codlabs = Array.from(
        new Set(
          medsOrdenados
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

      const filas = medsOrdenados.map((m) => ({
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

  return NextResponse.json({ data: control, warning }, { status: 201 });
}
