export default function LoginPage() {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
          <img src="/logogsa800.png" alt="Logo" className="h-16 w-16 object-contain" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">GestiónStock</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">Control de inventario y vencimientos</p>
      </div>

      <div className="rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-8 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold text-amber-900 dark:text-amber-200">
          Login deshabilitado
        </h2>
        <p className="text-sm text-amber-800 dark:text-amber-100">
          Esta aplicacion migro a{' '}
          <a
            href="https://stock.farmagsa.com.ar/login"
            className="font-semibold underline underline-offset-2 hover:opacity-90"
          >
            https://stock.farmagsa.com.ar/login
          </a>
          .
        </p>
        <p className="mt-3 text-sm text-amber-900 dark:text-amber-100">
          Hacer click{' '}
          <a
            href="https://stock.farmagsa.com.ar/login"
            className="font-semibold underline underline-offset-2 hover:opacity-90"
          >
            aca
          </a>{' '}
          para acceder.
        </p>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-300">
        Si tenes problemas para entrar, contacta a tu administrador.
      </p>
    </div>
  );
}
