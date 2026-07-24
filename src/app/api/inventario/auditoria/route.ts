import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import { requirePermission } from '@/lib/auth/rbac';
import {
  type CategoriaMacro,
  esCategoriaMacro,
  normalizarCategoriaMacro,
} from '@/lib/inventario/categoria-macro';
import {
  inferirTipoControlInventario,
  nombreTipoControlInventario,
  type TipoControlInventario,
} from '@/lib/inventario/tipo-control';
import { esProductoControlado } from '@/lib/medicamentos/clasificacion-controlados';
import { getPadronPorProductos } from '@/lib/padron-final-db';
import { macroDesdePadron, padronParaProducto } from '@/lib/vencimientos-drogueria-lab';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const DETALLE_SELECT_AUDITORIA =
  'id, control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, stock_sistema, stock_sist_cajas, stock_sist_unidades, diferencia, estado, auditado, ajustado, con_diferencias, fecha_registro';

const LIMITE_AUDITORIA_PSICO = 30;
const LIMITE_AUDITORIA_OTRAS = 50;
const CHUNK_DETALLES = 1000;
const CHUNK_CODPLEX = 400;

function clavesProductoId(id: string | number | null | undefined): string[] {
  const s = String(id ?? '').trim();
  if (!s) return [];
  const keys = new Set<string>([s]);
  const n = Number(s);
  if (Number.isFinite(n)) keys.add(String(n));
  return Array.from(keys);
}

function idProductoCanonico(id: string | number | null | undefined): string {
  const keys = clavesProductoId(id);
  if (keys.length === 0) return '';
  const n = Number(keys[0]);
  return Number.isFinite(n) ? String(n) : keys[0];
}

function esPsicotropicoProducto(productoId: string, psicotropicosIds: Set<string>): boolean {
  return clavesProductoId(productoId).some((k) => psicotropicosIds.has(k));
}

/** Psicotrópico por medicamento; si no, padrón; si no, FARMA. */
function macroProductoAuditoria(
  productoId: string,
  padron: Awaited<ReturnType<typeof getPadronPorProductos>>,
  psicotropicosIds: Set<string>
): CategoriaMacro {
  if (esPsicotropicoProducto(productoId, psicotropicosIds)) return 'PSICOTROPICOS';
  const desdePadron = macroDesdePadron(padronParaProducto(padron, productoId)?.cat_macro);
  if (desdePadron) return desdePadron;
  return 'FARMA';
}

