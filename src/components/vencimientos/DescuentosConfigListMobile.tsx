'use client';

import { Button } from '@/components/ui/button';
import { ListStatPill } from '@/components/list/ListStatPill';

export type CategoriaFinalItem = {
  id: number;
  subrubro_nombre: string;
  categoria: string;
  categoria_final: string;
};

export type DescuentoItem = {
  id: number;
  categoria_final: string;
  descuento: number;
  dias_min: number;
  dias_max: number;
};

export function CategoriasFinalesListMobile({
  items,
  editCat,
  setEditCat,
  guardando,
  onSave,
  onDelete,
}: {
  items: CategoriaFinalItem[];
  editCat: { id: number; value: string } | null;
  setEditCat: (v: { id: number; value: string } | null) => void;
  guardando: boolean;
  onSave: () => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((c) => {
        const isEditing = editCat?.id === c.id;
        return (
          <article
            key={c.id}
            className="border-l-4 border-emerald-500/70 bg-white px-3 py-3 dark:bg-slate-900"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
              {c.subrubro_nombre || '—'}
            </p>
            <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
              <span className="font-medium text-gray-500">Categoría:</span> {c.categoria}
            </p>
            <div className="mt-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Categoría final
              </p>
              {isEditing ? (
                <input
                  type="text"
                  value={editCat.value}
                  onChange={(e) =>
                    setEditCat(editCat ? { ...editCat, value: e.target.value } : null)
                  }
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm dark:border-gray-600 dark:bg-slate-900"
                />
              ) : (
                <p className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {c.categoria_final}
                </p>
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {isEditing ? (
                <>
                  <Button size="sm" onClick={onSave} loading={guardando}>
                    Guardar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditCat(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditCat({ id: c.id, value: c.categoria_final })}
                  >
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={guardando}
                    onClick={() => onDelete(c.id)}
                  >
                    Eliminar
                  </Button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function DescuentosCreadosListMobile({
  items,
  editDesc,
  setEditDesc,
  guardando,
  onSave,
  onDelete,
  onStartEdit,
}: {
  items: DescuentoItem[];
  editDesc: {
    id: number;
    descuento: string;
    dias_min: string;
    dias_max: string;
  } | null;
  setEditDesc: (
    v: { id: number; descuento: string; dias_min: string; dias_max: string } | null
  ) => void;
  guardando: boolean;
  onSave: () => void;
  onDelete: (id: number) => void;
  onStartEdit: (d: DescuentoItem) => void;
}) {
  return (
    <div className="divide-y divide-gray-200 dark:divide-gray-800">
      {items.map((d) => {
        const isEditing = editDesc?.id === d.id;
        return (
          <article
            key={d.id}
            className="border-l-4 border-blue-500/70 bg-white px-3 py-3 dark:bg-slate-900"
          >
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {d.categoria_final}
            </h3>
            {isEditing && editDesc ? (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-gray-500">Descuento %</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={editDesc.descuento}
                    onChange={(e) =>
                      setEditDesc({ ...editDesc, descuento: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm dark:border-gray-600 dark:bg-slate-900"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-gray-500">Días mín.</span>
                  <input
                    type="number"
                    min={0}
                    value={editDesc.dias_min}
                    onChange={(e) =>
                      setEditDesc({ ...editDesc, dias_min: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm dark:border-gray-600 dark:bg-slate-900"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium text-gray-500">Días máx.</span>
                  <input
                    type="number"
                    min={0}
                    value={editDesc.dias_max}
                    onChange={(e) =>
                      setEditDesc({ ...editDesc, dias_max: e.target.value })
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-2.5 py-2 text-sm dark:border-gray-600 dark:bg-slate-900"
                  />
                </label>
              </div>
            ) : (
              <div className="mt-2 grid grid-cols-3 gap-2">
                <ListStatPill label="Descuento" value={`${d.descuento}%`} emphasize />
                <ListStatPill label="Días mín." value={String(d.dias_min)} />
                <ListStatPill label="Días máx." value={String(d.dias_max)} />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {isEditing ? (
                <>
                  <Button size="sm" onClick={onSave} loading={guardando}>
                    Guardar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditDesc(null)}>
                    Cancelar
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="outline" onClick={() => onStartEdit(d)}>
                    Editar
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={guardando}
                    onClick={() => onDelete(d.id)}
                  >
                    Eliminar
                  </Button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
