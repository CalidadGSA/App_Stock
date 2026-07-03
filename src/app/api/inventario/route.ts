import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { canSeeAllInventarioTipos, getOperadorRbacContext } from '@/lib/auth/rbac';
import { nombreTipoControlInventario } from '@/lib/inventario/tipo-control';
import {
  CATEGORIA_MACRO_SIN_PADRON,
  esCategoriaMacro,
  esCategoriaMacroInventarioDiario,
  esCategoriaMacroSinPadron,
  filtrarQueryBaseProductosPorMacro,
  type CategoriaMacroInventarioDiario,
} from '@/lib/inventario/categoria-macro';
import { obtenerProgresoTrimestreSucursal, trimestrePadronCompleto } from '@/lib/inventario/trimestre-base';
import {
  filtrarIdsPorCategoriaMacroPadron,
  getFichasInventarioDiario,
  idsExistenEnPadron,
  padronProductosDisponible,
} from '@/lib/padron-productos-lookup';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { fechaHoyArgentinaYmd } from '@/lib/utils';

async function filtrarCandidatosInventarioDiario(
  candidatos: number[],
  categoriaMacro: CategoriaMacroInventarioDiario
): Promise<number[]> {
  if (candidatos.length === 0) return [];
  if (esCategoriaMacroSinPadron(categoriaMacro)) {
    return candidatos.filter((id) => !Number.isNaN(id));
  }

  const existentes = await idsExistenEnPadron(candidatos);
  const enPadron = candidatos.filter((id) => existentes.has(id));

  // Los candidatos ya vienen de base_productos con la misma categoriamacro.
  // En PSICO/BIENESTAR no re-filtramos por cat_macro del padrón (suele desincronizarse).
  if (categoriaMacro === 'PSICOTROPICOS' || categoriaMacro === 'BIENESTAR') {
    return enPadron;
  }

  if (esCategoriaMacro(categoriaMacro)) {
    return filtrarIdsPorCategoriaMacroPadron(enPadron, categoriaMacro);
  }

  return [];
}

