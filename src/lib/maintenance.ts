import { createAdminClient } from '@/lib/supabase/server';

export type AppMaintenanceStatus = {
  isActive: boolean;
  updatedAt: string | null;
};

export const MAINTENANCE_ROW_ID = 1;

/**
 * Caché in-memory corto: /api/app-status lo consulta cada cliente cada 15 s (más el sidebar
 * y el login), así que sin esto cada usuario conectado generaba ~4-6 lecturas/min a Supabase.
 * Los endpoints que cambian el modo llaman a `invalidarCacheMantenimiento()`; en otros nodos
 * el cambio se ve a lo sumo con este retraso.
 */
const STATUS_CACHE_TTL_MS = 5_000;
let statusCache: { value: AppMaintenanceStatus; expiresAt: number } | null = null;

export function invalidarCacheMantenimiento(): void {
  statusCache = null;
}

async function leerAppMaintenanceStatus(): Promise<AppMaintenanceStatus> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('modo_mantenimiento')
    .select('is_active, updated_at')
    .eq('id', MAINTENANCE_ROW_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo obtener modo_mantenimiento: ${error.message}`);
  }

  return {
    isActive: Number(data?.is_active ?? 0) === 1,
    updatedAt: typeof data?.updated_at === 'string' ? data.updated_at : null,
  };
}

export async function getAppMaintenanceStatus(opts?: { fresh?: boolean }): Promise<AppMaintenanceStatus> {
  const now = Date.now();
  if (!opts?.fresh && statusCache && statusCache.expiresAt > now) {
    return statusCache.value;
  }
  const value = await leerAppMaintenanceStatus();
  statusCache = { value, expiresAt: now + STATUS_CACHE_TTL_MS };
  return value;
}

/** Guarda el flag y refresca la caché en este proceso. */
export async function setAppMaintenanceActive(isActive: 0 | 1): Promise<{ error: string | null }> {
  const admin = await createAdminClient();
  const now = new Date().toISOString();
  const { error } = await admin
    .from('modo_mantenimiento')
    .upsert({ id: MAINTENANCE_ROW_ID, is_active: isActive, updated_at: now }, { onConflict: 'id' });
  if (error) return { error: error.message };
  statusCache = { value: { isActive: isActive === 1, updatedAt: now }, expiresAt: Date.now() + STATUS_CACHE_TTL_MS };
  return { error: null };
}
