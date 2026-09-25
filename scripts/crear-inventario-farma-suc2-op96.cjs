/**
 * Inventario diario FARMA forzado — sucursal 2, operador 96.
 * Uso: node --import tsx scripts/crear-inventario-farma-suc2-op96.cjs
 */
require('../src/load-env');

const { createClient } = require('@supabase/supabase-js');

const SUCURSAL_ID = 2;
const OPERADOR_ID = 96;
const CATEGORIA = 'FARMA';
const TRIMESTRE = 'Q32026';

const PRODUCTO_IDS = [
  3003733916, 3003733920, 3003733915, 3003733918, 3003733919, 3003733917,
  3003734066, 3003734067, 3003734068, 3003734069, 2049800054, 2049800055,
  1049800260, 1049800265, 1049800256, 2090600025, 3003720260, 3003729837,
  3003717754, 3003718783, 3003716515, 3003716514, 3003716549, 3003716551,
  2019300010, 2019300011, 3003722605, 3003722607, 3003701232, 3003722608,
  3003718565, 3003702045, 3003703556, 3003733908, 2046600066, 3003718558,
  3003705847, 3003705846, 3003732214, 3003733987, 3003733934, 3003716060,
  3003715784, 3003715786, 3003715785, 3003733879, 1080600054, 1066500120,
  3003733979, 3003733976, 2090300001, 2090300002, 3003733795, 3003733794,
  3003734141, 3003734139, 3003734140, 3003734142, 3003734143, 3003734144,
  3003734145, 3003734146,
];

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan credenciales Supabase');
    process.exit(1);
  }

  const admin = createClient(url, key);
  const { getFichasInventarioDiario } = await import('../src/lib/padron-productos-lookup.ts');

  const { data: op } = await admin
    .from('operadores')
    .select('idoperador')
    .eq('idoperador', OPERADOR_ID)
    .maybeSingle();
  if (!op) {
    console.error('Operador no encontrado:', OPERADOR_ID);
    process.exit(1);
  }

  const { data: suc } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, activa')
    .eq('sucursal', SUCURSAL_ID)
    .maybeSingle();
  if (!suc?.activa) {
    console.error('Sucursal no disponible:', SUCURSAL_ID);
    process.exit(1);
  }

  const ids = Array.from(new Set(PRODUCTO_IDS));
  const descripcion = `FARMA forzados Q32026 — excluidos/remanentes (${ids.length} productos)`;

  console.log(
    JSON.stringify({
      sucursal: suc.nombrefantasia,
      operador: OPERADOR_ID,
      total: ids.length,
    })
  );

  const { data: control, error: createError } = await admin
    .from('controles_inventario')
    .insert({
      sucursal_id: SUCURSAL_ID,
      usuario_id: OPERADOR_ID,
      origen: 'Sucursal',
      tipo: 'diario',
      categoria_macro: CATEGORIA,
      descripcion,
      estado: 'en_progreso',
    })
    .select('id, descripcion')
    .single();

  if (createError || !control) {
    console.error('Error creando control:', createError?.message);
    process.exit(1);
  }

  try {
    const fichas = await getFichasInventarioDiario(admin, ids, {
      sinPadron: true,
      drogueria: false,
      trimestre: TRIMESTRE,
    });

    const stubs = fichas.filter((f) => /^Producto \d+$/.test(String(f.descripcion ?? '')));
    if (stubs.length > 0) {
      const stubIds = stubs.map((f) => Number(f.producto_id_sistema));
      for (const lote of chunk(stubIds, 400)) {
        const { data: meds } = await admin
          .from('medicamentos')
          .select('codplex, codebar, producto, presentaci')
          .in('codplex', lote);
        const byId = new Map((meds ?? []).map((m) => [String(m.codplex), m]));
        for (const f of fichas) {
          const m = byId.get(String(f.producto_id_sistema));
          if (!m) continue;
          if (/^Producto \d+$/.test(String(f.descripcion ?? ''))) {
            f.descripcion = String(m.producto ?? '').trim() || f.descripcion;
            f.codigo_barras = f.codigo_barras ?? m.codebar ?? null;
            f.presentacion = f.presentacion ?? m.presentaci ?? null;
          }
        }
      }
    }

    const filas = fichas.map((f) => ({
      control_id: control.id,
      producto_id_sistema: f.producto_id_sistema,
      codigo_barras: f.codigo_barras,
      descripcion: f.descripcion || `Producto ${f.producto_id_sistema}`,
      presentacion: f.presentacion,
      laboratorio: f.laboratorio,
      sector: null,
      modulo: null,
      fila: null,
      posicion: null,
      stock_sistema: 0,
      stock_sist_cajas: null,
      stock_sist_unidades: null,
      stock_real_cajas: null,
      stock_real_unidades: null,
      stock_real: 0,
    }));

    for (const lote of chunk(filas, 200)) {
      const { error } = await admin.from('controles_inventario_detalle').insert(lote);
      if (error) throw new Error(error.message);
    }

    const { count } = await admin
      .from('controles_inventario_detalle')
      .select('*', { count: 'exact', head: true })
      .eq('control_id', control.id);

    console.log(
      JSON.stringify(
        {
          ok: true,
          control_id: control.id,
          sucursal_id: SUCURSAL_ID,
          sucursal: suc.nombrefantasia,
          usuario_id: OPERADOR_ID,
          solicitados: ids.length,
          cargados: count ?? filas.length,
          url_path: `/inventario/${control.id}`,
          descripcion,
        },
        null,
        2
      )
    );
  } catch (e) {
    console.error('Fallo; borrando control…', e.message || e);
    await admin.from('controles_inventario').delete().eq('id', control.id);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