async function seleccionarIdsInventarioDiario(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  sucursalNum: number,
  categoriaMacro: CategoriaMacroInventarioDiario,
  trimestreActual: string,
  idsExcluidos: Set<number>
) {
  // Límite dinámico desde cantidad_inventario (cantidadDiaria).
  // Fallback a 50/15 si por algún motivo no hay fila o hay error de esquema.
  async function obtenerObjetivoDesdeCantidadInventario(): Promise<number> {
    const fallback = categoriaMacro === 'PSICOTROPICOS' ? 15 : 50;

    const attempts: Array<{
      idField: string;
      categoriaField: string;
      cantidadDiariaField: string;
      cantidadTotalField: string;
    }> = [
      {
        idField: 'idSucursal',
        categoriaField: 'categoriaMacro',
        cantidadDiariaField: 'cantidadDiaria',
        cantidadTotalField: 'cantidadTotal',
      },
      {
        idField: 'idsucursal',
        categoriaField: 'categoriamacro',
        cantidadDiariaField: 'cantidaddiaria',
        cantidadTotalField: 'cantidadtotal',
      },
      {
        idField: 'id_sucursal',
        categoriaField: 'categoria_macro',
        cantidadDiariaField: 'cantidad_diaria',
        cantidadTotalField: 'cantidad_total',
      },
      {
        idField: 'idsucursal',
        categoriaField: 'categoriamacro',
        cantidadDiariaField: 'cantidad',
        cantidadTotalField: 'cantidadtotal',
      },
      {
        idField: 'idSucursal',
        categoriaField: 'categoriaMacro',
        cantidadDiariaField: 'cantidad',
        cantidadTotalField: 'cantidadTotal',
      },
    ];

    let lastError: unknown = null;
    for (const a of attempts) {
      const { data, error } = await admin
        .from('cantidad_inventario')
        .select(`${a.cantidadDiariaField}, ${a.cantidadTotalField}`)
        .eq(a.idField, sucursalNum)
        .ilike(a.categoriaField, categoriaMacro)
        .eq('trimestre', trimestreActual)
        .maybeSingle();

      if (error) {
        lastError = error;
        continue;
      }
      const row = (data ?? {}) as Record<string, unknown>;
      const cantidadDiariaValor =
        row[a.cantidadDiariaField] == null ? NaN : Number(row[a.cantidadDiariaField]);
      const cantidadTotalValor =
        row[a.cantidadTotalField] == null ? NaN : Number(row[a.cantidadTotalField]);

      if (Number.isFinite(cantidadDiariaValor)) return cantidadDiariaValor;
      if (Number.isFinite(cantidadTotalValor)) return cantidadTotalValor;
    }

    // Si no pudimos obtener el objetivo, usamos el comportamiento anterior.
    console.warn('No se pudo obtener cantidad_inventario; usando fallback 50/15', {
      sucursalNum,
      categoriaMacro,
      trimestreActual,
      lastError: (lastError as { message?: string } | null)?.message ?? lastError,
    });
    return fallback;
  }

  const objetivo = await obtenerObjetivoDesdeCantidadInventario();
  if (objetivo <= 0) return [];
  const seleccionados: number[] = [];
  const vistos = new Set<number>();

  if (
    categoriaMacro === 'FARMA' ||
    categoriaMacro === 'BIENESTAR' ||
    esCategoriaMacroSinPadron(categoriaMacro)
  ) {
    let offset = 0;
    const fetchSize = 200;

    while (seleccionados.length < objetivo) {
      const { data: baseRows, error: baseError } = await filtrarQueryBaseProductosPorMacro(
        admin
          .from('base_productos')
          .select('idproducto')
          .eq('idsucursal', sucursalNum)
          .eq('trimestre', trimestreActual)
          .eq('vecesinventariado', 0)
          .order('orden', { ascending: true })
          .range(offset, offset + fetchSize - 1),
        categoriaMacro
      );

      if (baseError) {
        throw baseError;
      }

      if (!baseRows || baseRows.length === 0) {
        break;
      }

      const candidatos = baseRows
        .map((r: { idproducto: number }) => Number(r.idproducto))
        .filter((n) => !Number.isNaN(n) && !vistos.has(n) && !idsExcluidos.has(n));

      const validos = new Set(
        await filtrarCandidatosInventarioDiario(candidatos, categoriaMacro)
      );

      for (const id of candidatos) {
        vistos.add(id);
        if (!validos.has(id)) continue;
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
    .ilike('categoriamacro', categoriaMacro)
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

    const validos = new Set(
      await filtrarCandidatosInventarioDiario(candidatos, categoriaMacro)
    );

    for (const id of candidatos) {
      vistos.add(id);
      if (!validos.has(id)) continue;
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
  const rbac = await getOperadorRbacContext();
  if (!rbac) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const pageSize = parseInt(searchParams.get('pageSize') ?? '20', 10);
  const desde = searchParams.get('desde');
  const hasta = searchParams.get('hasta');
  const estado = searchParams.get('estado');
  const esAdmin = canSeeAllInventarioTipos(rbac);

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
  if (estado === 'en_progreso' || estado === 'cerrado') {
    query = query.eq('estado', estado);
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
    categoria_macro?: CategoriaMacroInventarioDiario | null;
    confirm_override?: boolean;
  };

  const admin = await createAdminClient();
  const tipoObjetivo = 'diario';
  const categoriaMacroRaw = body.categoria_macro;
  if (categoriaMacroRaw && !esCategoriaMacroInventarioDiario(categoriaMacroRaw)) {
    return NextResponse.json({ error: 'Categoría macro no válida' }, { status: 400 });
  }
  const categoriaMacro = categoriaMacroRaw ?? null;

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

  const sinProductosMsg = 'No hay productos para inventariar';
  const sucursalNum = parseInt(sucursalId, 10);

  const esDiarioGuiado = !!categoriaMacro && esCategoriaMacroInventarioDiario(categoriaMacro);

  let idsProductosPrecargados: number[] = [];

  // Inventario diario guiado: validar trimestre y que haya productos antes de crear el control
  if (esDiarioGuiado) {
    const hoy = fechaHoyArgentinaYmd();

    if (esCategoriaMacroSinPadron(categoriaMacro)) {
      const progreso = await obtenerProgresoTrimestreSucursal(admin, sucursalNum, hoy);
      if (!trimestrePadronCompleto(progreso)) {
        return NextResponse.json(
          {
            error:
              'Completá el progreso trimestral (FARMA, BIENESTAR y PSICOTROPICOS) antes de inventariar productos Sin padrón.',
          },
          { status: 400 }
        );
      }
    } else if (!padronProductosDisponible()) {
      return NextResponse.json(
        { error: 'Base padrón (abastecimiento) no configurada' },
        { status: 503 }
      );
    }

    const macroConsulta = esCategoriaMacroSinPadron(categoriaMacro)
      ? CATEGORIA_MACRO_SIN_PADRON
      : categoriaMacro;

    const { data: trRows, error: trError } = await filtrarQueryBaseProductosPorMacro(
      admin
        .from('base_productos')
        .select('trimestre, fechainicio, fechafin')
        .eq('idsucursal', sucursalNum)
        .lte('fechainicio', hoy)
        .gte('fechafin', hoy)
        .limit(1),
      macroConsulta
    );

    if (trError) {
      console.error('Error obteniendo trimestre base_productos:', trError);
      return NextResponse.json({ error: sinProductosMsg }, { status: 400 });
    }

    const trimestreActual =
      trRows && trRows.length > 0 ? (trRows[0] as { trimestre: string }).trimestre : null;
    if (!trimestreActual) {
      return NextResponse.json({ error: sinProductosMsg }, { status: 400 });
    }

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
      idsProductosPrecargados = await seleccionarIdsInventarioDiario(
        admin,
        sucursalNum,
        categoriaMacro!,
        trimestreActual,
        idsExcluidos
      );
    } catch (selectionError) {
      console.error('Error seleccionando productos para inventario diario:', selectionError);
      return NextResponse.json({ error: sinProductosMsg }, { status: 400 });
    }

    if (idsProductosPrecargados.length === 0) {
      return NextResponse.json({ error: sinProductosMsg }, { status: 400 });
    }
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

  // 2) Si no se eligió categoría macro guiada, devolvemos solo el control (inventario libre)
  if (!esDiarioGuiado) {
    return NextResponse.json({ data: control, warning }, { status: 201 });
  }

  const idsProductos = idsProductosPrecargados;

  // 3) Precrear líneas de detalle desde padron_final (abastecimiento) o medicamentos (sin padrón)
  if (idsProductos.length > 0) {
    const fichasOrdenadas = await getFichasInventarioDiario(admin, idsProductos, {
      sinPadron: esCategoriaMacroSinPadron(categoriaMacro),
    });

    if (fichasOrdenadas.length === 0) {
      await admin.from('controles_inventario').delete().eq('id', controlId);
      return NextResponse.json({ error: sinProductosMsg }, { status: 400 });
    }

    const filas = fichasOrdenadas.map((f) => ({
      control_id: controlId,
      producto_id_sistema: f.producto_id_sistema,
      codigo_barras: f.codigo_barras,
      descripcion: f.descripcion,
      presentacion: f.presentacion,
      laboratorio: f.laboratorio,
      stock_sistema: 0,
      stock_sist_cajas: null,
      stock_sist_unidades: null,
      stock_real_cajas: null,
      stock_real_unidades: null,
      stock_real: 0,
    }));

    await admin.from('controles_inventario_detalle').insert(filas);
  }

  return NextResponse.json({ data: control, warning }, { status: 201 });
}
