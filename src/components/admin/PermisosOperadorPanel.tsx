'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Minus, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';
import {
  PERMISSIONS_CATALOG,
  PERMISSION_CATEGORIES,
} from '@/lib/auth/permissions-catalog';

type Estado = 'rol' | 'conceder' | 'revocar';

interface Respuesta {
  operador: {
    idoperador: number;
    operador: string;
    nombrecompleto: string;
    rol: string;
    activo: boolean;
  };
  del_rol: string[];
  ajustes: Array<{ permission_codigo: string; concedido: boolean; motivo: string | null }>;
  efectivos: string[];
  disponible: boolean;
}

/**
 * Permisos de un operador puntual: muestra qué le da el rol y permite sumarle o quitarle
 * módulos sin cambiárselo.
 */
export default function PermisosOperadorPanel({
  idoperador,
  onCerrar,
}: {
  idoperador: number;
  onCerrar: () => void;
}) {
  const [data, setData] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetch(`/api/admin/operadores/permisos?idoperador=${idoperador}`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudieron cargar los permisos');
        setData(null);
        return;
      }
      setError('');
      setData(json as Respuesta);
    } catch {
      setError('Error de red al cargar los permisos');
    } finally {
      setCargando(false);
    }
  }, [idoperador]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const estadoPorPermiso = useMemo(() => {
    const m = new Map<string, Estado>();
    for (const a of data?.ajustes ?? []) {
      m.set(a.permission_codigo, a.concedido ? 'conceder' : 'revocar');
    }
    return m;
  }, [data]);

  const delRol = useMemo(() => new Set(data?.del_rol ?? []), [data]);

  async function cambiar(permiso: string, estado: Estado) {
    setGuardando(permiso);
    try {
      const res = await fetch('/api/admin/operadores/permisos', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idoperador, permiso, estado }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? 'No se pudo guardar el cambio');
        return;
      }
      setError('');
      await cargar();
    } catch {
      setError('Error de red al guardar');
    } finally {
      setGuardando(null);
    }
  }

  const porCategoria = useMemo(() => {
    const m = new Map<string, typeof PERMISSIONS_CATALOG>();
    for (const p of PERMISSIONS_CATALOG) {
      const lista = m.get(p.categoria) ?? [];
      lista.push(p);
      m.set(p.categoria, lista);
    }
    return [...m.entries()];
  }, []);

  const esSuperadmin = data?.operador.rol?.toLowerCase() === 'superadmin';

  return (
    <div className="fixed inset-0 z-50 flex">
      <button type="button" className="flex-1 bg-black/40" aria-label="Cerrar" onClick={onCerrar} />
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-900 dark:text-gray-100">
              Permisos de {data?.operador.nombrecompleto ?? '…'}
            </h2>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">
              {data?.operador.operador}
              {data ? ` · rol ${data.operador.rol}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            className="rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {cargando ? (
            <PageSpinner />
          ) : (
            <>
              {error && (
                <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}

              {esSuperadmin ? (
                <p className="mb-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  El superadministrador tiene acceso total por definición: no admite ajustes.
                </p>
              ) : (
                <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                  <strong>Del rol</strong> es lo que le corresponde por su rol.{' '}
                  <strong>Agregado</strong> y <strong>Quitado</strong> son excepciones solo para
                  este usuario; el rol no se modifica.
                </p>
              )}

              {porCategoria.map(([categoria, permisos]) => (
                <div key={categoria} className="mb-4">
                  <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {PERMISSION_CATEGORIES[categoria] ?? categoria}
                  </h3>
                  <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
                    {permisos.map((p) => {
                      const ajuste = estadoPorPermiso.get(p.codigo);
                      const enRol = delRol.has(p.codigo);
                      const activo = ajuste === 'conceder' || (enRol && ajuste !== 'revocar');
                      return (
                        <li
                          key={p.codigo}
                          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {p.nombre}
                              {activo ? (
                                <Check className="ml-1 inline h-3.5 w-3.5 text-emerald-600" />
                              ) : null}
                            </p>
                            <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                              {enRol ? 'Del rol' : 'No incluido en el rol'}
                              {ajuste === 'conceder' ? ' · agregado a mano' : ''}
                              {ajuste === 'revocar' ? ' · quitado a mano' : ''}
                            </p>
                          </div>
                          {!esSuperadmin && (
                            <div className="flex shrink-0 gap-1">
                              <Button
                                size="sm"
                                variant={ajuste === 'conceder' ? 'primary' : 'outline'}
                                disabled={guardando === p.codigo}
                                title="Dárselo aunque el rol no lo incluya"
                                onClick={() => void cambiar(p.codigo, 'conceder')}
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant={ajuste === 'revocar' ? 'danger' : 'outline'}
                                disabled={guardando === p.codigo}
                                title="Quitárselo aunque el rol lo incluya"
                                onClick={() => void cambiar(p.codigo, 'revocar')}
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={guardando === p.codigo || !ajuste}
                                title="Volver a lo que dice el rol"
                                onClick={() => void cambiar(p.codigo, 'rol')}
                              >
                                Rol
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
