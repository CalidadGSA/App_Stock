import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import {
  clasificarProductoControlado,
  etiquetaTipoControlado,
  type TipoProductoControlado,
} from '@/lib/medicamentos/clasificacion-controlados';
import { esSucursalVisibleEnLogin } from '@/lib/sucursales/login-sucursales';
import { fechaHoyArgentinaYmd, ymdAddDays } from '@/lib/utils';
import { NextRequest, NextResponse } from 'next/server';

export interface DiferenciaPsicoOcasionalItem {
  id: string;
  control_id: string;
  fecha_control: string;
  producto_id_sistema: string;
  codigo_barras: string | null;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  tipo_controlado: TipoProductoControlado;
  tipo_controlado_label: string;
  idpsicofarmaco: string;
  psicofarmaco_nombre: string | null;
  diff_cajas: number;
  diff_unidades: number;
  ajustado: boolean;
}

export interface DiferenciaPsicoOcasionalSucursal {
  sucursal_id: number;
  sucursal_nombre: string;
  total_items: number;
  total_psicotropicos: number;
  total_estupefacientes: number;
  diff_cajas: number;
  diff_unidades: number;
  items: DiferenciaPsicoOcasionalItem[];
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

/** GET /api/admin/diferencias-psico-ocasional — diferencias de inventario ocasional_sucursal cerrado (solo admin). */
export async function GET(request: NextRequest) {
  const guard = await requirePermission('admin.diferencias_psico');
  if (!guard.ok) return guard.response;

  const { searchParams } = new URL(request.url);
  const hoy = fechaHoyArgentinaYmd();
  const desde = searchParams.get('desde') ?? ymdAddDays(hoy, -90);
  const hasta = searchParams.get('hasta') ?? hoy;
  const soloPendientes = searchParams.get('solo_pendientes') !== '0';
  const sucursalIdParam = searchParams.get('sucursal_id')?.trim() ?? '';
  let sucursalFiltro: number | null = null;
  if (sucursalIdParam) {
    const parsed = parseInt(sucursalIdParam, 10);
    if (Number.isNaN(parsed)) {
      return NextResponse.json({ error: 'sucursal_id inválido' }, { status: 400 });
    }
    if (!esSucursalVisibleEnLogin(parsed)) {
      return NextResponse.json({ error: 'Sucursal no disponible' }, { status: 400 });
    }
    sucursalFiltro = parsed;
  }

  if (hasta < desde) {
    return NextResponse.json(
      { error: 'La fecha hasta no puede ser anterior a desde' },
      { status: 400 }
    );
  }

  const admin = await createAdminClient();
  const desdeIso = `${desde}T00:00:00.000Z`;
  const hastaIso = `${hasta}T23:59:59.999Z`;

  let query = admin
    .from('controles_inventario_detalle')
    .select(
      `id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio,
       stock_sist_cajas, stock_sist_unidades, stock_real_cajas, stock_real_unidades,
       con_diferencias, ajustado,
       controles_inventario!inner(id, fecha_inicio, fecha_fin, estado, sucursal_id, tipo, sucursales(nombrefantasia))`
    )
    .eq('controles_inventario.tipo', 'ocasional_sucursal')
    .eq('controles_inventario.estado', 'cerrado')
    .eq('con_diferencias', 1)
    .gte('controles_inventario.fecha_inicio', desdeIso)
    .lte('controles_inventario.fecha_inicio', hastaIso);

  if (soloPendientes) {
    query = query.eq('ajustado', 0);
  }

  if (sucursalFiltro != null) {
    query = query.eq('controles_inventario.sucursal_id', sucursalFiltro);
  }

  const { data: rows, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type DetalleRow = {
    id: string;
    control_id: string;
    producto_id_sistema: string;
    codigo_barras: string | null;
    descripcion: string;
    presentacion: string | null;
    laboratorio: string | null;
    stock_sist_cajas?: number | null;
    stock_sist_unidades?: number | null;
    stock_real_cajas?: number | null;
    stock_real_unidades?: number | null;
    ajustado?: number | null;
    controles_inventario: {
      id: string;
      fecha_inicio: string;
      fecha_fin?: string | null;
      estado: string;
      sucursal_id: number;
      tipo: string;
      sucursales?: { nombrefantasia?: string | null } | null;
    };
  };

  const detalles = (rows ?? []) as unknown as DetalleRow[];
  const codplexIds = Array.from(
    new Set(detalles.map((d) => String(d.producto_id_sistema ?? '').trim()).filter(Boolean))
  );

  const medPorCodplex = new Map<
    string,
    { idpsicofarmaco: string | null }
  >();

  for (const lote of chunk(codplexIds, 400)) {
    const { data: meds, error: medsError } = await admin
      .from('medicamentos')
      .select('codplex, idpsicofarmaco')
      .in('codplex', lote);

    if (medsError) {
      return NextResponse.json({ error: medsError.message }, { status: 500 });
    }

    for (const m of meds ?? []) {
      const codplex = String((m as { codplex?: string | number }).codplex ?? '');
      if (!codplex) continue;
      medPorCodplex.set(codplex, {
        idpsicofarmaco: (m as { idpsicofarmaco?: string | null }).idpsicofarmaco ?? null,
      });
    }
  }

  const { data: psicoRows, error: psicoError } = await admin
    .from('psicofarmacos')
    .select('idpsicofarmaco, nombre');

  if (psicoError) {
    return NextResponse.json({ error: psicoError.message }, { status: 500 });
  }

  const nombrePsicoPorId = new Map<string, string>();
  for (const p of psicoRows ?? []) {
    const id = String((p as { idpsicofarmaco?: string }).idpsicofarmaco ?? '').trim();
    const nombre = String((p as { nombre?: string }).nombre ?? '').trim();
    if (id) nombrePsicoPorId.set(id, nombre);
    if (id) nombrePsicoPorId.set(id.toUpperCase(), nombre);
  }

  const porSucursal = new Map<number, DiferenciaPsicoOcasionalSucursal>();

  for (const d of detalles) {
    const productoId = String(d.producto_id_sistema ?? '').trim();
    const med = medPorCodplex.get(productoId);
    const tipo = clasificarProductoControlado(med?.idpsicofarmaco, nombrePsicoPorId);
    if (!tipo) continue;

    const sistC = Number(d.stock_sist_cajas ?? 0);
    const sistU = Number(d.stock_sist_unidades ?? 0);
    const realC = Number(d.stock_real_cajas ?? 0);
    const realU = Number(d.stock_real_unidades ?? 0);
    const diffCajas = realC - sistC;
    const diffUnidades = realU - sistU;
    if (diffCajas === 0 && diffUnidades === 0) continue;

    const controlRaw = d.controles_inventario;
    const control = Array.isArray(controlRaw) ? controlRaw[0] : controlRaw;
    if (!control) continue;

    const sucursalId = Number(control.sucursal_id);
    if (!esSucursalVisibleEnLogin(sucursalId)) continue;

    const sucursalRaw = control.sucursales;
    const sucursalJoin = Array.isArray(sucursalRaw) ? sucursalRaw[0] : sucursalRaw;
    const sucursalNombre = String(sucursalJoin?.nombrefantasia ?? sucursalId);

    const idPsico = String(med?.idpsicofarmaco ?? '').trim();

    const item: DiferenciaPsicoOcasionalItem = {
      id: d.id,
      control_id: String(control.id ?? d.control_id),
      fecha_control: control.fecha_fin ?? control.fecha_inicio,
      producto_id_sistema: productoId,
      codigo_barras: d.codigo_barras,
      descripcion: d.descripcion,
      presentacion: d.presentacion,
      laboratorio: d.laboratorio,
      tipo_controlado: tipo,
      tipo_controlado_label: etiquetaTipoControlado(tipo),
      idpsicofarmaco: idPsico,
      psicofarmaco_nombre: nombrePsicoPorId.get(idPsico) ?? nombrePsicoPorId.get(idPsico.toUpperCase()) ?? null,
      diff_cajas: diffCajas,
      diff_unidades: diffUnidades,
      ajustado: Number(d.ajustado ?? 0) === 1,
    };

    const actual = porSucursal.get(sucursalId) ?? {
      sucursal_id: sucursalId,
      sucursal_nombre: sucursalNombre,
      total_items: 0,
      total_psicotropicos: 0,
      total_estupefacientes: 0,
      diff_cajas: 0,
      diff_unidades: 0,
      items: [],
    };

    actual.items.push(item);
    actual.total_items += 1;
    if (tipo === 'estupefaciente') actual.total_estupefacientes += 1;
    else actual.total_psicotropicos += 1;
    actual.diff_cajas += diffCajas;
    actual.diff_unidades += diffUnidades;
    porSucursal.set(sucursalId, actual);
  }

  const sucursales = Array.from(porSucursal.values())
    .map((s) => ({
      ...s,
      items: s.items.sort((a, b) => {
        const tipoCmp = a.tipo_controlado.localeCompare(b.tipo_controlado);
        if (tipoCmp !== 0) return tipoCmp;
        return a.descripcion.localeCompare(b.descripcion, 'es');
      }),
    }))
    .sort((a, b) => a.sucursal_nombre.localeCompare(b.sucursal_nombre, 'es'));

  const totales = sucursales.reduce(
    (acc, s) => ({
      sucursales_con_diferencias: acc.sucursales_con_diferencias + 1,
      items: acc.items + s.total_items,
      psicotropicos: acc.psicotropicos + s.total_psicotropicos,
      estupefacientes: acc.estupefacientes + s.total_estupefacientes,
      diff_cajas: acc.diff_cajas + s.diff_cajas,
      diff_unidades: acc.diff_unidades + s.diff_unidades,
    }),
    {
      sucursales_con_diferencias: 0,
      items: 0,
      psicotropicos: 0,
      estupefacientes: 0,
      diff_cajas: 0,
      diff_unidades: 0,
    }
  );

  return NextResponse.json({
    data: {
      desde,
      hasta,
      solo_pendientes: soloPendientes,
      sucursal_id: sucursalFiltro,
      totales,
      sucursales,
    },
  });
}
