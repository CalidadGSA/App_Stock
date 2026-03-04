'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ChevronRight, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Sucursal } from '@/types';

export default function SucursalPage() {
  const router = useRouter();
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Sucursal | null>(null);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/sucursales')
      .then(r => r.json())
      .then(({ data }) => { setSucursales(data ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleValidar(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError('');
    setValidating(true);

    try {
      const res = await fetch(`/api/sucursales/${selected.id}/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const json = await res.json() as { error?: string };

      if (!res.ok) {
        setError(json.error ?? 'Contraseña incorrecta');
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Error inesperado. Intentá de nuevo.');
    } finally {
      setValidating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
          <p className="mt-3 text-sm text-gray-600">Cargando sucursales...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-8">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg">
            <Building2 className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            {selected ? 'Contraseña de sucursal' : 'Seleccionar sucursal'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {selected
              ? `Ingresá la contraseña para acceder a ${selected.nombre}`
              : 'Elegí la sucursal en la que vas a trabajar hoy'
            }
          </p>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* Lista de sucursales */}
          {!selected && (
            <div className="flex flex-col gap-2">
              {sucursales.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-500">
                  No tenés sucursales asignadas. Contactá a tu administrador.
                </p>
              ) : (
                sucursales.map(suc => (
                  <button
                    key={suc.id}
                    onClick={() => { setSelected(suc); setError(''); setPassword(''); }}
                    className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50
                      px-4 py-3.5 text-left transition-colors hover:border-blue-300 hover:bg-blue-50 active:bg-blue-100"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{suc.nombre}</p>
                      <p className="text-xs text-gray-500">{suc.codigo_interno}{suc.ubicacion ? ` · ${suc.ubicacion}` : ''}</p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400 shrink-0" />
                  </button>
                ))
              )}
            </div>
          )}

          {/* Formulario de contraseña de sucursal */}
          {selected && (
            <form onSubmit={handleValidar} className="flex flex-col gap-4">
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
                <p className="font-semibold text-blue-900">{selected.nombre}</p>
                <p className="text-xs text-blue-600">{selected.codigo_interno}</p>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Contraseña de sucursal</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoFocus
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

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => { setSelected(null); setError(''); setPassword(''); }}
                  className="flex items-center gap-1"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Volver
                </Button>
                <Button type="submit" size="lg" loading={validating} className="flex-1">
                  Ingresar
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
