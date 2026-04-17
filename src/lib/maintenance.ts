import { createAdminClient } from '@/lib/supabase/server';

export type AppMaintenanceStatus = {
  isActive: boolean;
  updatedAt: string | null;
};

const MAINTENANCE_ROW_ID = 1;

export async function getAppMaintenanceStatus(): Promise<AppMaintenanceStatus> {
  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('app_frontend_status')
    .select('is_active, updated_at')
    .eq('id', MAINTENANCE_ROW_ID)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo obtener app_frontend_status: ${error.message}`);
  }

  return {
    isActive: Number(data?.is_active ?? 0) === 1,
    updatedAt: typeof data?.updated_at === 'string' ? data.updated_at : null,
  };
}
