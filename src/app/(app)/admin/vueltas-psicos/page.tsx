'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, RefreshCw, RotateCcw, Save } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import type { VueltasPsicosSucursalRow } from '@/app/api/admin/sucursales/vueltas-psicos/route';

type EditableRow = VueltasPsicosSucursalRow & {
  draft: string;
  dirty: boolean;
};

export default function VueltasPsicosAdminPage() {
  const router = useRouter();
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [defaultVueltas, setDefaultVueltas] = useState(4);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [successMsg, setSuccessMsg] = useState('');

  const pendientes = useMemo(() => rows.filter((r) => r.dirty).length, [rows]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/admin/sucursales/vueltas-psicos');
      if (res.status === 403) {
        router.replace('/dashboard');
        return;
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error al cargar sucursales');
      const data = (json.data ?? []) as VueltasPsicosSucursalRow[];
      setDefaultVueltas(Number(json.default) || 4);
      setRows(
        data.map((r) => ({
          ...r,
          draft: String(r.vueltas_psicos),
          dirty: false,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function actualizarDraft(sucursalId: number, valor: string) {
    const limpio = valor.replace(/\D/g, '');
    setRows((prev) =>
      prev.map((r) => {
        if (r.sucursal_id !== sucursalId) return r;
        const vueltasActual = String(r.vueltas_psicos);
        return {
          ...r,
          draft: limpio,
          dirty: limpio !== vueltasActual,
        };
      })
    );
    setSuccessMsg('');
  }

  function revertirFila(sucursalId: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.sucursal_id === sucursalId
          ? { ...r, draft: String(r.vueltas_psicos), dirty: false }
          : r
      )
    );
  }

  async function guardarFila(row: EditableRow) {
    const vueltas = parseInt(row.draft, 10);
    if (!Number.isFinite(vueltas) || vueltas < 1 || vueltas > 20) {
      setError('Cada sucursal debe tener entre 1 y 20 vueltas.');
      return;
    }

    setSavingId(row.sucursal_id);
    setError('');
    setSuccessMsg('');
    try {
      const res = await fetch('/api/admin/sucursales/vueltas-psicos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sucursal_id: row.sucursal_id,
          vueltas_psicos: vueltas,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Error al guardar');

      const actualizado = json.data as VueltasPsicosSucursalRow;
      setRows((prev) =>
        prev.map((r) =>
          r.sucursal_id === actualizado.sucursal_id
            ? {
                ...actualizado,
                draft: String(actualizado.vueltas_psicos),
                dirty: false,
              }
            : r
        )
      );
      setSuccessMsg(`Guardado: ${actualizado.nombre} → ${actualizado.vueltas_psicos} vueltas`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSavingId(null);
    }
  }

  async function guardarPendientes() {
    const dirty = rows.filter((r) => r.dirty);
    for (const row of dirty) {
      await guardarFila(row);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <PageSpinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 pb-10 md:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/admin/resumen-trimestral"
          className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Resumen trimestral
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Vueltas de psicotrópicos
        </h1>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-100">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          {successMsg}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-2">
          <h2 className="text-lg font-semibold">Sucursales</h2>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void cargar()}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Recargar
            </Button>
            {pendientes > 0 && (
              <Button type="button" size="sm" onClick={() => void guardarPendientes()}>
                <Save className="mr-1 h-4 w-4" />
                Guardar {pendientes} cambio{pendientes === 1 ? '' : 's'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">No hay sucursales activas para configurar.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-slate-800/60">
                    <th className="px-4 py-3 font-medium">ID</th>
                    <th className="px-4 py-3 font-medium">Sucursal</th>
                    <th className="px-4 py-3 font-medium">Vueltas</th>
                    <th className="px-4 py-3 font-medium text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.sucursal_id}
                      className="border-b border-gray-100 dark:border-gray-800"
                    >
                      <td className="px-4 py-3 text-gray-500">{row.sucursal_id}</td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {row.nombre}
                        </span>
                        {row.es_drogueria && (
                          <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                            Droguería
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="number"
                          min={1}
                          max={20}
                          inputMode="numeric"
                          value={row.draft}
                          onChange={(e) => actualizarDraft(row.sucursal_id, e.target.value)}
                          className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-center dark:border-gray-600 dark:bg-slate-900"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex gap-2">
                          {row.dirty && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => revertirFila(row.sucursal_id)}
                              disabled={savingId === row.sucursal_id}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant={row.dirty ? 'primary' : 'outline'}
                            disabled={!row.dirty || savingId === row.sucursal_id}
                            onClick={() => void guardarFila(row)}
                          >
                            {savingId === row.sucursal_id ? '…' : 'Guardar'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
