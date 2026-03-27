import { createAdminClient } from '@/lib/supabase/server';
import { getOperadorSession } from '@/lib/auth/session';
import {
  inferirTipoControlInventario,
  nombreTipoControlInventario,
} from '@/lib/inventario/tipo-control';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

type DetalleConDiferencia = {
  control_id: string;
  producto_id_sistema: string;
  codigo_barras: string;
  descripcion: string;
  presentacion: string | null;
  laboratorio: string | null;
  stock_sistema: number | null;
  stock_sist_cajas: number | null;
  stock_sist_unidades: number | null;
  diferencia?: number | null;
  estado?: string | null;
  auditado?: number | null;
  con_diferencias?: number | null;
  fecha_registro?: string | null;
};

/** POST /api/inventario/auditoria - crear auditoría de inventario (solo admin) */
export async function POST(request: Request) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  if (operador.rol !== 'admin') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 });
  }

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

  const controlAbiertoMismoTipo = (controlesAbiertos ?? []).find(
    (control) => inferirTipoControlInventario(control) === tipoObjetivo
  );

  if (controlAbiertoMismoTipo) {
    return NextResponse.json(
      {
        error: `Ya hay una ${nombreTipoControlInventario(tipoObjetivo)} abierta.`,
      },
      { status: 409 }
    );
  }

  let body: { descripcion?: string } = {};
  try {
    body = (await request.json()) as { descripcion?: string };
  } catch {
    // Ignoramos errores de parseo; descripción será opcional
  }

  const descripcion =
    body.descripcion && body.descripcion.trim().length > 0
      ? body.descripcion.trim()
      : 'Auditoría de inventario';

  // Crear el control de auditoría
  const { data: control, error: createError } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: parseInt(sucursalId, 10),
      usuario_id: operador.idoperador,
      origen: 'Auditoria',
      tipo: 'auditoria',
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
    .select('id, tipo, categoria_macro')
    .eq('sucursal_id', parseInt(sucursalId, 10))
    .eq('estado', 'cerrado');

  let totalInsertados = 0;

  if (!cerradosError && controlesCerrados && controlesCerrados.length > 0) {
    const idsCerrados = controlesCerrados
      .filter((c) => c.tipo !== 'auditoria')
      .map((c) => c.id);

    if (idsCerrados.length > 0) {
      const { data: detallesConDif, error: difError } = await admin
        .from('controles_inventario_detalle')
        .select(
          'control_id, producto_id_sistema, codigo_barras, descripcion, presentacion, laboratorio, stock_sistema, stock_sist_cajas, stock_sist_unidades, diferencia, estado, auditado, con_diferencias, fecha_registro'
        )
        .in('control_id', idsCerrados)
        .order('fecha_registro', { ascending: false });

      if (difError) {
        return NextResponse.json(
          { error: `Error al buscar diferencias para auditoría: ${difError.message}` },
          { status: 500 }
        );
      }

      if (detallesConDif && detallesConDif.length > 0) {
        // Deduplicar por producto conservando la última vez que fue inventariado con diferencia.
        const porProducto = new Map<string, DetalleConDiferencia>();
        for (const detalle of detallesConDif as DetalleConDiferencia[]) {
          const estadoNormalizado = String(detalle.estado ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase();
          const fueAuditado = Number(detalle.auditado ?? 0) === 1;
          const ajustadoAuditoria = estadoNormalizado === 'ajustado_auditoria';
          const sinDiferencias = estadoNormalizado === 'sin diferencias';
          const tieneDiferencia =
            Number(detalle.con_diferencias ?? 0) === 1 ||
            estadoNormalizado === 'con diferencia';

          if (fueAuditado || ajustadoAuditoria || sinDiferencias || !tieneDiferencia) continue;

          const productoId = detalle.producto_id_sistema;
          if (!productoId || porProducto.has(productoId)) continue;
          porProducto.set(productoId, detalle);
        }

        const productosUnicos = Array.from(porProducto.values());
        const codplexIds = productosUnicos
          .map((d) => d.producto_id_sistema)
          .filter((id): id is string => !!id);

        const psicotropicosIds = new Set<string>();
        const subrubroPorCodplex = new Map<string, number | null>();
        if (codplexIds.length > 0) {
          const { data: meds, error: medsError } = await admin
            .from('medicamentos')
            .select('codplex, idpsicofarmaco, idsubrubro')
            .in('codplex', codplexIds);

          if (medsError) {
            return NextResponse.json(
              { error: `Error al clasificar psicotrópicos: ${medsError.message}` },
              { status: 500 }
            );
          }

          for (const m of meds ?? []) {
            const codplex = String((m as { codplex?: string | number | null }).codplex ?? '');
            const idpsicofarmaco = (m as { idpsicofarmaco?: string | null }).idpsicofarmaco;
            const idsubrubroRaw = (m as { idsubrubro?: number | null }).idsubrubro;
            if (codplex && idpsicofarmaco) {
              psicotropicosIds.add(codplex);
            }
            if (codplex) {
              subrubroPorCodplex.set(codplex, idsubrubroRaw ?? null);
            }
          }
        }

        const macroPorControl = new Map<string, string | null>();
        for (const c of controlesCerrados) {
          macroPorControl.set(
            String(c.id),
            String((c as { categoria_macro?: string | null }).categoria_macro ?? '').toUpperCase() || null
          );
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

        const macroOrder: Record<string, number> = {
          PSICOTROPICOS: 0,
          FARMA: 1,
          BIENESTAR: 2,
        };

        const getTexto = (v: string | null | undefined) =>
          String(v ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toUpperCase();

        const normalizarMacro = (valor: string | null | undefined): 'PSICOTROPICOS' | 'FARMA' | 'BIENESTAR' | null => {
          const t = getTexto(valor);
          if (t === 'PSICOTROPICOS' || t === 'PSICOTROPICO') return 'PSICOTROPICOS';
          if (t === 'FARMA') return 'FARMA';
          if (t === 'BIENESTAR') return 'BIENESTAR';
          return null;
        };

        const enriquecidos = productosUnicos.map((d) => {
          const productoId = String(d.producto_id_sistema ?? '');
          const macroBase = normalizarMacro(macroPorControl.get(String(d.control_id)) ?? null);
          const macro =
            macroBase ??
            (psicotropicosIds.has(productoId) ? 'PSICOTROPICOS' : 'FARMA');
          const idSubrubro = subrubroPorCodplex.get(productoId) ?? null;
          const categoriaBienestar =
            idSubrubro != null ? categoriaPorSubrubro.get(idSubrubro) ?? '' : '';
          return {
            detalle: d,
            macro,
            categoriaBienestar,
            laboratorio: getTexto(d.laboratorio),
            descripcion: getTexto(`${d.descripcion ?? ''} ${d.presentacion ?? ''}`),
          };
        });

        enriquecidos.sort((a, b) => {
          const macroCmp = (macroOrder[a.macro] ?? 99) - (macroOrder[b.macro] ?? 99);
          if (macroCmp !== 0) return macroCmp;

          if (a.macro === 'PSICOTROPICOS') {
            return a.descripcion.localeCompare(b.descripcion, 'es');
          }

          if (a.macro === 'FARMA') {
            const labCmp = a.laboratorio.localeCompare(b.laboratorio, 'es');
            if (labCmp !== 0) return labCmp;
            return a.descripcion.localeCompare(b.descripcion, 'es');
          }

          const catCmp = getTexto(a.categoriaBienestar).localeCompare(
            getTexto(b.categoriaBienestar),
            'es'
          );
          if (catCmp !== 0) return catCmp;
          const labCmp = a.laboratorio.localeCompare(b.laboratorio, 'es');
          if (labCmp !== 0) return labCmp;
          return a.descripcion.localeCompare(b.descripcion, 'es');
        });

        const psicotropicos = enriquecidos
          .filter((x) => x.macro === 'PSICOTROPICOS')
          .map((x) => x.detalle);
        const noPsicotropicos = enriquecidos
          .filter((x) => x.macro !== 'PSICOTROPICOS')
          .map((x) => x.detalle);

        const seleccionados = [
          ...psicotropicos.slice(0, 15),
          ...noPsicotropicos.slice(0, 35),
        ];

        // Para auditoría no precargamos stock en el listado.
        // El stock se obtiene en tiempo real cuando se abre la card del producto.
        const filasInsert = seleccionados.map((d) => ({
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
          totalInsertados = filasInsert.length;
        }
      }
    }
  }

  if (totalInsertados === 0) {
    await admin.from('controles_inventario').delete().eq('id', controlId);
    return NextResponse.json(
      { error: 'No hay productos con diferencias pendientes para auditar en esta sucursal' },
      { status: 400 }
    );
  }

  return NextResponse.json({ data: control }, { status: 201 });
}

