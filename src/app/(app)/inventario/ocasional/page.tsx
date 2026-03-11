'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';

export default function NuevoInventarioOcasionalPage() {
  const router = useRouter();
  const [descripcion, setDescripcion] = useState('Inventario ocasional');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCrear() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/inventario/ocasional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: descripcion.trim() || 'Inventario ocasional' }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al crear inventario ocasional');
        return;
      }
      const id = json.data?.id;
      if (id) {
        router.replace(`/inventario/${id}`);
      } else {
        router.push('/dashboard');
      }
    } catch {
      setError('Error al crear inventario ocasional');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-lg font-semibold text-gray-900">
          Nuevo inventario ocasional
        </h1>
        <p className="mb-4 text-sm text-gray-600">
          Ingresá una descripción para identificar este inventario ocasional.
        </p>
        <Input
          label="Descripción"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Inventario ocasional"
        />
        {error && (
          <p className="mt-3 text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="mt-6 flex items-center justify-between gap-3">
          <Link href="/dashboard">
            <Button variant="outline" size="sm">
              Cancelar
            </Button>
          </Link>
          <Button size="sm" onClick={handleCrear} loading={loading}>
            Crear inventario
          </Button>
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

