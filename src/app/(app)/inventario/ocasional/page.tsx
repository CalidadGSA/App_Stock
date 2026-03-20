'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function NuevoInventarioOcasionalPage() {
  const router = useRouter();
  const [descripcion, setDescripcion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function crearInventario(confirmOverride = false) {
    return fetch('/api/inventario/ocasional', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descripcion: descripcion.trim() || null,
        confirm_override: confirmOverride || undefined,
      }),
    });
  }

  async function handleCrear() {
    setError('');
    setLoading(true);
    try {
      let res = await crearInventario(false);
      let json = await res.json() as {
        data?: { id: string };
        error?: string;
        warning?: string;
        requires_confirmation?: boolean;
      };

      if (!res.ok && json.requires_confirmation) {
        const confirmar = window.confirm(
          json.warning ?? 'Ya existe un inventario ocasional abierto. ¿Querés crearlo igual?'
        );

        if (!confirmar) {
          setLoading(false);
          return;
        }

        res = await crearInventario(true);
        json = await res.json() as {
          data?: { id: string };
          error?: string;
          warning?: string;
          requires_confirmation?: boolean;
        };
      }

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
    <div className="mx-auto max-w-lg">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/dashboard">
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Nuevo inventario ocasional</h1>
          <p className="text-sm text-gray-500">
            Creá un inventario ocasional para contar productos específicos.
          </p>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Inventario ocasional</h2>
          <p className="text-xs text-gray-500 mt-1">
            Ingresá una descripción (opcional) para identificar este inventario.
          </p>
        </div>
        <div className="px-6 py-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleCrear();
            }}
            className="flex flex-col gap-4"
          >
            <Input
              label="Descripción (opcional)"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: Recuento góndola perfumería"
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" loading={loading} className="mt-2 w-full">
              Crear inventario ocasional y comenzar escaneo
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

