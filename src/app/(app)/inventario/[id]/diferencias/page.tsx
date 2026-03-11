'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/utils';
import type {
  ControlInventario,
  ControlInventarioDetalle,
  ProductoLegacy,
} from '@/types';

interface ControlConDetalles extends ControlInventario {
  controles_inventario_detalle: ControlInventarioDetalle[];
}

export default function InventarioDiferenciasPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [control, setControl] = useState<ControlConDetalles | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const [productosPorBarcode, setProductosPorBarcode] = useState<
    Record<string, ProductoLegacy | null>
  >({});

  const [edits, setEdits] = useState<
    Record<
      string,
      {
        cajas: string;
        unidades: string;
      }
    >
  >({});

  useEffect(() => {
    async function cargar() {
      try {
        const res = await fetch(`/api/inventario/${id}`);
        const json = (await res.json()) as { data?: ControlConDetalles; error?: string };
        if (!res.ok) {
          setError(json.error ?? 'Error al cargar control');
          return;
        }
        setControl(json.data!);
      } catch {
        setError('Error al cargar control');
      } finally {
        setLoading(false);
      }
    }
    cargar();
  }, [id]);

  // Cargar info actual del producto (incluye fraccionable y stock_unidades) para cada código de barras
  useEffect(() => {
    async function cargarProductos() {
      const detalles = control?.controles_inventario_detalle ?? [];
      const barcodes = Array.from(
        new Set(detalles.map((d) => d.codigo_barras))
      );
      const faltantes = barcodes.filter(
        (bc) => productosPorBarcode[bc] === undefined
      );
      if (faltantes.length === 0) return;

      const nuevos: Record<string, ProductoLegacy | null> = {};
      for (const bc of faltantes) {
        try {
          const res = await fetch(
            `/api/productos/${encodeURIComponent(bc)}`
          );
          const json = (await res.json()) as {
            data?: ProductoLegacy;
            error?: string;
          };
          nuevos[bc] = res.ok ? json.data ?? null : null;
        } catch {
          nuevos[bc] = null;
        }
      }
      setProductosPorBarcode((prev) => ({ ...prev, ...nuevos }));
    }
    if (control) {
      void cargarProductos();
    }
  }, [control, productosPorBarcode]);

  const detallesConDiferencias = useMemo(() => {
    const todos = control?.controles_inventario_detalle ?? [];
    return todos.filter((d) => (d.diferencia ?? 0) !== 0);
  }, [control]);

  async function handleGuardarLinea(detalle: ControlInventarioDetalle) {
    const current = edits[detalle.id] ?? {
      cajas:
        detalle.stock_real_cajas != null
          ? String(detalle.stock_real_cajas)
          : '',
      unidades:
        detalle.stock_real_unidades != null
          ? String(detalle.stock_real_unidades)
          : '',
    };

    const cajasNum =
      current.cajas.trim() === '' ? 0 : parseFloat(current.cajas);
    const unidadesNum =
      current.unidades.trim() === ''
        ? 0
        : parseFloat(current.unidades);

    if (Number.isNaN(cajasNum) || cajasNum < 0) {
      alert('Ingresá una cantidad válida de cajas (>= 0)');
      return;
    }
    if (Number.isNaN(unidadesNum) || unidadesNum < 0) {
      alert('Ingresá una cantidad válida de unidades (>= 0)');
      return;
    }

    const prod = productosPorBarcode[detalle.codigo_barras];
    const noFraccionableSinUnidades =
      prod &&
      prod.fraccionable !== 1 &&
      (prod.stock_unidades ?? 0) === 0;
    if (noFraccionableSinUnidades && unidadesNum !== 0) {
      alert(
        'Este producto no es fraccionable y el stock de unidades es 0; no se pueden cargar unidades sueltas.'
      );
      return;
    }
    const unidadesFinal = noFraccionableSinUnidades ? 0 : unidadesNum;

    // Estimamos unidades_por_caja a partir del stock de sistema si es posible
    let unidadesPorCaja = 1;
    if (
      detalle.stock_sist_cajas != null &&
      detalle.stock_sist_cajas > 0 &&
      detalle.stock_sist_unidades != null &&
      detalle.stock_sist_unidades >= 0 &&
      detalle.stock_sistema != null
    ) {
      const num =
        Number(detalle.stock_sistema) -
        Number(detalle.stock_sist_unidades);
      const den = Number(detalle.stock_sist_cajas);
      if (den > 0) {
        const estimado = num / den;
        if (Number.isFinite(estimado) && estimado > 0) {
          unidadesPorCaja = estimado;
        }
      }
    }

    const totalUnidades =
      cajasNum * unidadesPorCaja + unidadesFinal;

    setGuardando(true);
    try {
      const res = await fetch(`/api/inventario/${id}/detalles`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detalle_id: detalle.id,
          stock_real_cajas: cajasNum,
          stock_real_unidades: unidadesFinal,
          stock_real: totalUnidades,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        alert(json.error ?? 'Error al guardar la corrección');
        return;
      }

      // Refrescar control
      const recarga = await fetch(`/api/inventario/${id}`);
      const recargaJson = (await recarga.json()) as {
        data?: ControlConDetalles;
        error?: string;
      };
      if (!recarga.ok) {
        setError(recargaJson.error ?? 'Error al recargar control');
        return;
      }
      setControl(recargaJson.data!);
    } catch {
      alert('Error al guardar la corrección');
    } finally {
      setGuardando(false);
    }
  }

  async function handleCerrarDefinitivo() {
    if (
      detallesConDiferencias.length > 0 &&
      !confirm(
        'Aún hay diferencias distintas de 0. ¿Seguro que querés cerrar el control igualmente?'
      )
    ) {
      return;
    }
    try {
      const res = await fetch(`/api/inventario/${id}/cerrar`, {
        method: 'POST',
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        alert(json.error ?? 'Error al cerrar el control');
        return;
      }
      router.push('/dashboard');
    } catch {
      alert('Error al cerrar el control');
    }
  }

  if (loading) return <PageSpinner />;
  if (error || !control)
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-red-700">
          {error || 'Control no encontrado'}
        </p>
        <Link href="/dashboard">
          <Button variant="outline" className="mt-4">
            Volver al dashboard
          </Button>
        </Link>
      </div>
    );

  const enProgreso = control.estado === 'en_progreso';

  return (
    <div className="flex flex-col gap-6">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1"
            onClick={() => router.push(`/inventario/${id}`)}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">
                Revisar diferencias
              </h1>
              <Badge variant={enProgreso ? 'warning' : 'success'}>
                {enProgreso ? 'En progreso' : 'Cerrado'}
              </Badge>
            </div>
            <p className="text-sm text-gray-500">
              Inicio: {formatDateTime(control.fecha_inicio)}
              {control.fecha_fin &&
                ` · Cierre: ${formatDateTime(control.fecha_fin)}`}
            </p>
          </div>
        </div>

        {enProgreso && (
          <Button
            variant="danger"
            size="sm"
            onClick={handleCerrarDefinitivo}
            className="shrink-0 gap-1"
            disabled={guardando}
          >
            <CheckCircle2 className="h-4 w-4" />
            Cerrar control
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">
              Líneas con diferencias
            </h2>
            <Badge variant="info">
              {detallesConDiferencias.length} ítem
              {detallesConDiferencias.length !== 1 ? 's' : ''}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {detallesConDiferencias.length === 0 ? (
            <p className="px-5 py-6 text-center text-sm text-gray-400">
              No hay diferencias. Podés cerrar el control.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">
                      Producto
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Stock sistema
                      <br />
                      (cajas / unidades)
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Stock real
                      <br />
                      (cajas / unidades)
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Diferencia
                    </th>
                    <th className="px-4 py-2 text-center font-medium text-gray-600">
                      Acción
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {detallesConDiferencias.map((det) => {
                    const edit = edits[det.id] ?? {
                      cajas:
                        det.stock_real_cajas != null
                          ? String(det.stock_real_cajas)
                          : '',
                      unidades:
                        det.stock_real_unidades != null
                          ? String(det.stock_real_unidades)
                          : '',
                    };
                    const sistCajas = det.stock_sist_cajas ?? 0;
                    const sistUnidades =
                      det.stock_sist_unidades ?? 0;
                    const prod = productosPorBarcode[det.codigo_barras];
                    const noPermitirUnidades =
                      prod &&
                      prod.fraccionable !== 1 &&
                      (prod.stock_unidades ?? 0) === 0;
                    const realCajas = det.stock_real_cajas ?? 0;
                    const realUnidades =
                      det.stock_real_unidades ?? 0;
                    const diffCajas = realCajas - sistCajas;
                    const diffUnidades =
                      realUnidades - sistUnidades;
                    const diffColorC =
                      diffCajas === 0
                        ? 'text-gray-700'
                        : diffCajas > 0
                        ? 'text-blue-700'
                        : 'text-red-700';
                    const diffColorU =
                      diffUnidades === 0
                        ? 'text-gray-700'
                        : diffUnidades > 0
                        ? 'text-blue-700'
                        : 'text-red-700';

                    return (
                      <tr
                        key={det.id}
                        className="border-b border-gray-50"
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-gray-900">
                            {det.descripcion}
                          </div>
                          <div className="text-xs text-gray-500">
                            {det.presentacion}{' '}
                            {det.laboratorio
                              ? `· ${det.laboratorio}`
                              : ''}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            {det.codigo_barras}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          <div className="text-sm text-gray-900">
                            {sistCajas} / {sistUnidades}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            Total unidades sist.:{' '}
                            {Number(det.stock_sistema ?? 0).toFixed(
                              0
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          <div className="flex flex-col gap-1 items-center">
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={edit.cajas}
                              onChange={(e) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [det.id]: {
                                    ...edit,
                                    cajas: e.target.value,
                                  },
                                }))
                              }
                              className="w-20 text-center text-sm"
                              placeholder="0"
                            />
                            <Input
                              type="number"
                              min="0"
                              step="1"
                              value={
                                noPermitirUnidades
                                  ? '0'
                                  : edit.unidades
                              }
                              onChange={(e) =>
                                !noPermitirUnidades &&
                                setEdits((prev) => ({
                                  ...prev,
                                  [det.id]: {
                                    ...edit,
                                    unidades: e.target.value,
                                  },
                                }))
                              }
                              className="w-20 text-center text-sm"
                              placeholder="0"
                              disabled={!!noPermitirUnidades}
                              title={
                                noPermitirUnidades
                                  ? 'Producto no fraccionable sin unidades en sistema'
                                  : undefined
                              }
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          <div className="flex flex-col gap-1 text-xs">
                            <span
                              className={`font-semibold ${diffColorC}`}
                            >
                              Dif. cajas:{' '}
                              {diffCajas > 0 ? '+' : ''}
                              {diffCajas.toFixed(0)}
                            </span>
                            <span
                              className={`font-semibold ${diffColorU}`}
                            >
                              Dif. unidades:{' '}
                              {diffUnidades > 0 ? '+' : ''}
                              {diffUnidades.toFixed(0)}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center align-top">
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() =>
                              handleGuardarLinea(det)
                            }
                            loading={guardando}
                          >
                            Guardar
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

