import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { canSeeAllInventarioTipos, getOperadorRbacContext } from '@/lib/auth/rbac';
import { nombreTipoControlInventario } from '@/lib/inventario/tipo-control';
import {
  CATEGORIA_MACRO_SIN_PADRON,
  esCategoriaMacroInventarioDiario,
  esCategoriaMacroSinPadron,
  filtrarQueryBaseProductosPorMacro,
  type CategoriaMacroInventarioDiario,
} from '@/lib/inventario/categoria-macro';
import { obtenerProgresoTrimestreSucursal, trimestrePadronCompleto } from '@/lib/inventario/trimestre-base';
import { leerVueltasPsicosSucursal } from '@/lib/inventario/vueltas-psicos-sucursal';
import {
  getFichasInventarioDiario,
  padronProductosDisponible,
} from '@/lib/padron-productos-lookup';
import { quantioProductosDisponible } from '@/lib/quantio-productos-lookup';
import { esSucursalDrogueria } from '@/lib/sucursales/drogueria';
import {
  obtenerTrimestreVigenteDrogueria,
  seleccionarIdsInventarioDiarioDrogueria,
} from '@/lib/inventario/base-productos-drogueria';
import {
  debeOcultarInventariosDeAdmin,
  filtroUsuarioIds,
  idsOperadoresAdminLike,
} from '@/lib/auth/operadores-admin-like';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { fechaHoyArgentinaYmd } from '@/lib/utils';

