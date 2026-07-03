/**
 * Devolución masiva «para devolver» en todas las sucursales.
 *
 * Por defecto es dry-run (solo cuenta elegibles). Para aplicar:
 *   npm run devolver:masivo -- --apply
 *
 * Opciones:
 *   --apply              Ejecuta en BD (crea devoluciones + marca devuelto=1)
 *   --sucursal=12        Solo una sucursal (repetible)
 *   --hoy=2026-06-16     Fecha de referencia (Argentina YYYY-MM-DD)
 */
require('../src/load-env');

function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const hoyArg = argv.find((a) => a.startsWith('--hoy='));
  const hoyYmd = hoyArg ? hoyArg.slice('--hoy='.length).trim() : undefined;
  const sucursalIds = argv
    .filter((a) => a.startsWith('--sucursal='))
    .map((a) => parseInt(a.slice('--sucursal='.length), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return {
    dryRun: !apply,
    hoyYmd,
    sucursalIds: sucursalIds.length > 0 ? sucursalIds : undefined,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const { ejecutarDevolucionMasivaTodasSucursales } = await import(
    '../src/lib/vencimientos/devolver-para-devolver-masivo.ts'
  );

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('=== Devolución masiva «para devolver» ===');
  console.log('Modo:', opts.dryRun ? 'DRY-RUN (sin cambios)' : 'APLICAR');
  if (opts.hoyYmd) console.log('Fecha referencia:', opts.hoyYmd);
  if (opts.sucursalIds?.length) console.log('Sucursales:', opts.sucursalIds.join(', '));
  console.log('');

  const resultado = await ejecutarDevolucionMasivaTodasSucursales(admin, opts);

  for (const s of resultado.sucursales) {
    const base = `${s.sucursal_id} ${s.nombre}: ${s.elegibles} elegible(s)`;
    if (s.error) {
      console.log(`  ✗ ${base} — ERROR: ${s.error}`);
    } else if (s.devolucion_id) {
      console.log(`  ✓ ${base} → devolución ${s.devolucion_id}`);
    } else if (s.elegibles > 0) {
      console.log(`  · ${base}`);
    }
  }

  console.log('');
  console.log(`Fecha: ${resultado.hoy}`);
  console.log(`Total elegibles: ${resultado.total_elegibles}`);
  if (!resultado.dry_run) {
    console.log(`Total devueltos: ${resultado.total_devueltos}`);
    console.log(`Usuario devolución: ${resultado.usuario_id}`);
  } else if (resultado.total_elegibles > 0) {
    console.log('Para aplicar: npm run devolver:masivo -- --apply');
  }

  const huboError = resultado.sucursales.some((s) => s.error);
  process.exit(huboError ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
