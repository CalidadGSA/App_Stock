'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ClipboardList, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function NuevoInventarioPage() {
  const router = useRouter();
  const [descripcion, setDescripcion] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);

    try {
      const res = await fetch('/api/inventario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ descripcion: descripcion.trim() || undefined }),
      });
      const json = await res.json() as { data?: { id: string }; error?: string };

      if (!res.ok) { setError(json.error ?? 'Error al crear control'); return; }

      router.push(`/inventario/${json.data!.id}`);
    } catch {
      setError('Error inesperado. Intentá de nuevo.');
    } finally {
      setCreating(false);
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
          <h1 className="text-xl font-bold text-gray-900">Nuevo control de inventario</h1>
          <p className="text-sm text-gray-500">Creá el control y empezá a escanear productos</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
              <ClipboardList className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Control de stock</p>
              <p className="text-xs text-gray-500">Registrá las diferencias entre sistema y realidad</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCrear} className="flex flex-col gap-4">
            <Input
              label="Descripción (opcional)"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Ej: Medicamentos, Perfumeria..."
              hint="Podés agregar una descripción para identificar este inventario"
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" loading={creating} className="mt-2">
              Crear control y comenzar escaneo
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
