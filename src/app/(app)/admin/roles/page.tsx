'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Filter, Plus, Shield, Users } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/spinner';

interface RoleListItem {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  es_sistema: boolean;
  activo: boolean;
  permisos_count: number;
  operadores_count: number;
}

type Tab = 'roles' | 'operadores';

interface OperadorRow {
  idoperador: number;
  operador: string;
  nombrecompleto: string;
  rol: string;
  activo: string;
  app_role_id: number | null;
  app_role?: { id: number; codigo: string; nombre: string } | null;
}

export default function RolesPermisosPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('roles');
  const [roles, setRoles] = useState<RoleListItem[]>([]);
  const [operadores, setOperadores] = useState<OperadorRow[]>([]);
  const [rolFiltro, setRolFiltro] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);

  const operadoresVisibles = useMemo(() => {
    if (!rolFiltro) return operadores;
    if (rolFiltro === 'sin') {
      return operadores.filter((o) => o.app_role_id == null);
    }
    const roleId = parseInt(rolFiltro, 10);
    if (Number.isNaN(roleId)) return operadores;
    return operadores.filter((o) => o.app_role_id === roleId);
  }, [operadores, rolFiltro]);

  const rolFiltroLabel = useMemo(() => {
    if (!rolFiltro) return '';
    if (rolFiltro === 'sin') return 'Sin rol asignado';
    const r = roles.find((x) => String(x.id) === rolFiltro);
    return r?.nombre ?? rolFiltro;
  }, [roles, rolFiltro]);

  const cargarRoles = useCallback(async () => {
    const res = await fetch('/api/admin/roles');
    if (res.status === 403) {
      router.replace('/dashboard');
      return null;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Error al cargar roles');
    return json.data as RoleListItem[];
  }, [router]);

  const cargarOperadores = useCallback(async () => {
    const res = await fetch('/api/admin/operadores-rbac');
    if (res.status === 403) {
      router.replace('/dashboard');
      return null;
    }
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? 'Error al cargar operadores');
    return json.data as OperadorRow[];
  }, [router]);

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rolesData, opsData] = await Promise.all([cargarRoles(), cargarOperadores()]);
      if (rolesData) setRoles(rolesData);
      if (opsData) setOperadores(opsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error al cargar datos');
    } finally {
      setLoading(false);
    }
  }, [cargarRoles, cargarOperadores]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function asignarRol(idoperador: number, appRoleId: string) {
    const roleId = appRoleId === '' ? null : parseInt(appRoleId, 10);
    setSavingId(idoperador);
    setError('');
    try {
      const res = await fetch(`/api/admin/operadores-rbac/${idoperador}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_role_id: roleId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al asignar rol');
        return;
      }
      const ops = await cargarOperadores();
      if (ops) setOperadores(ops);
    } catch {
      setError('Error al asignar rol');
    } finally {
      setSavingId(null);
    }
  }

  if (loading) return <PageSpinner />;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            aria-label="Volver"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Roles y permisos
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Definí roles personalizados y asignalos a operadores.
            </p>
          </div>
        </div>
        <Link href="/admin/roles/nuevo">
          <Button size="sm">
            <Plus className="mr-1.5 h-4 w-4" />
            Nuevo rol
          </Button>
        </Link>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          type="button"
          onClick={() => setTab('roles')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'roles'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Shield className="h-4 w-4" />
          Roles ({roles.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('operadores')}
          className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'operadores'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          <Users className="h-4 w-4" />
          Operadores ({operadores.length})
        </button>
      </div>

      {tab === 'roles' ? (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Roles definidos</h2>
          </CardHeader>
          <CardContent className="p-0">
            {roles.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">No hay roles configurados.</p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {roles.map((role) => (
                  <li
                    key={role.id}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {role.nombre}
                        </span>
                        <Badge variant="outline">{role.codigo}</Badge>
                        {role.es_sistema && <Badge variant="info">Sistema</Badge>}
                        {!role.activo && <Badge variant="warning">Inactivo</Badge>}
                      </div>
                      {role.descripcion && (
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                          {role.descripcion}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-400">
                        {role.permisos_count} permisos · {role.operadores_count} operadores
                      </p>
                    </div>
                    <Link href={`/admin/roles/${role.id}`}>
                      <Button size="sm" variant="outline">
                        Editar permisos
                      </Button>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-gray-100">
                Asignación de roles
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Los cambios aplican en el próximo inicio de sesión del operador.
              </p>
            </div>
            <div className="flex w-full flex-col gap-1 sm:max-w-md">
              <label
                htmlFor="filtro-rol"
                className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300"
              >
                <Filter className="h-3.5 w-3.5" />
                Filtrar por rol
              </label>
              <select
                id="filtro-rol"
                value={rolFiltro}
                onChange={(e) => setRolFiltro(e.target.value)}
                className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
              >
                <option value="">Todos los operadores</option>
                <option value="sin">Sin rol asignado</option>
                {roles
                  .filter((r) => r.activo)
                  .map((r) => (
                    <option key={r.id} value={String(r.id)}>
                      {r.nombre}
                    </option>
                  ))}
              </select>
              {rolFiltro && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {operadoresVisibles.length} de {operadores.length} operadores · {rolFiltroLabel}
                </p>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {operadores.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">No hay operadores.</p>
            ) : operadoresVisibles.length === 0 ? (
              <p className="px-5 py-6 text-sm text-gray-500">
                Ningún operador coincide con el rol seleccionado.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {operadoresVisibles.map((op) => (
                  <li
                    key={op.idoperador}
                    className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">
                        {op.nombrecompleto}
                      </p>
                      <p className="text-sm text-gray-500">
                        {op.operador}
                        {op.app_role ? (
                          <span className="text-gray-400"> · {op.app_role.nombre}</span>
                        ) : (
                          <span className="text-gray-400"> · sin rol asignado</span>
                        )}
                        {op.activo !== 'S' && (
                          <Badge variant="warning" className="ml-2">
                            Inactivo
                          </Badge>
                        )}
                      </p>
                    </div>
                    <select
                      value={op.app_role_id ?? ''}
                      disabled={savingId === op.idoperador}
                      onChange={(e) => void asignarRol(op.idoperador, e.target.value)}
                      className="h-10 min-w-[200px] rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                    >
                      <option value="">Sin rol asignado</option>
                      {roles
                        .filter((r) => r.activo)
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.nombre}
                          </option>
                        ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