async function seleccionarIdsInventarioDiario(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  sucursalNum: number,
  categoriaMacro: CategoriaMacroInventarioDiario,
  trimestreActual: string,
  idsExcluidos: Set<number>,
  opts?: { drogueria?: boolean }
): Promise<{ ids: number[]; objetivo: number; motivoVacio: string | null }> {
  /** Cupo por defecto si no hay fila en cantidad_inventario. */
  function cupoFallbackSinCantidadInventario(): number {
    if (categoriaMacro === 'PSICOTROPICOS') return 20;
    // FARMA, BIENESTAR y Sin padrón
    return 50;
  }

  /**
   * Cupo del día desde cantidad_inventario.cantidadDiaria
   * (una fila por sucursal + categoriaMacro + trimestre).
   */
  async function obtenerObjetivoDiario(): Promise<{
    objetivo: number;
    foundRow: boolean;
    usedFallback: boolean;
    lastError: string | null;
  }> {
    const attempts: Array<{
      idField: string;
      categoriaField: string;
      cantidadDiariaField: string;
    }> = [
      {
        idField: 'idSucursal',
        categoriaField: 'categoriaMacro',
        cantidadDiariaField: 'cantidadDiaria',
      },
      {
        idField: 'idsucursal',
        categoriaField: 'categoriamacro',
        cantidadDiariaField: 'cantidaddiaria',
      },
      {
        idField: 'id_sucursal',
        categoriaField: 'categoria_macro',
        cantidadDiariaField: 'cantidad_diaria',
      },
    ];

    let lastError: string | null = null;
    let foundRow = false;
    for (const a of attempts) {
      const { data, error } = await admin
        .from('cantidad_inventario')
        .select(a.cantidadDiariaField)
        .eq(a.idField, sucursalNum)
        .ilike(a.categoriaField, categoriaMacro)
        .eq('trimestre', trimestreActual)
        .limit(1);

      if (error) {
        lastError = error.message;
        continue;
      }

      const row = (Array.isArray(data) && data.length > 0
        ? data[0]
        : null) as Record<string, unknown> | null;
      if (!row) continue;
      foundRow = true;
      const valorRaw =
        row[a.cantidadDiariaField] ??
        row[a.cantidadDiariaField.toLowerCase()] ??
        Object.values(row)[0];
      const valor = Number(valorRaw);
      if (Number.isFinite(valor) && valor > 0) {
        return {
          objetivo: Math.floor(valor),
          foundRow: true,
          usedFallback: false,
          lastError: null,
        };
      }
      return {
        objetivo: 0,
        foundRow: true,
        usedFallback: false,
        lastError: null,
      };
    }

    const fallback = cupoFallbackSinCantidadInventario();
    console.warn('cantidad_inventario ausente: usando cupo fallback', {
      sucursalNum,
      categoriaMacro,
      trimestreActual,
      fallback,
      lastError,
    });
    return {
      objetivo: fallback,
      foundRow: false,
      usedFallback: true,
      lastError,
    };
  }

  const { objetivo, foundRow, usedFallback } = await obtenerObjetivoDiario();
  if (objetivo <= 0) {
    return {
      ids: [],
      objetivo: 0,
      motivoVacio: foundRow
        ? `El cupo diario (cantidad_inventario) para sucursal ${sucursalNum}, ${categoriaMacro}, trimestre «${trimestreActual}» es 0.`
        : `No hay fila en cantidad_inventario para sucursal ${sucursalNum}, categoría ${categoriaMacro} y trimestre «${trimestreActual}». Sin cupo diario no se puede abrir el inventario.`,
    };
  }

  if (usedFallback) {
    console.info(
      `Inventario diario sucursal ${sucursalNum} / ${categoriaMacro}: cupo fallback ${objetivo} (sin cantidad_inventario para «${trimestreActual}»).`
    );
  }

  if (opts?.drogueria) {
    const ids = await seleccionarIdsInventarioDiarioDrogueria(
      admin,
      categoriaMacro,
      trimestreActual,
      objetivo,
      idsExcluidos
    );
    return {
      ids,
      objetivo,
      motivoVacio:
        ids.length === 0
          ? `Hay cupo (${objetivo}) pero no hay productos pendientes en base_productos de droguería para ${categoriaMacro} / «${trimestreActual}».`
          : null,
    };
  }

  const seleccionados: number[] = [];
  const vistos = new Set<number>();

  // Fuente de verdad: base_productos (o base_productos_drogueria arriba). Sin filtro por padrón.
  if (categoriaMacro === 'PSICOTROPICOS') {
    const vueltasMax = await leerVueltasPsicosSucursal(admin, sucursalNum);

    const { data: baseRows, error: baseError } = await admin
      .from('base_productos')
      .select('idproducto, vecesinventariado')
      .eq('idsucursal', sucursalNum)
      .ilike('categoriamacro', categoriaMacro)
      .eq('trimestre', trimestreActual)
      .lt('vecesinventariado', vueltasMax)
      .order('vecesinventariado', { ascending: true })
      .order('orden', { ascending: true })
      .order('idproducto', { ascending: true });

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

      for (const id of candidatos) {
        vistos.add(id);
        seleccionados.push(id);
        if (seleccionados.length === objetivo) break;
      }

      if (seleccionados.length === objetivo) {
        break;
      }
    }

    if (seleccionados.length === 0) {
      return {
        ids: [],
        objetivo,
        motivoVacio: `No hay productos PSICOTROPICOS pendientes en base_productos (sucursal ${sucursalNum}, trimestre «${trimestreActual}», vueltas < ${vueltasMax}).`,
      };
    }

    return { ids: seleccionados, objetivo, motivoVacio: null };
  }

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
          .order('idproducto', { ascending: true })
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

      for (const id of candidatos) {
        vistos.add(id);
        seleccionados.push(id);
        if (seleccionados.length === objetivo) break;
      }

      offset += baseRows.length;
    }

    if (seleccionados.length === 0) {
      return {
        ids: [],
        objetivo,
        motivoVacio: `No hay productos ${categoriaMacro} con vecesinventariado = 0 en base_productos (sucursal ${sucursalNum}, trimestre «${trimestreActual}»).`,
      };
    }

    return { ids: seleccionados, objetivo, motivoVacio: null };
  }

  return {
    ids: [],
    objetivo: 0,
    motivoVacio: `Categoría macro no soportada para inventario diario: ${categoriaMacro}`,
  };
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

  if (debeOcultarInventariosDeAdmin(rbac)) {
    const idsAdminLike = await idsOperadoresAdminLike(admin);
    const excluir = filtroUsuarioIds(idsAdminLike);
    if (excluir) {
      query = query.not('usuario_id', 'in', excluir);
    }
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
  const esDrogueriaSucursal = await esSucursalDrogueria(admin, sucursalNum);

  const esDiarioGuiado = !!categoriaMacro && esCategoriaMacroInventarioDiario(categoriaMacro);

  let idsProductosPrecargados: number[] = [];
  let trimestrePrecarga: string | null = null;
  let cupoObjetivoDiario = 0;
  let idsExcluidosAbiertos = new Set<number>();

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
    } else if (esDrogueriaSucursal) {
      if (!(await quantioProductosDisponible(admin))) {
        return NextResponse.json(
          { error: 'Catálogo Quantio (droguería) no configurado' },
          { status: 503 }
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

    let trimestreActual: string | null = null;

    if (esDrogueriaSucursal) {
      const trDro = await obtenerTrimestreVigenteDrogueria(admin, hoy, macroConsulta);
      trimestreActual = trDro?.trimestre ?? null;
    } else {
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
        return NextResponse.json(
          {
            error: `No se pudo leer el trimestre vigente en base_productos para sucursal ${sucursalNum} / ${macroConsulta}.`,
          },
          { status: 400 }
        );
      }

      const trRow = trRows && trRows.length > 0
        ? (trRows[0] as { trimestre: string | null })
        : null;
      trimestreActual = trRow?.trimestre ? String(trRow.trimestre).trim() : null;
    }

    if (!trimestreActual) {
      return NextResponse.json(
        {
          error: `No hay trimestre vigente en base_productos para sucursal ${sucursalNum} y categoría ${macroConsulta} (fechainicio/fechafin deben cubrir la fecha de hoy). Tener filas sin fechas vigentes no alcanza.`,
        },
        { status: 400 }
      );
    }
    trimestrePrecarga = trimestreActual;

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
    idsExcluidosAbiertos = idsExcluidos;

    try {
      const seleccion = await seleccionarIdsInventarioDiario(
        admin,
        sucursalNum,
        categoriaMacro!,
        trimestreActual,
        idsExcluidos,
        { drogueria: esDrogueriaSucursal }
      );
      idsProductosPrecargados = seleccion.ids;
      cupoObjetivoDiario = seleccion.objetivo;
      if (idsProductosPrecargados.length === 0) {
        return NextResponse.json(
          { error: seleccion.motivoVacio ?? sinProductosMsg },
          { status: 400 }
        );
      }
      if (idsProductosPrecargados.length < cupoObjetivoDiario) {
        console.warn('Inventario diario: selección bajo cupo', {
          sucursalNum,
          categoriaMacro,
          cupo: cupoObjetivoDiario,
          seleccionados: idsProductosPrecargados.length,
        });
      }
    } catch (selectionError) {
      console.error('Error seleccionando productos para inventario diario:', selectionError);
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

  // 3) Precrear líneas de detalle desde padrón / Quantio + ubicación droguería
  if (idsProductos.length > 0) {
    const excluidosParaTopUp = new Set<number>([
      ...idsExcluidosAbiertos,
      ...idsProductos,
    ]);

    let fichasOrdenadas = await getFichasInventarioDiario(admin, idsProductos, {
      sinPadron: esCategoriaMacroSinPadron(categoriaMacro),
      drogueria: esDrogueriaSucursal,
      trimestre: trimestrePrecarga,
    });

    // Si faltan fichas respecto del cupo, reponer con más IDs de la misma macro.
    if (
      cupoObjetivoDiario > 0 &&
      fichasOrdenadas.length < cupoObjetivoDiario &&
      trimestrePrecarga &&
      categoriaMacro
    ) {
      const yaEnFicha = new Set(
        fichasOrdenadas.map((f) => Number(f.producto_id_sistema)).filter((n) => Number.isFinite(n))
      );
      for (const id of idsProductos) excluidosParaTopUp.add(id);

      let guard = 0;
      while (fichasOrdenadas.length < cupoObjetivoDiario && guard < 10) {
        guard += 1;
        const faltan = cupoObjetivoDiario - fichasOrdenadas.length;
        const mas = await seleccionarIdsInventarioDiario(
          admin,
          sucursalNum,
          categoriaMacro,
          trimestrePrecarga,
          excluidosParaTopUp,
          { drogueria: esDrogueriaSucursal }
        );
        if (mas.ids.length === 0) break;

        for (const id of mas.ids) excluidosParaTopUp.add(id);

        const extras = await getFichasInventarioDiario(admin, mas.ids, {
          sinPadron: esCategoriaMacroSinPadron(categoriaMacro),
          drogueria: esDrogueriaSucursal,
          trimestre: trimestrePrecarga,
        });
        if (extras.length === 0) break;

        for (const f of extras) {
          const id = Number(f.producto_id_sistema);
          if (!Number.isFinite(id) || yaEnFicha.has(id)) continue;
          yaEnFicha.add(id);
          fichasOrdenadas.push(f);
          if (fichasOrdenadas.length === cupoObjetivoDiario) break;
        }

        if (extras.length < faltan && mas.ids.length < faltan) {
          break;
        }
      }

      if (fichasOrdenadas.length < cupoObjetivoDiario) {
        console.warn('Inventario diario: fichas bajo cupo tras top-up', {
          sucursalNum,
          categoriaMacro,
          cupo: cupoObjetivoDiario,
          fichas: fichasOrdenadas.length,
        });
      }
    }

    if (fichasOrdenadas.length === 0) {
      await admin.from('controles_inventario').delete().eq('id', controlId);
      return NextResponse.json({ error: sinProductosMsg }, { status: 400 });
    }

    if (cupoObjetivoDiario > 0 && fichasOrdenadas.length > cupoObjetivoDiario) {
      fichasOrdenadas = fichasOrdenadas.slice(0, cupoObjetivoDiario);
    }

    const filas = fichasOrdenadas.map((f) => ({
      control_id: controlId,
      producto_id_sistema: f.producto_id_sistema,
      codigo_barras: f.codigo_barras,
      descripcion: f.descripcion || `Producto ${f.producto_id_sistema}`,
      presentacion: f.presentacion,
      laboratorio: f.laboratorio,
      sector: f.sector ?? null,
      modulo: f.modulo ?? null,
      fila: f.fila ?? null,
      posicion: f.posicion ?? null,
      stock_sistema: 0,
      stock_sist_cajas: null,
      stock_sist_unidades: null,
      stock_real_cajas: null,
      stock_real_unidades: null,
      stock_real: 0,
    }));

    const { error: insertDetallesError } = await admin
      .from('controles_inventario_detalle')
      .insert(filas);

    if (insertDetallesError) {
      console.error('Error insertando detalle inventario diario:', insertDetallesError);
      await admin.from('controles_inventario').delete().eq('id', controlId);
      return NextResponse.json(
        { error: insertDetallesError.message || 'Error al precargar productos del inventario' },
        { status: 500 }
      );
    }

    const warningCupo =
      cupoObjetivoDiario > 0 && fichasOrdenadas.length < cupoObjetivoDiario
        ? `Se precargaron ${fichasOrdenadas.length} de ${cupoObjetivoDiario} productos del cupo diario. Puede no haber más pendientes en base_productos o haber productos ya asignados en otros diarios abiertos.`
        : null;

    const warningFinal = [warning, warningCupo].filter(Boolean).join(' ') || null;
    return NextResponse.json({ data: control, warning: warningFinal }, { status: 201 });
  }

  return NextResponse.json({ data: control, warning }, { status: 201 });
}
