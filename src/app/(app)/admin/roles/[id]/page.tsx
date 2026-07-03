'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSpinner } from '@/components/ui/spinner';
import { useAppNotify } from '@/components/notifications/AppNotificationProvider';

interface PermissionGroup {
  categoria: string;
  label: string;
  permisos: { codigo: string; nombre: string; descripcion: string }[];
}

interface RoleDetail {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  es_sistema: boolean;
  activo: boolean;
  permissions: string[];
}

export default function EditarRolPage() {
  const params = useParams();
  const router = useRouter();
  const notify = useAppNotify();
  const roleId = params.id as string;

  const [role, setRole] = useState<RoleDetail | null>(null);
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [roleRes, permRes] = await Promise.all([
        fetch(`/api/admin/roles/${roleId}`),
        fetch('/api/admin/permissions'),
      ]);
      if (roleRes.status === 403) {
        router.replace('/dashboard');
        return;
      }
      const roleJson = await roleRes.json();
      const permJson = await permRes.json();
      if (!roleRes.ok) {
        setError(roleJson.error ?? 'Rol no encontrado');
        return;
      }
      const r = roleJson.data as RoleDetail;
      setRole(r);
      setNombre(r.nombre);
      setDescripcion(r.descripcion ?? '');
      setSelected(new Set(r.permissions ?? []));
      setGroups(permJson.data ?? []);
    } catch {
      setError('Error al cargar el rol');
    } finally {
      setLoading(false);
    }
  }, [roleId, router]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function togglePermission(codigo: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(codigo)) next.delete(codigo);
      else next.add(codigo);
      return next;
    });
  }

  function toggleGroup(codigos: string[]) {
    const allSelected = codigos.every((c) => selected.has(c));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of codigos) {
        if (allSelected) next.delete(c);
        else next.add(c);
      }
      return next;
    });
  }

  async function guardar() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/roles/${roleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre,
          descripcion,
          permissions: Array.from(selected),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al guardar');
        return;
      }
      await cargar();
    } catch {
      setError('Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function eliminar() {
    if (!role || role.es_sistema) return;
    if (!(await notify.confirm({
      title: 'Eliminar rol',
      message: `¿Eliminar el rol "${role.nombre}"?`,
      confirmLabel: 'Eliminar',
      cancelLabel: 'Cancelar',
      variant: 'danger',
    }))) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/roles/${roleId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? 'Error al eliminar');
        return;
      }
      router.push('/admin/roles');
    } catch {
      setError('Error al eliminar');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageSpinner />;
  if (!role) {
    return (
      <p className="text-sm text-red-600">{error || 'Rol no encontrado'}</p>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/admin/roles"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">{role.nombre}</h1>
              <Badge variant="outline">{role.codigo}</Badge>
              {role.es_sistema && <Badge variant="info">Sistema</Badge>}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {selected.size} permisos seleccionados
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => void guardar()} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
          {!role.es_sistema && (
            <Button variant="outline" onClick={() => void eliminar()} disabled={saving}>
              <Trash2 className="mr-1.5 h-4 w-4" />
              Eliminar
            </Button>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Datos</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Nombre</span>
            <Input value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </label>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Descripción</span>
            <Input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-4">
        {groups.map((group) => {
          const codigos = group.permisos.map((p) => p.codigo);
          const allOn = codigos.length > 0 && codigos.every((c) => selected.has(c));
          return (
            <Card key={group.categoria}>
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <h2 className="font-semibold text-gray-900 dark:text-gray-100">{group.label}</h2>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => toggleGroup(codigos)}
                >
                  {allOn ? 'Quitar todos' : 'Seleccionar todos'}
                </Button>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {group.permisos.map((perm) => (
                    <li key={perm.codigo}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-100 p-3 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
                        <input
                          type="checkbox"
                          checked={selected.has(perm.codigo)}
                          onChange={() => togglePermission(perm.codigo)}
                          className="mt-0.5 rounded border-gray-300"
                        />
                        <span>
                          <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                            {perm.nombre}
                          </span>
                          {perm.descripcion && (
                            <span className="block text-xs text-gray-500">{perm.descripcion}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}