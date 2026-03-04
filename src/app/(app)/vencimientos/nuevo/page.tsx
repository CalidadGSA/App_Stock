'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { CalendarClock, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function NuevoVencimientoPage() {
  const router = useRouter();
  const [observaciones, setObservaciones] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setCreating(true);

    try {
      const res = await fetch('/api/vencimientos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ observaciones: observaciones.trim() || undefined }),
      });
      const json = await res.json() as { data?: { id: string }; error?: string };

      if (!res.ok) { setError(json.error ?? 'Error al crear control'); return; }

      router.push(`/vencimientos/${json.data!.id}`);
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
          <h1 className="text-xl font-bold text-gray-900">Nuevo control de vencimientos</h1>
          <p className="text-sm text-gray-500">Registrá fechas de vencimiento por producto</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-100">
              <CalendarClock className="h-5 w-5 text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Control de vencimientos</p>
              <p className="text-xs text-gray-500">Podés cargar múltiples fechas por producto</p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCrear} className="flex flex-col gap-4">
            <Input
              label="Observaciones (opcional)"
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              placeholder="Ej: Heladera, sector antibióticos..."
              hint="Podés agregar una nota para identificar este control"
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" loading={creating} className="mt-2 bg-indigo-600 hover:bg-indigo-700">
              Crear control y comenzar escaneo
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
