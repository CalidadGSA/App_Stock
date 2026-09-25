/**
 * Crea 3 inventarios diarios BIENESTAR en sucursal 23 (operador 44)
 * con los productos remanentes (vecesinventariado=0) repartidos en lotes parejos.
 *
 * Uso: node --import tsx scripts/crear-inventarios-bienestar-suc23-remanentes.cjs
 */
require('../src/load-env');

const { createClient } = require('@supabase/supabase-js');

const SUCURSAL_ID = 23;
const OPERADOR_ID = 44;
const CATEGORIA = 'BIENESTAR';
const TRIMESTRE = 'Q32026';
const LOTES = 3;

const PRODUCTO_IDS = [
  3003731628, 2071500192, 2071500311, 2071500223, 2071500004, 2071500007, 2071500288,
  2071500289, 2071500290, 2071500078, 2071500266, 2071500490, 3003728190, 3003727610,
  3003731138, 3003705063, 2000900180, 2000900187, 2000900188, 2000900060, 2002100094,
  2002100096, 2002100181, 2002100182, 2002100111, 2002100112, 2002100103, 2002100081,
  2002100105, 2002100106, 2002100114, 2002100086, 2002100087, 2002100174, 3003728164,
  3003723598, 3003722335, 1004500086, 1004500087, 1004500089, 1004500090, 1004600161,
  1004600162, 3003730742, 3003731643, 3003731645, 3003731644, 1015700177, 1015700178,
  1015700179, 1015700180, 2015700037, 2015700020, 2015700010, 2015700012, 1015700196,
  1015700166, 1015700167, 1015700168, 1015700169, 1015700170, 1057700008, 2085100015,
  3003722390, 3003731723, 3003731724, 3003730871, 2010300101, 2010300108, 2010300106,
  2010300204, 2010300201, 2010300202, 3003705939, 3003705598, 2038100407, 2090600007,
  2090600008, 2090600001, 2010700067, 2090600002, 2010700045, 1010700143, 2010700082,
  2010700043, 2010700044, 2090600011, 2010700037, 2090600013, 2010700001, 2090600019,
  2010700079, 2010700038, 2090600021, 2010700039, 2010709301, 2010700069, 2010700008,
  2010700083, 2090600006, 2015700002, 2015700005, 2015700003, 1015700032, 2015700004,
  1015708302, 1015710701, 2015700024, 1015710802, 1015710801, 2015700017, 2015700011,
  2049800016, 1049800180, 1049800061, 3003731655, 3003731658, 3003731659, 3003731654,
  3003731657, 3003731656, 1076300017, 1076300009, 1076300015, 2071400000, 2071400001,
  2071400002, 2071400003, 2071400004, 2019300001, 3003707100, 3003717976, 3003707105,
  3003723097, 3003723095, 3003730828, 3003719618, 3003733725, 3003733041, 3003732815,
  3003719605, 3003714864, 3003730016, 3003731143, 3003721398, 3003721400, 3003721399,
  3003728855, 3003732054, 3003731894, 3003729565, 3003732141, 3003730005, 3003732349,
  3003731125, 3003731007, 3003730858, 2002100126, 2002100158, 2002100159, 2002100128,
  1002100366, 1002300480, 1065400049, 1065400030, 1065400064, 1065400076, 1065400055,
  1065400047, 1065400088, 1065400057, 1008001801, 2007900014, 2049800023, 2049800011,
  2049800008, 2049800009, 2049800012, 1007900435, 2049800041, 1049800207, 1049800232,
  2049800042, 2049800037, 2049800006, 2049800017, 1051800325, 1009200108, 1009500177,
  1078800058, 1027000035, 1027000044, 2027000021, 1030300006, 2030300003, 1071500133,
  1071500126, 1071500128, 2010700084, 2010700087, 2010700088, 2022800701, 3003715927,
  2049800036, 2049800031, 2049800032, 2015700008, 2015700007, 2016400013, 2016401001,
  2016400007, 2080600001, 2080600002, 2016400202, 3003731158, 3003727825, 3003725025,
  3003714774, 2018400002, 3003707101, 3003707106, 2018400005, 3003717975, 3003727754,
  2015700026, 2015700027, 2027000008, 1027100006, 2027101902, 2046600060, 1046600162,
  1088100000, 1087100001, 1071900117, 1020300427, 1020700071, 2022900019, 2022600001,
  2022600003, 2022600002, 1022600097, 1049800060, 1049800062, 1065400058, 1085900021,
  1085900022, 2000900155, 2000900156, 2000900157, 2000900201, 2000900153, 2000900208,
  2000900193, 2000900096, 2000900171, 2000900172, 2000900100, 2000900066, 2000900176,
  2000900177, 2000900081, 2000900082, 2000900068, 1000900077, 2000900213, 2000900214,
  2000900215, 2000900097, 2000900154, 2000900190, 2000900090, 2000900091, 2000900083,
  2000900210, 2000900197, 2000900019, 2000900023, 2000900211, 2000900198, 2000900117,
  2000900020, 2000900038, 2000900037, 1000906301, 2000900024, 1000900068, 2000900140,
  2000900194, 2000900159, 2000900160, 2000900143, 2000900144, 2000900145, 2000900146,
  2000900205, 2000900147, 2000900148, 2000900149, 2000900185, 2000900186, 2000900150,
  2000900151, 2000900206, 2000900162, 2000900182, 2000900071, 2000900072, 2000900141,
  2000900046, 2000900054, 2000900130, 2000900098, 2000900033, 2000900011, 2000900028,
  2000900065, 2000900120, 2000900099, 2000900200, 2000900189, 2000900164, 2000900179,
  2000900092, 1000902406, 1000902404, 1000902402, 1000902403, 1000900083, 2000900207,
  2002100135, 1002100802, 1002100803, 1002100801, 2002100122, 2002100031, 1002100229,
  2002100129, 2002100131, 2002100130, 1002100162, 2002100136, 2002100184, 1004600166,
  2004600007, 1049800169, 2008400401, 2008400008, 2008400010, 2008400101, 2008400102,
  1015706201, 1015706202, 1015700000, 1016401601, 1044000101, 1015805701, 1011000063,
];

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function splitEven(ids, parts) {
  const n = ids.length;
  const base = Math.floor(n / parts);
  const rem = n % parts;
  const groups = [];
  let idx = 0;
  for (let p = 0; p < parts; p++) {
    const size = base + (p < rem ? 1 : 0);
    groups.push(ids.slice(idx, idx + size));
    idx += size;
  }
  return groups;
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
  const groups = splitEven(ids, LOTES);
  console.log(
    JSON.stringify({
      sucursal: suc.nombrefantasia,
      operador: OPERADOR_ID,
      total: ids.length,
      sizes: groups.map((g) => g.length),
    })
  );

  const created = [];
  const createdIds = [];

  try {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const descripcion = `BIENESTAR remanentes Q32026 — lote ${i + 1}/${LOTES} (${group.length} productos)`;

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
        throw new Error(createError?.message ?? 'Error creando control');
      }
      createdIds.push(control.id);

      const fichas = await getFichasInventarioDiario(admin, group, {
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

      created.push({
        lote: i + 1,
        control_id: control.id,
        productos: count ?? filas.length,
        url_path: `/inventario/${control.id}`,
        descripcion,
      });
    }
  } catch (e) {
    console.error('Fallo; revirtiendo controles creados…', e.message || e);
    for (const id of createdIds) {
      await admin.from('controles_inventario').delete().eq('id', id);
    }
    process.exit(1);
  }

  console.log(JSON.stringify({ ok: true, created }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
