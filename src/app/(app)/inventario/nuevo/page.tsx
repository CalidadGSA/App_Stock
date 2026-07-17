'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ClipboardList, ArrowLeft, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { useMaintenanceStatus } from '@/components/MaintenanceGuard';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';
import {
  CATEGORIA_MACRO_SIN_PADRON,
  type CategoriaMacroInventarioDiario,
} from '@/lib/inventario/categoria-macro';
import type { DashboardStats } from '@/types';

export default function NuevoInventarioPage() {
  const router = useRouter();
  const notify = useAppNotify();
  const { maintenance } = useMaintenanceStatus();
  const [descripcion, setDescripcion] = useState('');
  const [categoriaMacro, setCategoriaMacro] = useState<CategoriaMacroInventarioDiario | ''>('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [trimestrePadronCompleto, setTrimestrePadronCompleto] = useState(false);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const res = await fetch('/api/dashboard');
        const json = (await res.json()) as { data?: DashboardStats };
        if (cancelado) return;
        const fila = json.data?.inventario_base_por_sucursal?.[0];
        setTrimestrePadronCompleto(fila?.trimestre_padron_completo === true);
      } catch {
        if (!cancelado) setTrimestrePadronCompleto(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);

  async function crearInventario(confirmOverride = false) {
    return fetch('/api/inventario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descripcion: descripcion.trim() || undefined,
        categoria_macro: categoriaMacro || undefined,
        confirm_override: confirmOverride || undefined,
      }),
    });
  }

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!categoriaMacro) {
      setError('Seleccioná una categoría macro para crear el inventario diario.');
      return;
    }

    setCreating(true);

    try {
      let res = await crearInventario(false);
      let json = await res.json() as {
        data?: { id: string };
        error?: string;
        warning?: string | null;
        requires_confirmation?: boolean;
      };

      if (!res.ok && json.requires_confirmation) {
        const confirmar = await notify.confirm({
          title: 'Inventario diario abierto',
          message:
            json.warning ??
            'Ya existe un inventario abierto de esta categoría. ¿Querés crearlo igual?',
          confirmLabel: 'Crear igual',
          cancelLabel: 'Cancelar',
          variant: 'warning',
        });

        if (!confirmar) {
          setCreating(false);
          return;
        }

        res = await crearInventario(true);
        json = await res.json() as {
          data?: { id: string };
          error?: string;
          warning?: string | null;
          requires_confirmation?: boolean;
        };
      }

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
                onChange={(e) => setCategoriaMacro(e.target.value as CategoriaMacroInventarioDiario | '')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900
                  focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Seleccionar categoría...</option>
                <option value="FARMA">FARMA</option>
                <option value="BIENESTAR">BIENESTAR</option>
                <option value="PSICOTROPICOS">PSICOTROPICOS</option>
                {trimestrePadronCompleto ? (
                  <option value={CATEGORIA_MACRO_SIN_PADRON}>Sin padrón</option>
                ) : null}
              </select>
              <p className="text-xs text-gray-500">
                Si seleccionás una categoría macro, este inventario diario quedará asociado a ese grupo de productos.
              </p>
            </div>

            {maintenance && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>No se pueden crear inventarios diarios hasta que se restablezca la base de datos.</span>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <Button type="submit" size="lg" loading={creating} disabled={maintenance} className="mt-2">
              Crear inventario diario y comenzar escaneo
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
