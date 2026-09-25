/**
 * Lista productos FARMA en base_productos (sucursal + trimestre vigente)
 * que el inventario diario NO trae por conflicto/ausencia de padrón
 * (filtrarIdsSinConflictoMacroPadron).
 *
 * Uso: node --import tsx scripts/listar-farma-excluidos-padron.cjs [sucursalId]
 */
require('../src/load-env');

const { createClient } = require('@supabase/supabase-js');

function fechaHoyArgentinaYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function fetchAllBaseFarma(admin, sucursalId, trimestre) {
  const pageSize = 1000;
  let from = 0;
  const all = [];
  for (;;) {
    const { data, error } = await admin
      .from('base_productos')
      .select('idproducto, orden, vecesinventariado, categoriamacro')
      .eq('idsucursal', sucursalId)
      .eq('trimestre', trimestre)
      .ilike('categoriamacro', 'FARMA')
      .order('orden', { ascending: true })
      .order('idproducto', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function main() {
  const sucursalId = parseInt(process.argv[2] || '5', 10);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const {
    filtrarIdsSinConflictoMacroPadron,
  } = await import('../src/lib/padron-productos-lookup.ts');
  const { getPadronPorProductos, isPadronDatabaseConfigured } = await import(
    '../src/lib/padron-final-db.ts'
  );
  const { macroDesdeProveedorMarrone } = await import(
    '../src/lib/vencimientos-drogueria-lab.ts'
  );

  if (!isPadronDatabaseConfigured()) {
    console.error('Padrón no configurado (PADRON_DB_*)');
    process.exit(1);
  }

  const admin = createClient(url, key);
  const hoy = fechaHoyArgentinaYmd();

  const { data: trRows, error: trErr } = await admin
    .from('base_productos')
    .select('trimestre, fechainicio, fechafin')
    .eq('idsucursal', sucursalId)
    .ilike('categoriamacro', 'FARMA')
    .lte('fechainicio', hoy)
    .gte('fechafin', hoy)
    .limit(1);
  if (trErr) throw trErr;

  const trimestre = trRows?.[0]?.trimestre;
  if (!trimestre) {
    console.error(`No hay trimestre FARMA vigente para sucursal ${sucursalId} (hoy ${hoy})`);
    process.exit(1);
  }

  console.error(`Sucursal ${sucursalId} | trimestre ${trimestre} | hoy ${hoy}`);

  const base = await fetchAllBaseFarma(admin, sucursalId, trimestre);
  const ids = base.map((r) => Number(r.idproducto)).filter((n) => Number.isFinite(n));
  console.error(`Total FARMA en base: ${ids.length}`);

  const validos = await filtrarIdsSinConflictoMacroPadron(ids, 'FARMA');
  const validSet = new Set(validos);
  const excluidos = ids.filter((id) => !validSet.has(id));
  console.error(`Pasan filtro padrón: ${validos.length}`);
  console.error(`Excluidos (no los trae el diario): ${excluidos.length}`);

  const padron = await getPadronPorProductos(excluidos.map(String));

  const lines = [
    [
      'idproducto',
      'orden',
      'vecesinventariado',
      'en_padron',
      'proveedormarrone',
      'macro_proveedor',
      'cat_macro',
      'descripcion',
      'motivo',
    ].join(';'),
  ];

  const byId = new Map(base.map((r) => [Number(r.idproducto), r]));
  for (const id of excluidos) {
    const row = byId.get(id);
    const p = padron.get(String(id));
    let motivo = 'sin_padron';
    let pm = '';
    let macroPm = '';
    let cat = '';
    let desc = '';
    if (p) {
      pm = String(p.proveedormarrone ?? '');
      macroPm = String(macroDesdeProveedorMarrone(p.proveedormarrone) ?? '');
      cat = String(p.cat_macro ?? '');
      desc = String(p.producto ?? p.descripcion ?? '').replace(/;/g, ',');
      if (!macroPm) motivo = 'proveedor_sin_macro_farma';
      else if (macroPm !== 'FARMA') motivo = `macro_es_${macroPm}`;
      else motivo = 'otro';
    }
    lines.push(
      [
        id,
        row?.orden ?? '',
        row?.vecesinventariado ?? '',
        p ? '1' : '0',
        pm.replace(/;/g, ','),
        macroPm,
        cat.replace(/;/g, ','),
        desc,
        motivo,
      ].join(';')
    );
  }

  console.log(lines.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
