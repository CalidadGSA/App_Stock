require('../src/load-env');

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { ejecutarCierreInventariosVencidos } = await import(
    '../src/lib/inventario/cierre-inventarios-vencidos.ts'
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Faltan credenciales Supabase');
    process.exit(1);
  }

  const horas = parseInt(process.env.INVENTARIO_CIERRE_HORAS || '168', 10);
  const admin = createClient(url, key);
  const res = await ejecutarCierreInventariosVencidos(admin, {
    horasAbiertas: Number.isFinite(horas) && horas > 0 ? horas : 168,
  });

  console.log(JSON.stringify(res, null, 2));

  // Snapshot del stock valorizado (KPIs mensuales): a las 00:00 del día 1 cierra el mes anterior.
  try {
    const { tomarSnapshotStockValorizadoDiario } = await import('../src/lib/kpis/kpis-mensuales.ts');
    const { filtroSucursalesExcluidasLogin } = await import('../src/lib/sucursales/login-sucursales.ts');
    const { data: sucs, error } = await admin
      .from('sucursales')
      .select('sucursal')
      .eq('activa', true)
      .not('sucursal', 'in', filtroSucursalesExcluidasLogin());
    if (error) throw new Error(error.message);
    const ids = (sucs ?? []).map((r) => Number(r.sucursal)).filter((n) => Number.isFinite(n));
    const snap = await tomarSnapshotStockValorizadoDiario(admin, ids);
    console.log('Snapshot stock valorizado:', JSON.stringify(snap));

    // Avance de inventario del mes (KPI esperado vs real): mismo criterio de cierre de mes.
    const { tomarSnapshotAvanceConCierreDeMes } = await import(
      '../src/lib/kpis/avance-inventario.ts'
    );
    const { esSucursalDrogueriaPorId } = await import('../src/lib/sucursales/drogueria.ts');
    const { fechaHoyArgentinaYmd } = await import('../src/lib/utils.ts');
    const avance = await tomarSnapshotAvanceConCierreDeMes(
      admin,
      ids.map((id) => ({ id, esDrogueria: esSucursalDrogueriaPorId(id) })),
      fechaHoyArgentinaYmd()
    );
    console.log(
      'Snapshot avance inventario:',
      `mes en curso ${avance.mesActual} sucursales · cierre del mes anterior ${avance.mesAnterior}`
    );
  } catch (e) {
    console.error('Snapshots de KPIs fallaron:', e instanceof Error ? e.message : e);
  } finally {
    // El pool MySQL (keep-alive) mantendría vivo el proceso y el cron acumularía hijos.
    const { cerrarOnzePool } = await import('../src/lib/legacy-db/mysql-stock.ts');
    await cerrarOnzePool();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
