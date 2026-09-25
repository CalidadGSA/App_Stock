/**
 * Crea un inventario diario FARMA en sucursal 5 con IDs fijos (excluidos del cupo
 * por filtro padrón), asignado a operador 140.
 *
 * Uso: node --import tsx scripts/crear-inventario-farma-forzado-suc5.cjs
 */
require('../src/load-env');

const { createClient } = require('@supabase/supabase-js');

const SUCURSAL_ID = 5;
const OPERADOR_ID = 140;
const CATEGORIA = 'FARMA';
const TRIMESTRE = 'Q32026';

/** Lista aportada por el usuario (74 productos). */
const PRODUCTO_IDS = [
  3003733840, 3003733842, 3003733841, 3003733835, 3003733836, 3003733837,
  3003733838, 3003733839, 3003733965, 3003733964, 3003733962, 3003733966,
  3003733963, 3003733972, 3003733969, 3003733970, 3003733968, 3003733973,
  3003733974, 3003733971, 3003733967, 3003733827, 3003733797, 3003733798,
  3003733799, 3003733801, 3003733811, 3003733802, 3003733803, 3003733804,
  3003733805, 3003733916, 3003733920, 3003733915, 3003733918, 3003733919,
  3003733917, 3003733806, 3003733807, 3003733812, 3003733810, 3003733954,
  3003733813, 3003733953, 3003733952, 3003733950, 3003733951, 3003733825,
  2087100012, 2071900083, 2071900089, 2071900111, 3003716985, 3003718258,
  3003718558, 3003705847, 3003705846, 3003733930, 3003733942, 3003733935,
  3003733872, 3003733934, 3003733879, 1080600054, 3003733979, 3003733980,
  2090300002, 3003723951, 3003733938, 3003733992, 3003733795, 3003733794,
  3003733940, 3003733829,
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

  const { data: op, error: opErr } = await admin
    .from('operadores')
    .select('idoperador')
    .eq('idoperador', OPERADOR_ID)
    .maybeSingle();
  if (opErr || !op) {
    console.error('Operador 140 no encontrado', opErr?.message);
    process.exit(1);
  }

  const { data: suc, error: sucErr } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, activa')
    .eq('sucursal', SUCURSAL_ID)
    .maybeSingle();
  if (sucErr || !suc || !suc.activa) {
    console.error('Sucursal 5 no disponible', sucErr?.message);
    process.exit(1);
  }

  const ids = Array.from(new Set(PRODUCTO_IDS));
  console.log(
    `Creando inventario diario ${CATEGORIA} sucursal ${SUCURSAL_ID} (${suc.nombrefantasia}) — ${ids.length} productos — operador ${OPERADOR_ID}`
  );

  const descripcion = `FARMA forzados Q32026 — excluidos por padrón (${ids.length} productos)`;

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
    .select('id, sucursal_id, usuario_id, tipo, categoria_macro, estado, fecha_inicio, descripcion')
    .single();

  if (createError || !control) {
    console.error('Error creando control:', createError?.message);
    process.exit(1);
  }

  const controlId = control.id;
  console.log('Control creado:', controlId);

  const fichas = await getFichasInventarioDiario(admin, ids, {
    sinPadron: true,
    drogueria: false,
    trimestre: TRIMESTRE,
  });

  // Completar descripciones desde medicamentos si quedó stub
  const stubs = fichas.filter((f) => /^Producto \d+$/.test(String(f.descripcion ?? '')));
  if (stubs.length > 0) {
    const stubIds = stubs.map((f) => Number(f.producto_id_sistema));
    for (const lote of chunk(stubIds, 400)) {
      const { data: meds } = await admin
        .from('medicamentos')
        .select('codplex, codebar, producto, presentaci')
        .in('codplex', lote);
      const byId = new Map(
        (meds ?? []).map((m) => [String(m.codplex), m])
      );
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
    control_id: controlId,
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
    const { error: insertError } = await admin
      .from('controles_inventario_detalle')
      .insert(lote);
    if (insertError) {
      console.error('Error insertando detalles:', insertError.message);
      await admin.from('controles_inventario').delete().eq('id', controlId);
      process.exit(1);
    }
  }

  const { count } = await admin
    .from('controles_inventario_detalle')
    .select('*', { count: 'exact', head: true })
    .eq('control_id', controlId);

  console.log(
    JSON.stringify(
      {
        ok: true,
        control_id: controlId,
        sucursal_id: SUCURSAL_ID,
        sucursal: suc.nombrefantasia,
        usuario_id: OPERADOR_ID,
        tipo: 'diario',
        categoria_macro: CATEGORIA,
        solicitados: ids.length,
        cargados: count ?? filas.length,
        url_path: `/inventario/${controlId}`,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
