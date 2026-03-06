/**
 * Cliente Supabase con service_role para la API Express (sync legacy → Supabase).
 * Usar solo en backend (Node). No exponer SUPABASE_SERVICE_ROLE_KEY al cliente.
 */
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getSupabaseAdmin() {
  if (!url || !serviceRoleKey) {
    throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, serviceRoleKey);
}

module.exports = { getSupabaseAdmin };
