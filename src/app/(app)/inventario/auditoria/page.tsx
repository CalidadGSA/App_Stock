'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import Link from 'next/link';

export default function NuevaAuditoriaInventarioPage() {
  const router = useRouter();
  const [descripcion, setDescripcion] = useState('Auditoría de inventario');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleCrear() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/inventario/auditoria', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: descripcion.trim() || 'Auditoría de inventario' }),
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
    <div className="flex flex-col items-center justify-center py-16">
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-lg font-semibold text-gray-900">
          Nueva auditoría de inventario
        </h1>
        <p className="mb-4 text-sm text-gray-600">
          Ingresá una descripción para identificar esta auditoría.
        </p>
        <Input
          label="Descripción"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Auditoría de inventario"
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
            Crear auditoría
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

