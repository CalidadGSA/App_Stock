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
  const [categoriaMacro, setCategoriaMacro] = useState<'FARMA' | 'BIENESTAR' | 'PSICOTROPICOS' | ''>('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!categoriaMacro) {
      setError('Seleccioná una categoría macro para crear el inventario diario.');
      return;
    }

    setCreating(true);

    try {
      const res = await fetch('/api/inventario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          descripcion: descripcion.trim() || undefined,
          categoria_macro: categoriaMacro || undefined,
        }),
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
          <h1 className="text-xl font-bold text-gray-900">Nuevo inventario diario</h1>
          <p className="text-sm text-gray-500">Creá el inventario diario y empezá a escanear productos</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100">
              <ClipboardList className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Inventario diario</p>
              <p className="text-xs text-gray-500">Registrá las diferencias entre sistema y realidad para el inventario diario</p>
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
              hint="Podés agregar una descripción para identificar este inventario diario"
            />

            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-800">
                Categoría macro
              </label>
              <select
                value={categoriaMacro}
                onChange={(e) => setCategoriaMacro(e.target.value as typeof categoriaMacro)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                  focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Seleccionar categoría...</option>
                <option value="FARMA">FARMA</option>
                <option value="BIENESTAR">BIENESTAR</option>
                <option value="PSICOTROPICOS">PSICOTROPICOS</option>
              </select>
              <p className="text-xs text-gray-500">
                Si seleccionás una categoría macro, este inventario diario quedará asociado a ese grupo de productos.
              </p>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" loading={creating} className="mt-2">
              Crear inventario diario y comenzar escaneo
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
