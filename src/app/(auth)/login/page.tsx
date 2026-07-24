'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type SucursalOption = { id: string; nombre: string };

function LoginForm() {
  const searchParams = useSearchParams();
  const sesionExpirada = searchParams.get('expirado') === '1';

  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [operador, setOperador] = useState('');
  const [codigo, setCodigo] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [sucursalPassword, setSucursalPassword] = useState('');
  const [showCodigo, setShowCodigo] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [maintenance, setMaintenance] = useState(false);

  useEffect(() => {
    fetch('/api/auth/sucursales')
      .then((r) => r.json())
      .then((res) => {
        const list = res.data ?? [];
        setSucursales(list);
        if (list.length === 1) setSucursalId(list[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;

    async function checkMaintenance() {
      try {
        const res = await fetch('/api/app-status', {
          cache: 'no-store',
          headers: { 'cache-control': 'no-cache' },
        });
        const data = await res.json().catch(() => ({}));
        if (!mounted) return;
        setMaintenance(Boolean(data?.maintenance));
      } catch {
        // Si falla, no bloquear por falso positivo.
      }
    }

    void checkMaintenance();
    const intervalId = window.setInterval(() => void checkMaintenance(), 10000);
    return () => {
      mounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const formComplete =
    operador.trim() !== '' &&
    codigo.trim() !== '' &&
    sucursalId !== '' &&
    sucursalPassword.trim() !== '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operador: operador.trim(),
          codigo: codigo.trim() ? parseInt(codigo, 10) : undefined,
          sucursal_id: sucursalId || undefined,
          sucursal_password: sucursalPassword || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 503 || data?.maintenance) {
          setMaintenance(true);
        }
        setError(data.error || 'Operador o código incorrectos');
        return;
      }

      if (!data.sucursal_set) {
        setError('Completá operador, código, sucursal y contraseña de sucursal.');
        return;
      }

      window.location.href = '/dashboard';
      return;
    } catch {
      setError('Error inesperado. Intentá de nuevo.');
    } finally {
      setLoading(false);
      
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 flex items-center justify-center">
          <img
            src="/logo-gsa-light.png"
            alt="GSA Farmacias"
            className="h-28 w-auto object-contain dark:hidden"
          />
          <img
            src="/logo-gsa-dark.png"
            alt="GSA Farmacias"
            className="hidden h-28 w-auto object-contain dark:block"
          />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Gestión Stock</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-300">Control de inventario y vencimientos</p>
      </div>

      <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-slate-900 p-8 shadow-sm">
        <h2 className="mb-6 text-lg font-semibold text-gray-800 dark:text-gray-100">Iniciar sesión</h2>

        {sesionExpirada && (
          <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-100">
            Tu sesión expiró. Iniciá sesión nuevamente.
          </div>
        )}

        {maintenance && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Atención: Base de datos onze_center desactualizada.
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Operador"
            type="text"
            value={operador}
            onChange={(e) => setOperador(e.target.value)}
            placeholder="Usuario"
            autoComplete="username"
            required
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Código</label>
            <div className="relative">
              <input
                type={showCodigo ? 'text' : 'password'}
                inputMode="numeric"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                placeholder="••••••"
                autoComplete="off"
                required
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2.5 pr-10 text-gray-900 dark:text-gray-100
                  placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="button"
                onClick={() => setShowCodigo(!showCodigo)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-100"
                aria-label={showCodigo ? 'Ocultar código' : 'Mostrar código'}
              >
                {showCodigo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Sucursal <span className="text-red-500">*</span></label>
            <select
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-gray-900 dark:text-gray-100
                focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">Seleccionar sucursal</option>
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-200">Contraseña de sucursal <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={sucursalPassword}
                onChange={(e) => setSucursalPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
                required
                className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-900 px-3 py-2.5 pr-10 text-gray-900 dark:text-gray-100
                  placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-100"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <Button
            type="submit"
            size="lg"
            loading={loading}
            disabled={!formComplete}
            className="mt-2 w-full"
          >
            Ingresar
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-300">
        Contactá a tu administrador si no podés acceder
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm text-center text-sm text-gray-500">Cargando…</div>}>
      <LoginForm />
    </Suspense>
  );
}
