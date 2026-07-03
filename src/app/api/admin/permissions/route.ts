import { NextResponse } from 'next/server';
import { requireRolesManageRbac } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/server';
import {
  PERMISSIONS_CATALOG,
  PERMISSION_CATEGORIES,
} from '@/lib/auth/permissions-catalog';

/** GET — catálogo de permisos agrupado por categoría */
export async function GET() {
  const guard = await requireRolesManageRbac();
  if (!guard.ok) return guard.response;

  try {
    const admin = await createAdminClient();

    // Mantener app_permissions alineado con el catálogo en código (nuevos permisos aparecen en roles).
    await admin.from('app_permissions').upsert(
      PERMISSIONS_CATALOG.map((p) => ({
        codigo: p.codigo,
        nombre: p.nombre,
        descripcion: p.descripcion,
        categoria: p.categoria,
        orden: p.orden,
      })),
      { onConflict: 'codigo' }
    );

    const { data: dbPerms, error } = await admin
      .from('app_permissions')
      .select('codigo, nombre, descripcion, categoria, orden')
      .order('orden', { ascending: true });

    if (error) {
      return NextResponse.json({
        data: groupByCategory(PERMISSIONS_CATALOG),
        source: 'catalog',
      });
    }

    const list =
      dbPerms && dbPerms.length > 0
        ? dbPerms.map((p) => ({
            codigo: p.codigo as string,
            nombre: p.nombre as string,
            descripcion: (p.descripcion as string) ?? '',
            categoria: p.categoria as string,
            orden: p.orden as number,
          }))
        : PERMISSIONS_CATALOG;

    return NextResponse.json({
      data: groupByCategory(list),
      categories: PERMISSION_CATEGORIES,
    });
  } catch {
    return NextResponse.json({
      data: groupByCategory(PERMISSIONS_CATALOG),
      categories: PERMISSION_CATEGORIES,
      source: 'catalog',
    });
  }
}

function groupByCategory(
  list: { codigo: string; nombre: string; descripcion: string; categoria: string; orden: number }[],
) {
  const map = new Map<string, typeof list>();
  for (const p of list) {
    const arr = map.get(p.categoria) ?? [];
    arr.push(p);
    map.set(p.categoria, arr);
  }
  return Array.from(map.entries()).map(([categoria, permisos]) => ({
    categoria,
    label: PERMISSION_CATEGORIES[categoria] ?? categoria,
    permisos: permisos.sort((a, b) => a.orden - b.orden),
  }));
}
