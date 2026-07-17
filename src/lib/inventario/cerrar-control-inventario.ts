import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CATEGORIA_MACRO_SIN_PADRON,
  esCategoriaMacroSinPadron,
  filtrarQueryBaseProductosPorMacro,
} from '@/lib/inventario/categoria-macro';
import { consolidarDiferenciasDetalleControl } from '@/lib/inventario/consolidar-diferencias-detalle';
import { esTipoDiario, inferirTipoControlInventario } from '@/lib/inventario/tipo-control';
import { esSucursalDrogueria } from '@/lib/sucursales/drogueria';
import {
  incrementarVecesInventariadoDrogueria,
  obtenerTrimestreVigenteDrogueria,
} from '@/lib/inventario/base-productos-drogueria';

export type ControlInventarioParaCerrar = {
  id: string;
  estado: string;
  sucursal_id: number;
  categoria_macro?: string | null;
  fecha_inicio: string;
  origen?: string | null;
  tipo?: string | null;
  descripcion?: string | null;
};

export interface CerrarControlInventarioResult {
  ok: true;
  controlId: string;
  fechaCierre: string;
  lineasConDiferencia: number;
}

export interface CerrarControlInventarioError {
  ok: false;
  controlId: string;
  code: 'no_encontrado' | 'ya_cerrado' | 'error';
  message: string;
}

export type CerrarControlInventarioResponse =
  | CerrarControlInventarioResult
  | CerrarControlInventarioError;

export async function cerrarControlInventario(
  admin: SupabaseClient,
  controlId: string,
  opts?: {
    fechaCierreIso?: string;
    consolidarDiferencias?: boolean;
  }
): Promise<CerrarControlInventarioResponse> {
  const { data: control, error: loadErr } = await admin
    .from('controles_inventario')
    .select('id, estado, sucursal_id, categoria_macro, fecha_inicio, origen, tipo, descripcion')
    .eq('id', controlId)
    .maybeSingle();

  if (loadErr) {
    return { ok: false, controlId, code: 'error', message: loadErr.message };
  }
  if (!control) {
    return { ok: false, controlId, code: 'no_encontrado', message: 'Control no encontrado' };
  }
  if (control.estado !== 'en_progreso') {
    return { ok: false, controlId, code: 'ya_cerrado', message: 'Ya está cerrado' };
  }

  const fechaCierre = opts?.fechaCierreIso ?? new Date().toISOString();
  const consolidar = opts?.consolidarDiferencias !== false;

  let lineasConDiferencia = 0;
  if (consolidar) {
    const res = await consolidarDiferenciasDetalleControl(admin, controlId);
    lineasConDiferencia = res.lineasConDiferencia;
  }

  const { error: closeErr } = await admin
    .from('controles_inventario')
    .update({ estado: 'cerrado', fecha_fin: fechaCierre, updated_at: fechaCierre })
    .eq('id', controlId);

  if (closeErr) {
    return { ok: false, controlId, code: 'error', message: closeErr.message };
  }

  const { error: detalleCloseError } = await admin
    .from('controles_inventario_detalle')
    .update({ fecha_registro: fechaCierre })
    .eq('control_id', controlId)
    .eq('con_diferencias', 1);

  if (detalleCloseError) {
    return { ok: false, controlId, code: 'error', message: detalleCloseError.message };
  }

  const tipoControl = inferirTipoControlInventario(control as ControlInventarioParaCerrar);
  const categoriaMacro = control.categoria_macro as string | null;
  const sucursalNum = Number(control.sucursal_id);

  if (esTipoDiario(tipoControl) && categoriaMacro && Number.isFinite(sucursalNum)) {
    const fechaControl = String(control.fecha_inicio).slice(0, 10);
    const macroBase = esCategoriaMacroSinPadron(categoriaMacro)
      ? CATEGORIA_MACRO_SIN_PADRON
      : categoriaMacro;
    const esDrogueria = await esSucursalDrogueria(admin, sucursalNum);

    let trimestre: string | null = null;

    if (esDrogueria) {
      const trDro = await obtenerTrimestreVigenteDrogueria(admin, fechaControl, macroBase);
      trimestre = trDro?.trimestre ?? null;
    } else {
      const { data: trRows, error: trError } = await filtrarQueryBaseProductosPorMacro(
        admin
          .from('base_productos')
          .select('trimestre')
          .eq('idsucursal', sucursalNum)
          .lte('fechainicio', fechaControl)
          .gte('fechafin', fechaControl)
          .limit(1),
        macroBase
      );

      if (!trError && trRows && trRows.length > 0) {
        trimestre = (trRows[0] as { trimestre: string }).trimestre;
      }
    }

    if (trimestre) {
      const { data: detRows, error: detError } = await admin
        .from('controles_inventario_detalle')
        .select('producto_id_sistema, stock_real_cajas, stock_real_unidades')
        .eq('control_id', controlId);

      if (!detError && detRows && detRows.length > 0) {
        const idProductos = Array.from(
          new Set(
            detRows
              .filter(
                (d: { stock_real_cajas: number | null; stock_real_unidades: number | null }) =>
                  d.stock_real_cajas != null || d.stock_real_unidades != null
              )
              .map((d: { producto_id_sistema: string }) => Number(d.producto_id_sistema))
              .filter((n: number) => !Number.isNaN(n))
          )
        ) as number[];

        if (idProductos.length > 0) {
          if (esDrogueria) {
            await incrementarVecesInventariadoDrogueria(admin, trimestre, idProductos);
          } else {
            const { error: rpcError } = await admin.rpc('incrementar_veces_inventariado', {
              p_sucursal_id: sucursalNum,
              p_categoria_macro: categoriaMacro,
              p_trimestre: trimestre,
              p_id_productos: idProductos,
            });

            if (rpcError) {
              console.error('Error al incrementar vecesInventariado en base_productos:', rpcError);
            }
          }
        }
      }
    }
  }

  return { ok: true, controlId, fechaCierre, lineasConDiferencia };
}
