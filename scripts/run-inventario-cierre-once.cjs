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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
