import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { isAdminLikeRole } from '@/lib/auth/roles';
import { getPadronOpcionesPerfumeria, getPadronPerfumeriaMap } from '@/lib/padron-final-db';
import { cookies } from 'next/headers';

type CategoriaFinalPayload = {
  subrubro?: string;
  categoria: string;
  categoria_final: string;
};

type DescuentoPayload = {
  categoria_final_id: number;
  descuento: number;
  dias_min: number;
  dias_max: number;
};

type ReglaColumnas = {
  diasMinField: string;
  diasMaxField: string;
};

const DIAS_MIN_FIELDS = ['dias_min', 'diasmin', 'diasMin', 'fecha_min'] as const;
const DIAS_MAX_FIELDS = ['dias_max', 'diasmax', 'diasMax', 'fecha_max'] as const;
const SUBRUBRO_TODOS = '-';

function parseFechaISOaUTC(fecha: string): number {
  const [y, m, d] = String(fecha).split('-').map((n) => parseInt(n, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return NaN;
  return Date.UTC(y, m - 1, d);
}

async function resolverColumnasReglas(
  admin: Awaited<ReturnType<typeof createAdminClient>>
): Promise<ReglaColumnas | null> {
  for (const dMin of DIAS_MIN_FIELDS) {
    for (const dMax of DIAS_MAX_FIELDS) {
      const { error } = await admin
        .from('descuentos_vencimientos_reglas')
        .select(`id, id_categoriafinal, descuento, ${dMin}, ${dMax}`)
        .limit(1);
      if (!error) return { diasMinField: dMin, diasMaxField: dMax };
    }
  }
  return null;
}

async function requireAdmin() {
  const operador = await getOperadorSession();
  if (!operador) return { error: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) };
  if (!isAdminLikeRole(operador.rol)) return { error: NextResponse.json({ error: 'Sin permisos' }, { status: 403 }) };
  return { ok: true as const };
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;

  const admin = await createAdminClient();
  const reglaCols = await resolverColumnasReglas(admin);
  if (!reglaCols) {
    return NextResponse.json(
      { error: 'No se pudieron resolver columnas de días en descuentos_vencimientos_reglas' },
      { status: 500 }
    );
  }
  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  const sucursalParam = request.nextUrl.searchParams.get('sucursal');
  const sucursalFromQuery = Number(sucursalParam ?? 0);
  const sucursalFromCookie = Number(sucursalId ?? 0);
  const sucursalNum =
    Number.isFinite(sucursalFromQuery) && sucursalFromQuery > 0 ? sucursalFromQuery : sucursalFromCookie;

  let padron: Array<{ subrubro: string; categoria: string }> = [];
  try {
    padron = await getPadronOpcionesPerfumeria();
  } catch (e) {
    return NextResponse.json(
      { error: `Error consultando base de abastecimiento: ${(e as Error).message}` },
      { status: 500 }
    );
  }

  const { data: categoriasFinales, error: catErr } = await admin
    .from('categorias_finales')
    .select('id, subrubro_nombre, categoria, categoria_final, created_at')
    .order('id', { ascending: false });
  if (catErr) return NextResponse.json({ error: catErr.message }, { status: 500 });

  const { data: descuentos, error: descErr } = await admin
    .from('descuentos_vencimientos_reglas')
    .select(
      `id, id_categoriafinal, descuento, ${reglaCols.diasMinField}, ${reglaCols.diasMaxField}, categorias_finales!inner(id, categoria_final)`
    )
    .order('id', { ascending: false });
  if (descErr) return NextResponse.json({ error: descErr.message }, { status: 500 });
  const descuentosRows = (descuentos ?? []) as unknown as Array<Record<string, unknown>>;

  const modoAplicarReal = request.nextUrl.searchParams.get('modo') === 'aplicar';
  const csvReal = request.nextUrl.searchParams.get('csv') === '1';

  if (modoAplicarReal) {
    if (!Number.isFinite(sucursalNum) || sucursalNum <= 0) {
      return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
    }

    let padronMap;
    try {
      padronMap = await getPadronPerfumeriaMap();
    } catch (e) {
      return NextResponse.json(
        { error: `Error consultando base de abastecimiento: ${(e as Error).message}` },
        { status: 500 }
      );
    }

    const categoriasFinalesRows = (categoriasFinales ?? []) as Array<{
      id: number;
      subrubro_nombre: string;
      categoria: string;
      categoria_final: string;
    }>;
    const catFinalByKey = new Map<string, { id: number; nombre: string }>();
    const catFinalByCategoria = new Map<string, { id: number; nombre: string }>();
    for (const c of categoriasFinalesRows) {
      const subrubroNorm = String(c.subrubro_nombre ?? '').trim();
      const categoriaNorm = String(c.categoria ?? '').trim();
      const key = `${subrubroNorm}|${categoriaNorm}`;
      if (!catFinalByKey.has(key)) {
        catFinalByKey.set(key, { id: Number(c.id), nombre: String(c.categoria_final) });
      }
      if (subrubroNorm === SUBRUBRO_TODOS && !catFinalByCategoria.has(categoriaNorm)) {
        catFinalByCategoria.set(categoriaNorm, { id: Number(c.id), nombre: String(c.categoria_final) });
      }
    }

    const reglas = descuentosRows.map((r) => ({
      id: Number(r.id),
      categoriaFinalId: Number(r.id_categoriafinal),
      descuento: Number(r.descuento),
      diasMin: Number(r[reglaCols.diasMinField]),
      diasMax: Number(r[reglaCols.diasMaxField]),
    }));

    const days = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('days') ?? '365', 10) || 365, 1), 365);
    const daysMinRaw = parseInt(request.nextUrl.searchParams.get('daysMin') ?? '0', 10);
    const daysMin = Number.isNaN(daysMinRaw) ? 0 : Math.max(0, Math.min(daysMinRaw, days));
    const hoy = new Date();
    const hoyStr = hoy.toISOString().split('T')[0];
    const hoyMid = parseFechaISOaUTC(hoyStr);
    const hasta = new Date(hoy.getTime() + days * 86400000).toISOString().split('T')[0];

    const { data: vencRows, error: vencErr } = await admin
      .from('controles_vencimientos_detalle')
      .select(
        'codigo_barras, producto_id_sistema, fecha_vencimiento, cantidad, vendido, devuelto, controles_vencimientos!inner(sucursal_id)'
      )
      .eq('controles_vencimientos.sucursal_id', sucursalNum)
      .gte('fecha_vencimiento', hoyStr)
      .lte('fecha_vencimiento', hasta)
      .eq('vendido', 0)
      .eq('devuelto', 0)
      .eq('eliminado', 0);
    if (vencErr) return NextResponse.json({ error: vencErr.message }, { status: 500 });

    const { data: sucursalRow } = await admin
      .from('sucursales')
      .select('nombrefantasia')
      .eq('sucursal', sucursalNum)
      .maybeSingle();
    const { data: sucursalesRows } = await admin
      .from('sucursales')
      .select('sucursal, nombrefantasia')
      .order('sucursal', { ascending: true });

    const mesNombre = hoy.toLocaleString('es-ES', { month: 'long' });
    const anio = hoy.getFullYear();
    const sucursalNombre = String(
      (sucursalRow as { nombrefantasia?: string | null } | null)?.nombrefantasia ?? `Sucursal_${sucursalNum}`
    ).trim();
    const sanitize = (name: string) =>
      name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
    const filename = `${sanitize(sucursalNombre)}_${sanitize(mesNombre)}_${anio}.csv`;

    const aplicados: Array<{
      codigo_barras: string;
      categoria_final: string;
      descuento: number;
      cantidad: number;
      dias_hasta: number;
    }> = [];

    for (const r of (vencRows ?? []) as Array<{
      codigo_barras?: string | null;
      producto_id_sistema?: string | null;
      fecha_vencimiento?: string | null;
      cantidad?: number | null;
    }>) {
      const codebar = String(r.codigo_barras ?? '').trim();
      const codplex = String(r.producto_id_sistema ?? '').trim();
      const padronRef =
        (codebar ? padronMap.byCodebar.get(codebar) : undefined) ??
        (codplex ? padronMap.byCodplex.get(codplex) : undefined);
      if (!padronRef) continue;

      const catFinal =
        catFinalByKey.get(`${padronRef.subrubro}|${padronRef.categoria}`) ??
        catFinalByCategoria.get(String(padronRef.categoria).trim());
      if (!catFinal) continue;

      const fechaV = new Date(String(r.fecha_vencimiento ?? ''));
      const fechaVUtc = parseFechaISOaUTC(String(r.fecha_vencimiento ?? ''));
      const diasHasta = Number.isFinite(fechaVUtc)
        ? Math.floor((fechaVUtc - hoyMid) / 86400000)
        : Math.floor((fechaV.getTime() - hoy.getTime()) / 86400000);
      if (diasHasta < daysMin) continue;

      const candidatas = reglas
        .filter((x) => x.categoriaFinalId === catFinal.id && diasHasta >= x.diasMin && diasHasta <= x.diasMax)
        .sort((a, b) => {
          const rA = a.diasMax - a.diasMin;
          const rB = b.diasMax - b.diasMin;
          if (rA !== rB) return rA - rB;
          return b.descuento - a.descuento;
        });
      if (candidatas.length === 0) continue;
      const regla = candidatas[0];
      const descuentoNeg = -Math.abs(Number(regla.descuento ?? 0));

      aplicados.push({
        codigo_barras: codebar,
        categoria_final: catFinal.nombre,
        descuento: descuentoNeg,
        cantidad: Number(r.cantidad ?? 0),
        dias_hasta: diasHasta,
      });
    }

    if (csvReal) {
      const csvBody = aplicados
        .map((x) => [x.codigo_barras, String(Math.round(x.descuento)), String(Math.round(x.cantidad))].join(','))
        .join('\n');
      return new Response(csvBody, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json({
      data: aplicados,
      meta: {
        sucursal_id: sucursalNum,
        sucursal_nombre: sucursalNombre,
        mes: mesNombre,
        anio,
        filename,
        days,
        daysMin,
      },
      sucursales:
        (sucursalesRows ?? []).map((s) => ({
          sucursal: Number((s as { sucursal?: number | string | null }).sucursal ?? 0),
          nombrefantasia: String((s as { nombrefantasia?: string | null }).nombrefantasia ?? ''),
        })) ?? [],
    });
  }

  return NextResponse.json({
    opciones_padron: padron,
    categorias_finales: categoriasFinales ?? [],
    descuentos: descuentosRows.map((d) => {
      const row = d as unknown as Record<string, unknown> & {
        id: number;
        id_categoriafinal: number;
        descuento: number;
        categorias_finales?: { id: number; categoria_final: string } | null;
      };
      return {
        id: row.id,
        categoria_final_id: row.id_categoriafinal,
        categoria_final: row.categorias_finales?.categoria_final ?? '',
        descuento: Number(row.descuento ?? 0),
        dias_min: Number(row[reglaCols.diasMinField] ?? 0),
        dias_max: Number(row[reglaCols.diasMaxField] ?? 0),
      };
    }),
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;
  const admin = await createAdminClient();
  const reglaCols = await resolverColumnasReglas(admin);
  if (!reglaCols) {
    return NextResponse.json(
      { error: 'No se pudieron resolver columnas de días en descuentos_vencimientos_reglas' },
      { status: 500 }
    );
  }

  const body = (await request.json()) as
    | { tipo: 'categoria_final'; payload: CategoriaFinalPayload }
    | { tipo: 'descuento'; payload: DescuentoPayload };

  if (body.tipo === 'categoria_final') {
    const subrubroInput = String(body.payload?.subrubro ?? '').trim();
    const subrubro = subrubroInput || SUBRUBRO_TODOS;
    const categoria = String(body.payload?.categoria ?? '').trim();
    const categoriaFinal = String(body.payload?.categoria_final ?? '').trim();
    if (!categoria || !categoriaFinal) {
      return NextResponse.json(
        { error: 'categoria y categoria_final son requeridos' },
        { status: 400 }
      );
    }

    const { data: existente } = await admin
      .from('categorias_finales')
      .select('id')
      .eq('subrubro_nombre', subrubro)
      .eq('categoria', categoria)
      .maybeSingle();

    if (existente?.id) {
      const { error } = await admin
        .from('categorias_finales')
        .update({ categoria_final: categoriaFinal })
        .eq('id', existente.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      // Evitar duplicado exacto de categoría final para la misma clave funcional.
      const { data: repetidaExacta } = await admin
        .from('categorias_finales')
        .select('id')
        .eq('subrubro_nombre', subrubro)
        .eq('categoria', categoria)
        .eq('categoria_final', categoriaFinal)
        .maybeSingle();
      if (repetidaExacta?.id) {
        return NextResponse.json(
          { error: 'Ya existe una categoría final igual para esa categoría/subrubro.' },
          { status: 409 }
        );
      }
      const { error } = await admin.from('categorias_finales').insert({
        subrubro_nombre: subrubro,
        categoria,
        categoria_final: categoriaFinal,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.tipo === 'descuento') {
    const categoriaFinalId = Number(body.payload?.categoria_final_id);
    const descuento = Number(body.payload?.descuento);
    const diasMin = Number(body.payload?.dias_min);
    const diasMax = Number(body.payload?.dias_max);

    if (!Number.isFinite(categoriaFinalId) || categoriaFinalId <= 0) {
      return NextResponse.json({ error: 'categoria_final_id inválido' }, { status: 400 });
    }
    if (!Number.isFinite(descuento) || descuento < 1 || descuento > 100) {
      return NextResponse.json({ error: 'El descuento debe estar entre 1 y 100' }, { status: 400 });
    }
    if (!Number.isFinite(diasMin) || !Number.isFinite(diasMax)) {
      return NextResponse.json({ error: 'dias_min y dias_max son requeridos' }, { status: 400 });
    }
    if (diasMax < diasMin) {
      return NextResponse.json({ error: 'dias_max no puede ser menor a dias_min' }, { status: 400 });
    }

    // Validación de duplicados: misma categoría final + mismo rango de días.
    const { data: repetidoRango } = await admin
      .from('descuentos_vencimientos_reglas')
      .select('id')
      .eq('id_categoriafinal', categoriaFinalId)
      .eq(reglaCols.diasMinField, diasMin)
      .eq(reglaCols.diasMaxField, diasMax)
      .maybeSingle();
    if (repetidoRango?.id) {
      return NextResponse.json(
        { error: 'Ya existe un descuento para esa categoría final con ese rango de días.' },
        { status: 409 }
      );
    }

    const { error } = await admin.from('descuentos_vencimientos_reglas').insert({
      id_categoriafinal: categoriaFinalId,
      descuento,
      [reglaCols.diasMinField]: diasMin,
      [reglaCols.diasMaxField]: diasMax,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Tipo de operación inválido' }, { status: 400 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;
  const admin = await createAdminClient();
  const reglaCols = await resolverColumnasReglas(admin);
  if (!reglaCols) {
    return NextResponse.json(
      { error: 'No se pudieron resolver columnas de días en descuentos_vencimientos_reglas' },
      { status: 500 }
    );
  }
  const body = (await request.json()) as
    | { tipo: 'categoria_final'; id: number; categoria_final: string }
    | { tipo: 'descuento'; id: number; descuento: number; dias_min: number; dias_max: number };

  if (body.tipo === 'categoria_final') {
    const id = Number(body.id);
    const categoriaFinal = String(body.categoria_final ?? '').trim();
    if (!Number.isFinite(id) || id <= 0 || !categoriaFinal) {
      return NextResponse.json({ error: 'id y categoria_final son requeridos' }, { status: 400 });
    }
    const { error } = await admin
      .from('categorias_finales')
      .update({ categoria_final: categoriaFinal })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.tipo === 'descuento') {
    const id = Number(body.id);
    const descuento = Number(body.descuento);
    const diasMin = Number(body.dias_min);
    const diasMax = Number(body.dias_max);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }
    if (!Number.isFinite(descuento) || descuento < 1 || descuento > 100) {
      return NextResponse.json({ error: 'El descuento debe estar entre 1 y 100' }, { status: 400 });
    }
    if (!Number.isFinite(diasMin) || !Number.isFinite(diasMax) || diasMax < diasMin) {
      return NextResponse.json({ error: 'Rango de días inválido' }, { status: 400 });
    }
    // Evitar colisión de rangos al editar.
    const { data: actual } = await admin
      .from('descuentos_vencimientos_reglas')
      .select(`id, id_categoriafinal`)
      .eq('id', id)
      .maybeSingle();
    if (!actual) {
      return NextResponse.json({ error: 'Descuento no encontrado' }, { status: 404 });
    }
    const categoriaFinalId = Number((actual as { id_categoriafinal?: number }).id_categoriafinal ?? 0);
    if (!Number.isFinite(categoriaFinalId) || categoriaFinalId <= 0) {
      return NextResponse.json({ error: 'Categoría final inválida en el descuento' }, { status: 400 });
    }
    const { data: repetidoRango } = await admin
      .from('descuentos_vencimientos_reglas')
      .select('id')
      .eq('id_categoriafinal', categoriaFinalId)
      .eq(reglaCols.diasMinField, diasMin)
      .eq(reglaCols.diasMaxField, diasMax)
      .neq('id', id)
      .maybeSingle();
    if (repetidoRango?.id) {
      return NextResponse.json(
        { error: 'Ya existe otro descuento con ese rango de días para la misma categoría final.' },
        { status: 409 }
      );
    }
    const { error } = await admin
      .from('descuentos_vencimientos_reglas')
      .update({
        descuento,
        [reglaCols.diasMinField]: diasMin,
        [reglaCols.diasMaxField]: diasMax,
      })
      .eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Tipo de operación inválido' }, { status: 400 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return auth.error;
  const admin = await createAdminClient();

  const body = (await request.json()) as
    | { tipo: 'categoria_final'; id: number }
    | { tipo: 'descuento'; id: number };

  if (body.tipo === 'categoria_final') {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }
    const { error } = await admin.from('categorias_finales').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.tipo === 'descuento') {
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id inválido' }, { status: 400 });
    }
    const { error } = await admin.from('descuentos_vencimientos_reglas').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Tipo de operación inválido' }, { status: 400 });
}
