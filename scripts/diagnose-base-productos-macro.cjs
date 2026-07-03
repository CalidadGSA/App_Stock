require('../src/load-env.js');
const { createClient } = require('@supabase/supabase-js');

function fechaHoyArgentinaYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan credenciales Supabase');
    process.exit(1);
  }

  const admin = createClient(url, key);
  const hoy = fechaHoyArgentinaYmd();
  console.log('Hoy AR:', hoy);

  const { data: sucursales, error: errSuc } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia')
    .ilike('nombrefantasia', '%CENTRAL%');

  if (errSuc) {
    console.error(errSuc);
    process.exit(1);
  }

  console.log('Sucursales CENTRAL:', sucursales);

  for (const suc of sucursales ?? []) {
    const sucId = suc.sucursal;
    const { data: trRows } = await admin
      .from('base_productos')
      .select('trimestre, fechainicio, fechafin')
      .eq('idsucursal', sucId)
      .lte('fechainicio', hoy)
      .gte('fechafin', hoy)
      .limit(1);

    const trimestre = trRows?.[0]?.trimestre;
    console.log(`\n=== Sucursal ${sucId} (${suc.nombrefantasia}) trimestre vigente: ${trimestre} ===`);
    if (!trimestre) continue;

    const { count: totalAll } = await admin
      .from('base_productos')
      .select('*', { count: 'exact', head: true })
      .eq('idsucursal', sucId)
      .eq('trimestre', trimestre);
    console.log('Total filas trimestre:', totalAll);

    const macros = [
      'FARMA',
      'BIENESTAR',
      'PSICOTROPICOS',
      'PSICOTROPICO',
      'Sin padron',
      'Sin padrón',
      'SIN PADRON',
      'SIN PADRÓN',
    ];
    let sumMacros = 0;
    for (const m of macros) {
      const { count } = await admin
        .from('base_productos')
        .select('*', { count: 'exact', head: true })
        .eq('idsucursal', sucId)
        .eq('trimestre', trimestre)
        .ilike('categoriamacro', m);
      if ((count ?? 0) > 0) {
        console.log(`  ilike '${m}':`, count);
        if (['FARMA', 'BIENESTAR', 'PSICOTROPICOS'].includes(m)) sumMacros += count ?? 0;
      }
    }
    console.log('Suma FARMA+BIENESTAR+PSICOTROPICOS (ilike exacto):', sumMacros);

    // Simula obtenerProgresoPorMacroTrimestre + totalesDesdeProgresoPorMacro
    const MACROS = ['FARMA', 'BIENESTAR', 'PSICOTROPICOS'];
    let simTotal = 0;
    for (const macro of MACROS) {
      const { count } = await admin
        .from('base_productos')
        .select('*', { count: 'exact', head: true })
        .eq('idsucursal', sucId)
        .eq('trimestre', trimestre)
        .ilike('categoriamacro', macro);
      simTotal += count ?? 0;
    }
    console.log('Total simulado progreso (suma 3 macros):', simTotal);

    // Probar qué columna resuelve resolverCampoMacro (como en trimestre-base)
    const MACRO_FIELDS = ['categoriamacro', 'categoriaMacro', 'categoria_macro'];
    for (const mf of MACRO_FIELDS) {
      const { error } = await admin
        .from('base_productos')
        .select(mf)
        .eq('idsucursal', sucId)
        .eq('trimestre', trimestre)
        .limit(1);
      console.log(`  probe select ${mf}:`, error ? `ERROR ${error.message}` : 'ok');
    }

    const { count: padronLike } = await admin
      .from('base_productos')
      .select('*', { count: 'exact', head: true })
      .eq('idsucursal', sucId)
      .eq('trimestre', trimestre)
      .ilike('categoriamacro', '%padron%');
    console.log("ilike '%padron%':", padronLike);

    const distinct = new Map();
    let offset = 0;
    const page = 1000;
    while (true) {
      const { data: batch, error } = await admin
        .from('base_productos')
        .select('categoriamacro')
        .eq('idsucursal', sucId)
        .eq('trimestre', trimestre)
        .range(offset, offset + page - 1);
      if (error) {
        console.error('Error paginando:', error.message);
        break;
      }
      if (!batch?.length) break;
      for (const r of batch) {
        const k = String(r.categoriamacro ?? '(null)');
        distinct.set(k, (distinct.get(k) ?? 0) + 1);
      }
      if (batch.length < page) break;
      offset += page;
    }

    console.log('Distinct categoriamacro (conteo real):');
    [...distinct.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([k, n]) => console.log(`  ${JSON.stringify(k)}: ${n}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
