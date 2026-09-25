import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Llamado desde Server Component; el middleware refresca la sesión.
          }
        },
      },
    }
  );
}

type AdminClient = import('@supabase/supabase-js').SupabaseClient;

// Singleton: el cliente service_role es stateless (sin sesión de usuario), así que
// crear uno por llamada (~80 call sites, varios por request) solo suma overhead.
declare const globalThis: { __supabaseAdminClient?: AdminClient };

/** Cliente con service_role: bypassa RLS, solo usar en server-side. */
export async function createAdminClient(): Promise<AdminClient> {
  if (globalThis.__supabaseAdminClient) return globalThis.__supabaseAdminClient;
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  globalThis.__supabaseAdminClient = client;
  return client;
}
