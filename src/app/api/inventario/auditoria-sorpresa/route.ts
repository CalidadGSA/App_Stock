import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import {
  extraerReferenciaAuditoriaIntegral,
  PREFIJO_DESCRIPCION_AUDITORIA_INTEGRAL,
} from '@/lib/inventario/tipo-control';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const TIPO_OBJETIVO = 'auditoria_integral' as const;
const MAX_PRODUCTOS = 5000;

export type AuditoriaSorpresaAbierta = {
  id: string;
  referencia: string;
  sucursal_id: number;
  sucursal_nombre: string;
  fecha_inicio: string;
  total_productos: number;
};

/** GET — auditorías integrales en progreso de la sucursal en sesión. */
export async function GET() {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const guard = await requirePermission('inventario.auditoria');
  if (!guard.ok) return guard.response;

  const cookieStore = await cookies();
  const sucursalIdRaw = cookieStore.get('sucursal_id')?.value;
  const sucursalNombreCookie = cookieStore.get('sucursal_nombre')?.value ?? '';
  const sucursalIdNum = parseInt(String(sucursalIdRaw ?? ''), 10);

  if (!sucursalIdRaw || Number.isNaN(sucursalIdNum)) {
    return NextResponse.json(
      { error: 'Sucursal no seleccionada', sucursal_actual: null, data: [] },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();
  let query = admin
    .from('controles_inventario')
    .select(
      'id, sucursal_id, descripcion, fecha_inicio, controles_inventario_detalle(id), sucursales(nombrefantasia)'
    )
    .eq('tipo', TIPO_OBJETIVO)
    .eq('estado', 'en_progreso')
    .eq('sucursal_id', sucursalIdNum)
    .order('fecha_inicio', { ascending: false });

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const list: AuditoriaSorpresaAbierta[] = (data ?? []).map((row) => {
    const sucursalRaw = row.sucursales as { nombrefantasia?: string } | { nombrefantasia?: string }[] | null;
    const sucursalNombre = Array.isArray(sucursalRaw)
      ? String(sucursalRaw[0]?.nombrefantasia ?? row.sucursal_id)
      : String(sucursalRaw?.nombrefantasia ?? row.sucursal_id);
    const detalles = row.controles_inventario_detalle as { id?: string }[] | null;
    return {
      id: String(row.id),
      referencia: extraerReferenciaAuditoriaIntegral(row.descripcion as string | null),
      sucursal_id: Number(row.sucursal_id),
      sucursal_nombre: sucursalNombre,
      fecha_inicio: String(row.fecha_inicio),
      total_productos: Array.isArray(detalles) ? detalles.length : 0,
    };
  });

  return NextResponse.json({
    data: list,
    sucursal_actual: {
      id: sucursalIdNum,
      nombre: sucursalNombreCookie || list[0]?.sucursal_nombre || String(sucursalIdNum),
    },
  });
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** POST /api/inventario/auditoria-sorpresa — crear control con productos desde CSV (admin). */
export async function POST(request: Request) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const guard = await requirePermission('inventario.auditoria');
  if (!guard.ok) return guard.response;

  const cookieStore = await cookies();
  const sucursalIdRaw = cookieStore.get('sucursal_id')?.value;
  if (!sucursalIdRaw) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }
  const sucursalIdNum = parseInt(sucursalIdRaw, 10);
  if (Number.isNaN(sucursalIdNum)) {
    return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });
  }

  let body: {
    referencia?: string;
    producto_ids?: string[];
  } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const referencia = typeof body.referencia === 'string' ? body.referencia.trim() : '';
  if (!referencia) {
    return NextResponse.json({ error: 'La referencia del control es obligatoria' }, { status: 400 });
  }

  const rawIds = Array.isArray(body.producto_ids) ? body.producto_ids : [];
  const productoIds = Array.from(
    new Set(
      rawIds
        .map((id) => String(id ?? '').trim())
        .filter((id) => /^\d+$/.test(id))
        .map((id) => String(parseInt(id, 10)))
    )
  );

  if (productoIds.length === 0) {
    return NextResponse.json(
      { error: 'El CSV debe incluir al menos un ID de producto (codplex) válido' },
      { status: 400 }
    );
  }

  if (productoIds.length > MAX_PRODUCTOS) {
    return NextResponse.json(
      { error: `Máximo ${MAX_PRODUCTOS} productos por auditoría integral` },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();

  const { data: sucursal, error: sucError } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, activa')
    .eq('sucursal', sucursalIdNum)
    .maybeSingle();

  if (sucError) {
    return NextResponse.json({ error: sucError.message }, { status: 500 });
  }
  if (!sucursal || !sucursal.activa) {
    return NextResponse.json({ error: 'Sucursal no encontrada o inactiva' }, { status: 404 });
  }

  const descripcion = `${PREFIJO_DESCRIPCION_AUDITORIA_INTEGRAL}${referencia}`;

  const { data: control, error: createError } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: sucursalIdNum,
      usuario_id: operador.idoperador,
      origen: 'Auditoria',
      tipo: TIPO_OBJETIVO,
      descripcion,
    })
    .select()
    .single();

  if (createError || !control) {
    return NextResponse.json(
      { error: createError?.message ?? 'Error al crear auditoría integral' },
      { status: 500 }
    );
  }

  const controlId = control.id as string;

  type MedRow = {
    codplex: number | string;
    codebar: string | null;
    producto: string | null;
    presentaci: string | null;
    codlab: number | null;
  };

  const medPorCodplex = new Map<string, MedRow>();

  for (const lote of chunk(productoIds, 400)) {
    const codplexNums = lote.map((id) => parseInt(id, 10));
    const { data: meds, error: medsError } = await admin
      .from('medicamentos')
      .select('codplex, codebar, producto, presentaci, codlab')
      .in('codplex', codplexNums);

    if (medsError) {
      await admin.from('controles_inventario').delete().eq('id', controlId);
      return NextResponse.json({ error: medsError.message }, { status: 500 });
    }

    for (const m of meds ?? []) {
      const codplex = String((m as MedRow).codplex ?? '').trim();
      if (codplex) medPorCodplex.set(codplex, m as MedRow);
    }
  }

  const codlabs = Array.from(
    new Set(
      Array.from(medPorCodplex.values())
        .map((m) => m.codlab)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    )
  );

  const labPorCodlab = new Map<number, string>();
  if (codlabs.length > 0) {
    const { data: labs, error: labsError } = await admin
      .from('laboratorios')
      .select('codlab, laborato')
      .in('codlab', codlabs);

    if (labsError) {
      await admin.from('controles_inventario').delete().eq('id', controlId);
      return NextResponse.json({ error: labsError.message }, { status: 500 });
    }

    for (const lab of labs ?? []) {
      const codlab = (lab as { codlab?: number }).codlab;
      const nombre = String((lab as { laborato?: string }).laborato ?? '').trim();
      if (typeof codlab === 'number') labPorCodlab.set(codlab, nombre);
    }
  }

  const noEncontrados: string[] = [];
  const filasInsert = productoIds
    .map((id) => {
      const med = medPorCodplex.get(id);
      if (!med) {
        noEncontrados.push(id);
        return null;
      }
      const codplex = String(med.codplex);
      const lab =
        med.codlab != null ? labPorCodlab.get(med.codlab) ?? null : null;
      return {
        control_id: controlId,
        producto_id_sistema: codplex,
        codigo_barras: med.codebar ?? null,
        descripcion: String(med.producto ?? '').trim() || `Producto ${codplex}`,
        presentacion: med.presentaci ?? null,
        laboratorio: lab,
        stock_sistema: 0,
        stock_sist_cajas: null,
        stock_sist_unidades: null,
        stock_real_cajas: null,
        stock_real_unidades: null,
        stock_real: 0,
        estado: 'en_progreso',
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  if (filasInsert.length === 0) {
    await admin.from('controles_inventario').delete().eq('id', controlId);
    return NextResponse.json(
      {
        error: 'Ningún ID del CSV existe en medicamentos. Verificá los codplex e intentá de nuevo.',
        resumen: { solicitados: productoIds.length, cargados: 0, no_encontrados: noEncontrados },
      },
      { status: 400 }
    );
  }

  for (const lote of chunk(filasInsert, 500)) {
    const { error: insertError } = await admin.from('controles_inventario_detalle').insert(lote);
    if (insertError) {
      await admin.from('controles_inventario').delete().eq('id', controlId);
      return NextResponse.json(
        { error: `Error al cargar productos: ${insertError.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json(
    {
      data: control,
      resumen: {
        solicitados: productoIds.length,
        cargados: filasInsert.length,
        no_encontrados: noEncontrados,
        referencia,
        sucursal_id: sucursalIdNum,
        sucursal_nombre: sucursal.nombrefantasia,
      },
    },
    { status: 201 }
  );
}
