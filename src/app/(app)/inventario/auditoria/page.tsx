'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageSpinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';
import {
  CATEGORIAS_MACRO,
  type CategoriaMacro,
} from '@/lib/inventario/categoria-macro';

export default function NuevaAuditoriaInventarioPage() {
  const router = useRouter();
  const notify = useAppNotify();
  const [descripcion, setDescripcion] = useState('');
  const [categoriaMacro, setCategoriaMacro] = useState<CategoriaMacro | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function crearAuditoria(confirmOverride = false) {
    return fetch('/api/inventario/auditoria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descripcion: descripcion.trim() || undefined,
        categoria_macro: categoriaMacro,
        confirm_override: confirmOverride || undefined,
      }),
    });
  }

  async function handleCrear(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setError('');
    if (!categoriaMacro) {
      setError('Seleccioná una categoría macro.');
      return;
    }

    setLoading(true);
    try {
      let res = await crearAuditoria(false);
      let json = (await res.json()) as {
        data?: { id: string };
        error?: string;
        warning?: string | null;
        requires_confirmation?: boolean;
      };

      if (!res.ok && json.requires_confirmation) {
        const confirmar = await notify.confirm({
          title: 'Auditoría abierta',
          message:
            json.warning ??
            'Ya existe una auditoría abierta de esta categoría. ¿Querés crear otra con los siguientes productos?',
          confirmLabel: 'Crear igual',
          cancelLabel: 'Cancelar',
          variant: 'warning',
        });

        if (!confirmar) {
          setLoading(false);
          return;
        }

        res = await crearAuditoria(true);
        json = (await res.json()) as {
          data?: { id: string };
          error?: string;
          warning?: string | null;
          requires_confirmation?: boolean;
        };
      }

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
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Nueva auditoría de inventario</h1>
          <p className="text-sm text-gray-500">
            Elegí la categoría macro y se cargarán productos con diferencias pendientes de esa
            categoría.
          </p>
        </div>
      </div>

      <div className="w-full rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-6 py-4">
          <h2 className="text-sm font-semibold text-gray-900">Auditoría de inventario</h2>
        </div>
        <div className="px-6 py-5">
          <form onSubmit={handleCrear} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-800">Categoría macro</label>
              <select
                value={categoriaMacro}
                onChange={(e) => setCategoriaMacro(e.target.value as CategoriaMacro | '')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                required
              >
                <option value="">Seleccionar categoría...</option>
                {CATEGORIAS_MACRO.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Descripción (opcional)"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Ej: Auditoría FARMA — marzo 2026"
            />

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
