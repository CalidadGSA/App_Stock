'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Package, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type SucursalOption = { id: string; nombre: string };

export default function LoginPage() {
  const router = useRouter();
  const [sucursales, setSucursales] = useState<SucursalOption[]>([]);
  const [operador, setOperador] = useState('');
  const [codigo, setCodigo] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [sucursalPassword, setSucursalPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        setError(data.error || 'Operador o código incorrectos');
        return;
      }

      if (data.sucursal_set) {
        router.push('/dashboard');
      } else {
        router.push('/sucursal');
      }
      router.refresh();
    } catch {
      setError('Error inesperado. Intentá de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-600 shadow-lg">
          <Package className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">GestiónStock</h1>
        <p className="mt-1 text-sm text-gray-500">Control de inventario y vencimientos</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
        <h2 className="mb-6 text-lg font-semibold text-gray-800">Iniciar sesión</h2>

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

          <Input
            label="Código"
            type="number"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="Código numérico"
            autoComplete="off"
            required
            min={1}
          />

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Sucursal</label>
            <select
              value={sucursalId}
              onChange={(e) => setSucursalId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900
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
            <label className="text-sm font-medium text-gray-700">Contraseña de sucursal</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={sucursalPassword}
                onChange={(e) => setSucursalPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="off"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 pr-10 text-gray-900
                  placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
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

          <Button type="submit" size="lg" loading={loading} className="mt-2 w-full">
            Ingresar
          </Button>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        Contactá a tu administrador si no podés acceder
      </p>
    </div>
  );
}
