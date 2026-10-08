/**
 * Valoriza los controles de inventario ya cerrados que todavía no tienen los montos guardados
 * (columnas de la migración 033). A partir de ahora cada cierre se valoriza solo; esto es para
 * el histórico.
 *
 * Importa módulos TypeScript con alias `@/`, así que va con el loader de tsx:
 *
 *   npm run valorizar:controles                                → todos los pendientes
 *   node --import tsx scripts/valorizar-controles-cerrados.cjs --desde=2026-07-01
 *   node --import tsx scripts/valorizar-controles-cerrados.cjs --limite=200
 *   node --import tsx scripts/valorizar-controles-cerrados.cjs --rehacer
 */

require('../src/load-env');

function arg(nombre, porDefecto) {
  const found = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return found ? found.split('=')[1] : porDefecto;
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { calcularValorizacionControl } = await import(
    '../src/lib/inventario/valorizar-control.ts'
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan credenciales de Supabase');
    process.exit(1);
  }

  const admin = createClient(url, key);
  const desde = arg('desde', null);
  const limite = parseInt(arg('limite', '0'), 10) || 0;
  const rehacer = process.argv.includes('--rehacer');

  // PostgREST devuelve como máximo 1000 filas por consulta, así que se pide por tandas.
  // Sin `--rehacer` cada control deja de estar pendiente al valorizarse, y el bucle termina solo.
  const TANDA = 1000;

  async function siguienteTanda(offset) {
    let q = admin
      .from('controles_inventario')
      .select('id, sucursal_id, fecha_fin')
      .eq('estado', 'cerrado')
      .not('fecha_fin', 'is', null)
      .order('fecha_fin', { ascending: false });

    if (!rehacer) q = q.is('valorizado_at', null);
    if (desde) q = q.gte('fecha_fin', `${desde}T00:00:00-03:00`);
    q = q.range(offset, offset + TANDA - 1);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  let ok = 0;
  let fallos = 0;
  let totalControlado = 0;
  let totalFaltante = 0;
  let procesados = 0;
  let offset = 0;

  while (true) {
    let tanda;
    try {
      // Al valorizar, el control sale del filtro: sin `--rehacer` siempre se pide desde 0.
      tanda = await siguienteTanda(rehacer ? offset : 0);
    } catch (e) {
      console.error('No se pudieron listar los controles:', e instanceof Error ? e.message : e);
      process.exit(1);
    }

    if (tanda.length === 0) break;
    if (procesados === 0) console.log(`Primera tanda: ${tanda.length} controles`);

    for (const c of tanda) {
      if (limite > 0 && procesados >= limite) break;
      procesados += 1;
      try {
        const v = await calcularValorizacionControl(admin, c.id);
        const { error: upErr } = await admin
          .from('controles_inventario')
          .update({ ...v, valorizado_at: new Date().toISOString() })
          .eq('id', c.id);

        if (upErr) throw new Error(upErr.message);

        ok += 1;
        totalControlado += v.stock_controlado_costo;
        totalFaltante += v.dif_negativa_costo;

        if (procesados % 100 === 0) {
          console.log(`  ${procesados} procesados · ok ${ok} · fallos ${fallos}`);
        }
      } catch (e) {
        fallos += 1;
        console.error(`  control ${c.id}:`, e instanceof Error ? e.message : e);
      }
    }

    if (limite > 0 && procesados >= limite) break;
    if (rehacer) {
      offset += TANDA;
      if (tanda.length < TANDA) break;
    } else if (fallos > 0 && ok === 0) {
      // Todos fallando: no tiene sentido reintentar la misma tanda para siempre.
      break;
    }
  }

  console.log(
    `\nListo: ${ok} valorizados, ${fallos} con error.\n` +
      `Stock controlado acumulado: $${totalControlado.toLocaleString('es-AR')}\n` +
      `Faltantes acumulados: $${totalFaltante.toLocaleString('es-AR')}`
  );

  const { cerrarOnzePool } = await import('../src/lib/legacy-db/mysql-stock.ts');
  await cerrarOnzePool();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
