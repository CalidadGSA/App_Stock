'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function NuevaAuditoriaInventarioPage() {
  const router = useRouter();
  const [descripcion, setDescripcion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCrear(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/inventario/auditoria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: descripcion.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al crear auditoría de inventario');
        return;
      }
      const id = json.data?.id;
      if (id) {
        router.replace(`/inventario/${id}`);
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('Error al crear auditoría de inventario');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Nueva auditoría de inventario</h1>
          <p className="text-sm text-gray-500">
            Creá una auditoría para revisar productos puntuales.
          </p>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Auditoría de inventario</h2>
          <p className="text-xs text-gray-500 mt-1">
            Ingresá una descripción (opcional) para identificar esta auditoría.
          </p>
        </div>
        <div className="px-6 py-5">
          <form onSubmit={handleCrear} className="flex flex-col gap-4">
            <Input
              label="Descripción (opcional)"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: Auditoría psicotrópicos"
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" loading={loading} className="mt-2 w-full">
              Crear auditoría y comenzar escaneo
            </Button>
          </form>
        </div>
      </div>

      {loading && (
        <div className="mt-6">
          <PageSpinner />
        </div>
      )}
    </div>
  );
}

