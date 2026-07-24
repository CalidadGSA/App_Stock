'use client';

import { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import { ArrowLeft } from 'lucide-react';
import {
  CategoriasFinalesListMobile,
  DescuentosCreadosListMobile,
} from '@/components/vencimientos/DescuentosConfigListMobile';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';

type OpcionPadron = {
  subrubro: string;
  categoria: string;
};

type CategoriaFinal = {
  id: number;
  subrubro_nombre: string;
  categoria: string;
  categoria_final: string;
};

type Descuento = {
  id: number;
  categoria_final_id: number;
  categoria_final: string;
  descuento: number;
  dias_min: number;
  dias_max: number;
};

type ApiData = {
  opciones_padron: OpcionPadron[];
  categorias_finales: CategoriaFinal[];
  descuentos: Descuento[];
};

function normalizarTexto(v: string): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export default function DescuentosConfigPage() {
  const router = useRouter();
  const notify = useAppNotify();
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [data, setData] = useState<ApiData>({
    opciones_padron: [],
    categorias_finales: [],
    descuentos: [],
  });

  const [showCategoriaCard, setShowCategoriaCard] = useState(false);
  const [showCategoriaSoloCard, setShowCategoriaSoloCard] = useState(false);
  const [showDescuentoCard, setShowDescuentoCard] = useState(false);

  const [subrubroSel, setSubrubroSel] = useState('');
  const [categoriaSel, setCategoriaSel] = useState('');
  const [categoriaFinalTxt, setCategoriaFinalTxt] = useState('');

  const [catFinalSel, setCatFinalSel] = useState('');
  const [descuentoTxt, setDescuentoTxt] = useState('');
  const [diasMin, setDiasMin] = useState('');
  const [diasMax, setDiasMax] = useState('');

  const [editCat, setEditCat] = useState<{ id: number; value: string } | null>(null);
  const [editDesc, setEditDesc] = useState<{
    id: number;
    descuento: string;
    dias_min: string;
    dias_max: string;
  } | null>(null);

  const agrupadoPadron = useMemo(() => {
    const map = new Map<string, { label: string; categorias: Set<string> }>();
    for (const row of data.opciones_padron) {
      const subLabel = String(row.subrubro ?? '').trim();
      const cat = String(row.categoria ?? '').trim();
      if (!subLabel || !cat) continue;
      const key = normalizarTexto(subLabel);
      if (!map.has(key)) map.set(key, { label: subLabel, categorias: new Set<string>() });
      map.get(key)!.categorias.add(cat);
    }
    return map;
  }, [data.opciones_padron]);

  const subrubros = useMemo(
    () =>
      Array.from(agrupadoPadron.entries())
        .map(([value, v]) => ({ value, label: v.label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [agrupadoPadron]
  );

  const categoriasPorSubrubro = useMemo(() => {
    if (!subrubroSel) return [];
    const group = agrupadoPadron.get(subrubroSel);
    if (!group) return [];
    return Array.from(group.categorias).sort((a, b) => a.localeCompare(b));
  }, [agrupadoPadron, subrubroSel]);

  const categoriasGlobales = useMemo(
    () =>
      Array.from(new Set(data.opciones_padron.map((x) => String(x.categoria ?? '').trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [data.opciones_padron]
  );

  const subrubrosPorCategoria = useMemo(() => {
    if (!categoriaSel) return [];
    const set = new Set(
      data.opciones_padron
        .filter((x) => String(x.categoria ?? '').trim() === categoriaSel)
        .map((x) => String(x.subrubro ?? '').trim())
        .filter(Boolean)
    );
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data.opciones_padron, categoriaSel]);

  function cerrarModalCategoriaFinal() {
    setShowCategoriaCard(false);
    setSubrubroSel('');
    setCategoriaSel('');
    setCategoriaFinalTxt('');
  }

  function cerrarModalCategoriaFinalSolo() {
    setShowCategoriaSoloCard(false);
    setCategoriaSel('');
    setCategoriaFinalTxt('');
  }

  function cerrarModalDescuento() {
    setShowDescuentoCard(false);
    setCatFinalSel('');
    setDescuentoTxt('');
    setDiasMin('');
    setDiasMax('');
  }

  async function cargar() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos');
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al cargar configuración');
        return;
      }
      setData({
        opciones_padron: json.opciones_padron ?? [],
        categorias_finales: json.categorias_finales ?? [],
        descuentos: json.descuentos ?? [],
      });
    } catch {
      setError('Error al cargar configuración');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  async function crearCategoriaFinal() {
    const subrubroLabel = agrupadoPadron.get(subrubroSel)?.label ?? '';
    if (!subrubroSel || !subrubroLabel || !categoriaSel || !categoriaFinalTxt.trim()) {
      setError('Completá Sub Rubro, Categoría y Categoría Final.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'categoria_final',
          payload: {
            subrubro: subrubroLabel,
            categoria: categoriaSel,
            categoria_final: categoriaFinalTxt.trim(),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo crear categoría final');
        return;
      }
      cerrarModalCategoriaFinal();
      await cargar();
    } catch {
      setError('No se pudo crear categoría final');
    } finally {
      setGuardando(false);
    }
  }

  async function crearCategoriaFinalSoloCategoria() {
    if (!categoriaSel || !categoriaFinalTxt.trim()) {
      setError('Completá Categoría y Categoría Final.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'categoria_final',
          payload: {
            categoria: categoriaSel,
            categoria_final: categoriaFinalTxt.trim(),
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo crear categoría final');
        return;
      }
      cerrarModalCategoriaFinalSolo();
      await cargar();
    } catch {
      setError('No se pudo crear categoría final');
    } finally {
      setGuardando(false);
    }
  }

  async function crearDescuento() {
    const descuento = Number(descuentoTxt);
    const dMin = Number(diasMin);
    const dMax = Number(diasMax);
    if (
      !catFinalSel ||
      !Number.isFinite(descuento) ||
      descuento < 1 ||
      descuento > 100 ||
      !Number.isFinite(dMin) ||
      !Number.isFinite(dMax)
    ) {
      setError('Completá categoría final, descuento (1-100), días mínimo y máximo.');
      return;
    }
    if (dMax < dMin) {
      setError('Días máximos no puede ser menor que días mínimos.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'descuento',
          payload: {
            categoria_final_id: Number(catFinalSel),
            descuento,
            dias_min: dMin,
            dias_max: dMax,
          },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo crear descuento');
        return;
      }
      cerrarModalDescuento();
      await cargar();
    } catch {
      setError('No se pudo crear descuento');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarCategoriaFinalEdit() {
    if (!editCat) return;
    if (!editCat.value.trim()) {
      setError('La categoría final no puede quedar vacía.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'categoria_final',
          id: editCat.id,
          categoria_final: editCat.value.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo editar categoría final');
        return;
      }
      setEditCat(null);
      await cargar();
    } catch {
      setError('No se pudo editar categoría final');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarCategoriaFinal(id: number) {
    if (!(await notify.confirm({
      title: 'Eliminar categoría',
      message: '¿Eliminar esta categoría final?',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    }))) return;
    setGuardando(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'categoria_final', id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo eliminar categoría final');
        return;
      }
      await cargar();
    } catch {
      setError('No se pudo eliminar categoría final');
    } finally {
      setGuardando(false);
    }
  }

  async function guardarDescuentoEdit() {
    if (!editDesc) return;
    const descuento = Number(editDesc.descuento);
    if (!Number.isFinite(descuento) || descuento < 1 || descuento > 100) {
      setError('El descuento debe estar entre 1 y 100.');
      return;
    }
    const dMin = Number(editDesc.dias_min);
    const dMax = Number(editDesc.dias_max);
    if (!Number.isFinite(dMin) || !Number.isFinite(dMax) || dMax < dMin) {
      setError('Rango de días inválido.');
      return;
    }
    setGuardando(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: 'descuento',
          id: editDesc.id,
          descuento,
          dias_min: dMin,
          dias_max: dMax,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo editar descuento');
        return;
      }
      setEditDesc(null);
      await cargar();
    } catch {
      setError('No se pudo editar descuento');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminarDescuento(id: number) {
    if (!(await notify.confirm({
      title: 'Eliminar descuento',
      message: '¿Eliminar este descuento?',
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    }))) return;
    setGuardando(true);
    setError('');
    try {
      const res = await fetch('/api/vencimientos/descuentos', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'descuento', id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo eliminar descuento');
        return;
      }
      await cargar();
    } catch {
      setError('No se pudo eliminar descuento');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Volver"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-slate-900"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-lg font-bold leading-tight text-gray-900 sm:text-xl dark:text-gray-100">
            Configuración de descuentos
          </h1>
        </div>
        <Link href="/vencimientos/descuentos/productos" className="shrink-0">
          <Button size="sm" variant="secondary" className="w-full sm:w-auto">
            Productos con descuentos
          </Button>
        </Link>
      </div>

      <Card>
        <CardContent className="grid grid-cols-1 gap-2 pt-6 sm:flex sm:flex-wrap sm:gap-3">
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-center sm:w-auto"
            onClick={() => {
              if (showCategoriaSoloCard) {
                cerrarModalCategoriaFinalSolo();
                return;
              }
              setShowCategoriaSoloCard(true);
            }}
          >
            Crear categoría final (solo categoría)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-center sm:w-auto"
            onClick={() => {
              if (showCategoriaCard) {
                cerrarModalCategoriaFinal();
                return;
              }
              setShowCategoriaCard(true);
            }}
          >
            Crear categoría final (categoría + subrubro)
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-center sm:w-auto"
            onClick={() => {
              if (showDescuentoCard) {
                cerrarModalDescuento();
                return;
              }
              setShowDescuentoCard(true);
            }}
          >
            Crear descuento
          </Button>
        </CardContent>
      </Card>

      {showCategoriaCard && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:items-center sm:p-4">
          <Card className="my-auto w-full max-w-3xl">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Nueva categoría final</h2>
                <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={cerrarModalCategoriaFinal}>
                  Cerrar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 md:grid md:grid-cols-4">
              <select
                value={categoriaSel}
                onChange={(e) => {
                  setCategoriaSel(e.target.value);
                  setSubrubroSel('');
                }}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
              >
                <option value="">Categoría</option>
                {categoriasGlobales.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={subrubroSel}
                onChange={(e) => setSubrubroSel(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
              >
                <option value="">Sub Rubro</option>
                {subrubrosPorCategoria.map((s) => (
                  <option key={s} value={normalizarTexto(s)}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={categoriaFinalTxt}
                onChange={(e) => setCategoriaFinalTxt(e.target.value)}
                placeholder="Categoría Final"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
              />
              <Button size="sm" className="w-full md:w-auto" loading={guardando} onClick={crearCategoriaFinal}>
                Guardar
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {showCategoriaSoloCard && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:items-center sm:p-4">
          <Card className="my-auto w-full max-w-2xl">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-sm font-semibold text-gray-900 sm:text-base dark:text-gray-100">
                  Nueva categoría final (solo categoría)
                </h2>
                <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={cerrarModalCategoriaFinalSolo}>
                  Cerrar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 md:grid md:grid-cols-3">
              <select
                value={categoriaSel}
                onChange={(e) => setCategoriaSel(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
              >
                <option value="">Categoría</option>
                {categoriasGlobales.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={categoriaFinalTxt}
                onChange={(e) => setCategoriaFinalTxt(e.target.value)}
                placeholder="Categoría Final"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
              />
              <Button size="sm" className="w-full md:w-auto" loading={guardando} onClick={crearCategoriaFinalSoloCategoria}>
                Guardar
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {showDescuentoCard && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-3 sm:items-center sm:p-4">
          <Card className="my-auto w-full max-w-4xl">
            <CardHeader>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">Nuevo descuento</h2>
                <Button size="sm" variant="outline" className="w-full sm:w-auto" onClick={cerrarModalDescuento}>
                  Cerrar
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 md:grid md:grid-cols-5">
              <select
                value={catFinalSel}
                onChange={(e) => setCatFinalSel(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
              >
                <option value="">Categoría Final</option>
                {data.categorias_finales.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.categoria_final}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                max={100}
                value={descuentoTxt}
                onChange={(e) => setDescuentoTxt(e.target.value)}
                placeholder="Descuento (1-100)"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
              />
            <input
              type="number"
              min={0}
              value={diasMin}
              onChange={(e) => setDiasMin(e.target.value)}
              placeholder="Días mín."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
            />
            <input
              type="number"
              min={0}
              value={diasMax}
              onChange={(e) => setDiasMax(e.target.value)}
              placeholder="Días máx."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-slate-900"
            />
              <Button size="sm" className="w-full md:w-auto" loading={guardando} onClick={crearDescuento}>
                Guardar
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900">Categorías finales creadas</h2>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : data.categorias_finales.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">No hay categorías finales creadas.</p>
          ) : (
            <>
            <div className="md:hidden">
              <CategoriasFinalesListMobile
                items={data.categorias_finales}
                editCat={editCat}
                setEditCat={setEditCat}
                guardando={guardando}
                onSave={() => void guardarCategoriaFinalEdit()}
                onDelete={(id) => void eliminarCategoriaFinal(id)}
              />
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-[640px] w-full text-sm">
                <thead className="border-b bg-gray-50 text-xs text-gray-600 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Sub Rubro</th>
                    <th className="px-3 py-2 text-left font-medium">Categoría</th>
                    <th className="px-3 py-2 text-left font-medium">Categoría Final</th>
                    <th className="px-3 py-2 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.categorias_finales.map((c) => {
                    const isEditing = editCat?.id === c.id;
                    return (
                      <tr key={c.id}>
                        <td className="px-3 py-2">{c.subrubro_nombre}</td>
                        <td className="px-3 py-2">{c.categoria}</td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editCat.value}
                              onChange={(e) =>
                                setEditCat((prev) => (prev ? { ...prev, value: e.target.value } : prev))
                              }
                              className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
                            />
                          ) : (
                            c.categoria_final
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" onClick={guardarCategoriaFinalEdit} loading={guardando}>
                                Guardar
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setEditCat(null)}>
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => setEditCat({ id: c.id, value: c.categoria_final })}>
                                Editar
                              </Button>
                              <Button size="sm" variant="danger" loading={guardando} onClick={() => void eliminarCategoriaFinal(c.id)}>
                                Eliminar
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Descuentos creados</h2>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-6">
              <PageSpinner />
            </div>
          ) : data.descuentos.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">No hay descuentos creados.</p>
          ) : (
            <>
            <div className="md:hidden">
              <DescuentosCreadosListMobile
                items={data.descuentos}
                editDesc={editDesc}
                setEditDesc={setEditDesc}
                guardando={guardando}
                onSave={() => void guardarDescuentoEdit()}
                onDelete={(id) => void eliminarDescuento(id)}
                onStartEdit={(d) =>
                  setEditDesc({
                    id: d.id,
                    descuento: String(d.descuento),
                    dias_min: String(d.dias_min),
                    dias_max: String(d.dias_max),
                  })
                }
              />
            </div>
            <div className="hidden overflow-x-auto md:block">
              <table className="min-w-[560px] w-full text-sm">
                <thead className="border-b bg-gray-50 text-xs text-gray-600 dark:bg-slate-900">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Categoría Final</th>
                    <th className="px-3 py-2 text-right font-medium">Descuento</th>
                    <th className="px-3 py-2 text-left font-medium">Días mín.</th>
                    <th className="px-3 py-2 text-left font-medium">Días máx.</th>
                    <th className="px-3 py-2 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.descuentos.map((d) => {
                    const isEditing = editDesc?.id === d.id;
                    return (
                      <tr key={d.id}>
                        <td className="px-3 py-2">{d.categoria_final}</td>
                        <td className="px-3 py-2 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={editDesc.descuento}
                              onChange={(e) =>
                                setEditDesc((prev) => (prev ? { ...prev, descuento: e.target.value } : prev))
                              }
                              className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
                            />
                          ) : (
                            `${d.descuento}%`
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              value={editDesc.dias_min}
                              onChange={(e) =>
                                setEditDesc((prev) => (prev ? { ...prev, dias_min: e.target.value } : prev))
                              }
                              className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
                            />
                          ) : (
                            d.dias_min
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {isEditing ? (
                            <input
                              type="number"
                              min={0}
                              value={editDesc.dias_max}
                              onChange={(e) =>
                                setEditDesc((prev) => (prev ? { ...prev, dias_max: e.target.value } : prev))
                              }
                              className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
                            />
                          ) : (
                            d.dias_max
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-2">
                              <Button size="sm" onClick={guardarDescuentoEdit} loading={guardando}>
                                Guardar
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setEditDesc(null)}>
                                Cancelar
                              </Button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setEditDesc({
                                    id: d.id,
                                    descuento: String(d.descuento),
                                    dias_min: String(d.dias_min),
                                    dias_max: String(d.dias_max),
                                  })
                                }
                              >
                                Editar
                              </Button>
                              <Button size="sm" variant="danger" loading={guardando} onClick={() => void eliminarDescuento(d.id)}>
                                Eliminar
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