function normalizarEstadoDetalle(estado: string | null | undefined): string {
  return String(estado ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function detalleElegibleParaAuditoria(detalle: DetalleConDiferencia): boolean {
  const estado = normalizarEstadoDetalle(detalle.estado);
  if (Number(detalle.auditado ?? 0) === 1) return false;
  if (estado === 'ajustado_auditoria') return false;
  if (estado === 'sin diferencias') return false;

  const ajustadoSucursal =
    Number(detalle.ajustado ?? 0) === 1 || estado === 'ajustado_sucursal';
  if (!ajustadoSucursal) return false;

  return (
    Number(detalle.con_diferencias ?? 0) === 1 ||
    estado === 'con diferencia' ||
    estado === 'ajustado_sucursal'
  );
}

async function cargarPsicotropicosIds(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  codplexIds: string[]
): Promise<Set<string>> {
  const psicotropicosIds = new Set<string>();
  const unicos = Array.from(new Set(codplexIds.map((id) => idProductoCanonico(id)).filter(Boolean)));
  for (let i = 0; i < unicos.length; i += CHUNK_CODPLEX) {
    const lote = unicos.slice(i, i + CHUNK_CODPLEX);
    const { data: meds, error: medsError } = await admin
      .from('medicamentos')
      .select('codplex, idpsicofarmaco')
      .in('codplex', lote);

    if (medsError) throw medsError;

    for (const m of meds ?? []) {
      const codplex = (m as { codplex?: string | number | null }).codplex;
      const idpsicofarmaco = (m as { idpsicofarmaco?: string | null }).idpsicofarmaco;
      if (codplex == null || !esProductoControlado(idpsicofarmaco)) continue;
      for (const k of clavesProductoId(codplex)) psicotropicosIds.add(k);
    }
  }
  return psicotropicosIds;
}

async function cargarDetallesCerradosParaAuditoria(
  admin: Awaited<ReturnType<typeof createAdminClient>>,
  idsCerrados: string[]
): Promise<DetalleConDiferencia[]> {
  const acumulado: DetalleConDiferencia[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('controles_inventario_detalle')
      .select(DETALLE_SELECT_AUDITORIA)
      .in('control_id', idsCerrados)
      .order('fecha_registro', { ascending: true })
      .range(offset, offset + CHUNK_DETALLES - 1);

    if (error) throw error;
    const batch = (data ?? []) as DetalleConDiferencia[];
    acumulado.push(...batch);
    if (batch.length < CHUNK_DETALLES) break;
    offset += CHUNK_DETALLES;
  }
  return acumulado;
}

/** Controles cerrados de sucursal (no auditoría ni integral) con diferencias ya ajustadas. */
function esControlOrigenParaAuditar(control: {
  tipo?: string | null;
  origen?: string | null;
}): boolean {
  const tipo = inferirTipoControlInventario(control);
  const excluidos: TipoControlInventario[] = [
    'auditoria',
    'auditoria_integral',
    'ocasional_auditoria',
  ];
  return !excluidos.includes(tipo);
}

type DetalleConDiferencia = {
  id: string;
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string | null;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  stock_sistema: number | null;
  stock_sist_cajas: number | null;
  stock_sist_unidades: number | null;
  diferencia?: number | null;
  estado?: string | null;
  auditado?: number | null;
  ajustado?: number | null;
  con_diferencias?: number | null;
  fecha_registro?: string | null;
};

/** POST /api/inventario/auditoria - crear auditoría de inventario (solo admin) */
export async function POST(request: Request) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const guard = await requirePermission('inventario.auditoria');
  if (!guard.ok) return guard.response;

  const cookieStore = await cookies();
  const sucursalId = cookieStore.get('sucursal_id')?.value;
  if (!sucursalId) return NextResponse.json({ error: 'Sucursal no seleccionada' }, { status: 400 });

  const admin = await createAdminClient();
  const tipoObjetivo = 'auditoria';

  const { data: controlesAbiertos, error: abiertosError } = await admin
    .from('controles_inventario')
    .select('id, origen, tipo, categoria_macro, descripcion')
    .eq('sucursal_id', parseInt(sucursalId, 10))
    .eq('estado', 'en_progreso');

  if (abiertosError) {
    return NextResponse.json({ error: abiertosError.message }, { status: 500 });
  }

  let body: {
    descripcion?: string;
    categoria_macro?: string;
    confirm_override?: boolean;
  } = {};
  try {
    body = (await request.json()) as {
      descripcion?: string;
      categoria_macro?: string;
      confirm_override?: boolean;
    };
  } catch {
    return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 });
  }

  const categoriaMacroRaw =
    typeof body.categoria_macro === 'string' ? body.categoria_macro.trim().toUpperCase() : '';
  if (!esCategoriaMacro(categoriaMacroRaw)) {
    return NextResponse.json(
      { error: 'Seleccioná una categoría macro (FARMA, BIENESTAR o PSICOTROPICOS)' },
      { status: 400 }
    );
  }
  const categoriaMacro: CategoriaMacro = categoriaMacroRaw;

  const controlesAbiertosMismaCategoria = (controlesAbiertos ?? []).filter((control) => {
    if (inferirTipoControlInventario(control) !== tipoObjetivo) return false;
    return normalizarCategoriaMacro(control.categoria_macro) === categoriaMacro;
  });

  const warning =
    controlesAbiertosMismaCategoria.length > 0
      ? `Ya hay una ${nombreTipoControlInventario(tipoObjetivo)} abierta para ${categoriaMacro}. Se abrirá una nueva y se omitirán los productos ya asignados en las auditorías abiertas de esa categoría.`
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

  // Productos ya cargados en auditorías abiertas de la misma macro → no repetir.
  const idsExcluidos = new Set<string>();
  if (controlesAbiertosMismaCategoria.length > 0) {
    const idsAbiertos = controlesAbiertosMismaCategoria.map((c) => c.id);
    const { data: detallesAbiertos, error: detallesAbiertosError } = await admin
      .from('controles_inventario_detalle')
      .select('producto_id_sistema')
      .in('control_id', idsAbiertos);

    if (detallesAbiertosError) {
      console.error(
        'Error obteniendo productos de auditorías abiertas:',
        detallesAbiertosError
      );
    } else {
      for (const row of detallesAbiertos ?? []) {
        for (const k of clavesProductoId(
          (row as { producto_id_sistema?: string | null }).producto_id_sistema
        )) {
          idsExcluidos.add(k);
        }
      }
    }
  }

  const descripcion =
    body.descripcion && body.descripcion.trim().length > 0
      ? body.descripcion.trim()
      : `Auditoría de inventario — ${categoriaMacro}`;

  // Crear el control de auditoría
  const { data: control, error: createError } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      origen: 'Auditoria',
      tipo: 'auditoria',
      categoria_macro: categoriaMacro,
      descripcion,
    })
    .select()
    .single();

  if (createError || !control) {
    return NextResponse.json(
      { error: createError?.message ?? 'Error al crear auditoría' },
      { status: 500 }
    );
  }

  const controlId = control.id as string;

  // Traer productos con diferencias en controles cerrados de esta sucursal
  const { data: controlesCerrados, error: cerradosError } = await admin
    .from('controles_inventario')
    .select('id, tipo')
    .eq('sucursal_id', parseInt(sucursalId, 10))
    .eq('estado', 'cerrado');

  let totalInsertados = 0;

  if (!cerradosError && controlesCerrados && controlesCerrados.length > 0) {
    const idsCerrados = controlesCerrados
      .filter((c) => esControlOrigenParaAuditar(c))
      .map((c) => c.id);

    if (idsCerrados.length > 0) {
      let detallesConDif: DetalleConDiferencia[];
      try {
        detallesConDif = await cargarDetallesCerradosParaAuditoria(admin, idsCerrados);
      } catch (difError) {
        const msg = difError instanceof Error ? difError.message : 'Error al buscar diferencias';
        return NextResponse.json(
          { error: `Error al buscar diferencias para auditoría: ${msg}` },
          { status: 500 }
        );
      }

      if (detallesConDif.length > 0) {
        // Deduplicar por producto conservando la diferencia más antigua (orden asc).
        const porProducto = new Map<string, DetalleConDiferencia>();
        for (const detalle of detallesConDif) {
          if (!detalleElegibleParaAuditoria(detalle)) continue;

          const productoId = idProductoCanonico(detalle.producto_id_sistema);
          if (!productoId || porProducto.has(productoId)) continue;
          porProducto.set(productoId, detalle);
        }

        const productosUnicos = Array.from(porProducto.values());
        const codplexIds = productosUnicos
          .map((d) => d.producto_id_sistema)
          .filter((id): id is string => !!id);

        let padronPorProducto: Awaited<ReturnType<typeof getPadronPorProductos>> = new Map();
        try {
          padronPorProducto = await getPadronPorProductos(codplexIds);
        } catch (padronError) {
          console.warn(
            '[auditoria] No se pudo consultar padron_final; se usa fallback psicotrópico/FARMA:',
            padronError
          );
        }

        let psicotropicosIds = new Set<string>();
        const subrubroPorCodplex = new Map<string, number | null>();
        if (codplexIds.length > 0) {
          try {
            psicotropicosIds = await cargarPsicotropicosIds(admin, codplexIds);
          } catch (medsError) {
            const msg = medsError instanceof Error ? medsError.message : 'Error en medicamentos';
            return NextResponse.json(
              { error: `Error al clasificar psicotrópicos: ${msg}` },
              { status: 500 }
            );
          }

          const unicosMeds = Array.from(
            new Set(codplexIds.map((id) => idProductoCanonico(id)).filter(Boolean))
          );
          for (let i = 0; i < unicosMeds.length; i += CHUNK_CODPLEX) {
            const lote = unicosMeds.slice(i, i + CHUNK_CODPLEX);
            const { data: medsSub, error: subError } = await admin
              .from('medicamentos')
              .select('codplex, idsubrubro')
              .in('codplex', lote);
            if (subError) {
              return NextResponse.json(
                { error: `Error al consultar subrubros de productos: ${subError.message}` },
                { status: 500 }
              );
            }
            for (const m of medsSub ?? []) {
              const codplex = (m as { codplex?: string | number | null }).codplex;
              const idsubrubroRaw = (m as { idsubrubro?: number | null }).idsubrubro;
              if (codplex == null) continue;
              for (const k of clavesProductoId(codplex)) {
                subrubroPorCodplex.set(k, idsubrubroRaw ?? null);
              }
            }
          }
        }

        const categoriaPorSubrubro = new Map<number, string>();
        const subrubrosIds = Array.from(
          new Set(
            Array.from(subrubroPorCodplex.values()).filter(
              (v): v is number => typeof v === 'number' && Number.isFinite(v)
            )
          )
        );
        if (subrubrosIds.length > 0) {
          const { data: subrubros, error: subrubrosError } = await admin
            .from('subrubros')
            .select('idsubrubro, idcategoria')
            .in('idsubrubro', subrubrosIds);

          if (subrubrosError) {
            return NextResponse.json(
              { error: `Error al consultar subrubros: ${subrubrosError.message}` },
              { status: 500 }
            );
          }

          const idsCategoria = Array.from(
            new Set(
              (subrubros ?? [])
                .map((s) => (s as { idcategoria?: number | null }).idcategoria)
                .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
            )
          );

          const nombreCategoriaPorId = new Map<number, string>();
          if (idsCategoria.length > 0) {
            const { data: categorias, error: categoriasError } = await admin
              .from('categorias')
              .select('idcategoria, nombre')
              .in('idcategoria', idsCategoria);

            if (categoriasError) {
              return NextResponse.json(
                { error: `Error al consultar categorías: ${categoriasError.message}` },
                { status: 500 }
              );
            }

            for (const c of categorias ?? []) {
              const id = (c as { idcategoria?: number }).idcategoria;
              const nombre = String((c as { nombre?: string | null }).nombre ?? '').trim();
              if (typeof id === 'number') {
                nombreCategoriaPorId.set(id, nombre);
              }
            }
          }

          for (const s of subrubros ?? []) {
            const idSub = (s as { idsubrubro?: number }).idsubrubro;
            const idCat = (s as { idcategoria?: number | null }).idcategoria;
            if (typeof idSub === 'number' && typeof idCat === 'number') {
              categoriaPorSubrubro.set(idSub, nombreCategoriaPorId.get(idCat) ?? '');
            }
          }
        }

        const getTexto = (v: string | null | undefined) =>
          String(v ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase();

        const enriquecidos = productosUnicos.map((d) => {
          const productoId = idProductoCanonico(d.producto_id_sistema);
          const macro = macroProductoAuditoria(productoId, padronPorProducto, psicotropicosIds);
          const padron = padronParaProducto(padronPorProducto, productoId);
          const idSubrubro =
            clavesProductoId(productoId)
              .map((k) => subrubroPorCodplex.get(k))
              .find((v) => v != null) ?? null;
          const categoriaBienestar =
            String(padron?.categoria ?? '').trim() ||
            (idSubrubro != null ? categoriaPorSubrubro.get(idSubrubro) ?? '' : '');
          return {
            detalle: d,
            macro,
            categoriaBienestar: getTexto(categoriaBienestar),
            laboratorio: getTexto(d.laboratorio),
            // Nombre + presentación para orden alfabético
            nombrePresentacion: getTexto(
              `${d.descripcion ?? ''} ${d.presentacion ?? ''}`.replace(/\s+/g, ' ')
            ),
          };
        });

        const compararNombrePresentacion = (
          a: { nombrePresentacion: string },
          b: { nombrePresentacion: string }
        ) => a.nombrePresentacion.localeCompare(b.nombrePresentacion, 'es');

        const compararLabLuegoNombre = (
          a: { laboratorio: string; nombrePresentacion: string },
          b: { laboratorio: string; nombrePresentacion: string }
        ) => {
          const labCmp = a.laboratorio.localeCompare(b.laboratorio, 'es');
          if (labCmp !== 0) return labCmp;
          return compararNombrePresentacion(a, b);
        };

        // FARMA / PSICO: laboratorio → nombre+presentación
        // BIENESTAR: categoría → laboratorio → nombre+presentación
        const enriquecidosCategoria = enriquecidos
          .filter((x) => x.macro === categoriaMacro)
          .filter((x) => {
            if (idsExcluidos.size === 0) return true;
            const claves = clavesProductoId(x.detalle.producto_id_sistema);
            return !claves.some((k) => idsExcluidos.has(k));
          })
          .sort((a, b) => {
            if (categoriaMacro === 'BIENESTAR') {
              const catCmp = a.categoriaBienestar.localeCompare(b.categoriaBienestar, 'es');
              if (catCmp !== 0) return catCmp;
              return compararLabLuegoNombre(a, b);
            }
            return compararLabLuegoNombre(a, b);
          });

        const limite =
          categoriaMacro === 'PSICOTROPICOS' ? LIMITE_AUDITORIA_PSICO : LIMITE_AUDITORIA_OTRAS;
        // Mantener el orden de armado al insertar (no reordenar por fecha).
        const seleccionados = enriquecidosCategoria.slice(0, limite).map((x) => x.detalle);

        // Para auditoría no precargamos stock en el listado.
        // El stock se obtiene en tiempo real cuando se abre la card del producto.
        // fecha_registro escalonada: al recargar (order by fecha_registro) se conserva lab/nombre.
        const baseMs = Date.now();
        const filasInsert = seleccionados.map((d, i) => ({
          control_id: controlId,
          producto_id_sistema: d.producto_id_sistema,
          codigo_barras: d.codigo_barras,
          descripcion: d.descripcion,
          presentacion: d.presentacion ?? null,
          laboratorio: d.laboratorio ?? null,
          stock_sistema: 0,
          stock_sist_cajas: null,
          stock_sist_unidades: null,
          stock_real_cajas: null,
          stock_real_unidades: null,
          stock_real: 0,
          fecha_registro: new Date(baseMs + i).toISOString(),
        }));

        if (filasInsert.length > 0) {
          const { error: insertError } = await admin
            .from('controles_inventario_detalle')
            .insert(filasInsert);
          if (insertError) {
            await admin.from('controles_inventario').delete().eq('id', controlId);
            return NextResponse.json(
              { error: `Error al cargar productos de auditoría: ${insertError.message}` },
              { status: 500 }
            );
          }
          const detalleIdsAuditados = seleccionados
            .map((d) => d.id)
            .filter((detalleId): detalleId is string => Boolean(detalleId));
          if (detalleIdsAuditados.length > 0) {
            const { error: marcarAuditadoError } = await admin
              .from('controles_inventario_detalle')
              .update({ auditado: 1 })
              .in('id', detalleIdsAuditados);
            if (marcarAuditadoError) {
              await admin.from('controles_inventario').delete().eq('id', controlId);
              return NextResponse.json(
                { error: `Error al marcar ítems auditados: ${marcarAuditadoError.message}` },
                { status: 500 }
              );
            }
          }
          totalInsertados = filasInsert.length;
        }
      }
    }
  }

  if (totalInsertados === 0) {
    await admin.from('controles_inventario').delete().eq('id', controlId);
    return NextResponse.json(
      {
        error:
          idsExcluidos.size > 0
            ? `No hay más productos pendientes para auditar en ${categoriaMacro} (los disponibles ya están en auditorías abiertas o ya fueron auditados).`
            : `No hay productos con diferencias ya ajustadas en sucursal para auditar en ${categoriaMacro}`,
      },
      { status: 400 }
    );
  }

  return NextResponse.json({ data: control, warning }, { status: 201 });
}

