import { getLegacyDbConfig } from './client';
import { createAdminClient } from '../supabase/server';

const DEFAULT_SUCURSAL_PASSWORD_HASH =
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh02'; // "sucursal123"

export async function syncSucursalesFromLegacy() {
  const config = getLegacyDbConfig();

  if (config.type === 'mock') {
    return { total: 0, processed: 0, mode: 'mock' as const };
  }

  if (config.type === 'mssql') {
    return mssqlSyncSucursales(config);
  }

  if (config.type === 'postgres') {
    return postgresSyncSucursales(config);
  }

  return { total: 0, processed: 0, mode: config.type };
}

export async function syncMedicamentosFromLegacy() {
  const config = getLegacyDbConfig();

  if (config.type === 'mock') {
    return { total: 0, processed: 0, mode: 'mock' as const };
  }

  if (config.type === 'mssql') {
    return mssqlSyncMedicamentos(config);
  }

  if (config.type === 'postgres') {
    return postgresSyncMedicamentos(config);
  }

  return { total: 0, processed: 0, mode: config.type };
}

async function mssqlSyncSucursales(config: ReturnType<typeof getLegacyDbConfig>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sql = require('mssql');
  const pool = await sql.connect({
    server: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const result = await pool.request().query(`
    SELECT
      Sucursal,
      NombreFantasia,
      Domicilio,
      Telefono,
      Email,
      _CodPostal
    FROM sucursales
  `);

  const rows = result.recordset ?? [];
  const admin = await createAdminClient();

  let processed = 0;
  for (const r of rows) {
    const codigoInterno = String(r.Sucursal);
    const ubicacion =
      r._CodPostal != null && r._CodPostal !== ''
        ? `${r.Domicilio} (CP ${r._CodPostal})`
        : r.Domicilio;

    const { data: existente } = await admin
      .from('sucursales')
      .select('id, password_hash')
      .eq('codigo_interno', codigoInterno)
      .maybeSingle();

    const passwordHash =
      existente?.password_hash ?? DEFAULT_SUCURSAL_PASSWORD_HASH;

    const { error } = await admin
      .from('sucursales')
      .upsert(
        {
          codigo_interno: codigoInterno,
          nombre: r.NombreFantasia,
          ubicacion,
          telefono: r.Telefono ?? null,
          email: r.Email ?? null,
          cod_postal: r._CodPostal ?? null,
          password_hash: passwordHash,
          activa: true,
        },
        { onConflict: 'codigo_interno' }
      );

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[syncSucursalesFromLegacy] Error upsert sucursal', codigoInterno, error.message);
      continue;
    }

    processed += 1;
  }

  return { total: rows.length, processed, mode: 'mssql' as const };
}

async function postgresSyncSucursales(config: ReturnType<typeof getLegacyDbConfig>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.connectionString });

  const { rows } = await pool.query(`
    SELECT
      "Sucursal",
      "NombreFantasia",
      "Domicilio",
      "Telefono",
      "Email",
      "_CodPostal"
    FROM sucursales
  `);

  const admin = await createAdminClient();

  let processed = 0;
  for (const r of rows) {
    const codigoInterno = String(r.Sucursal);
    const ubicacion =
      r._CodPostal != null && r._CodPostal !== ''
        ? `${r.Domicilio} (CP ${r._CodPostal})`
        : r.Domicilio;

    const { data: existente } = await admin
      .from('sucursales')
      .select('id, password_hash')
      .eq('codigo_interno', codigoInterno)
      .maybeSingle();

    const passwordHash =
      existente?.password_hash ?? DEFAULT_SUCURSAL_PASSWORD_HASH;

    const { error } = await admin
      .from('sucursales')
      .upsert(
        {
          codigo_interno: codigoInterno,
          nombre: r.NombreFantasia,
          ubicacion,
          telefono: r.Telefono ?? null,
          email: r.Email ?? null,
          cod_postal: r._CodPostal ?? null,
          password_hash: passwordHash,
          activa: true,
        },
        { onConflict: 'codigo_interno' }
      );

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[syncSucursalesFromLegacy] Error upsert sucursal', codigoInterno, error.message);
      continue;
    }

    processed += 1;
  }

  return { total: rows.length, processed, mode: 'postgres' as const };
}

async function mssqlSyncMedicamentos(config: ReturnType<typeof getLegacyDbConfig>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sql = require('mssql');
  const pool = await sql.connect({
    server: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const result = await pool.request().query(`
    SELECT
      CodPlex,
      Troquel,
      codebar,
      Producto,
      Presentaci,
      CodRubro,
      Refrigeracion
    FROM medicamentos
  `);

  const rows = result.recordset ?? [];
  const admin = await createAdminClient();

  let processed = 0;
  for (const r of rows) {
    const { error } = await admin
      .from('productos_cache')
      .upsert(
        {
          producto_id_sistema: String(r.CodPlex),
          codigo_barras: r.codebar,
          descripcion: r.Producto,
          presentacion: r.Presentaci ?? null,
          laboratorio: null,
          troquel: r.Troquel ?? null,
          cod_rubro: r.CodRubro ?? null,
          refrigeracion: Boolean(r.Refrigeracion),
        },
        { onConflict: 'producto_id_sistema' }
      );

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[syncMedicamentosFromLegacy] Error upsert producto', r.CodPlex, error.message);
      continue;
    }

    processed += 1;
  }

  return { total: rows.length, processed, mode: 'mssql' as const };
}

async function postgresSyncMedicamentos(config: ReturnType<typeof getLegacyDbConfig>) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: config.connectionString });

  const { rows } = await pool.query(`
    SELECT
      "CodPlex",
      "Troquel",
      "codebar",
      "Producto",
      "Presentaci",
      "CodRubro",
      "Refrigeracion"
    FROM medicamentos
  `);

  const admin = await createAdminClient();

  let processed = 0;
  for (const r of rows) {
    const { error } = await admin
      .from('productos_cache')
      .upsert(
        {
          producto_id_sistema: String(r.CodPlex),
          codigo_barras: r.codebar,
          descripcion: r.Producto,
          presentacion: r.Presentaci ?? null,
          laboratorio: null,
          troquel: r.Troquel ?? null,
          cod_rubro: r.CodRubro ?? null,
          refrigeracion: Boolean(r.Refrigeracion),
        },
        { onConflict: 'producto_id_sistema' }
      );

    if (error) {
      // eslint-disable-next-line no-console
      console.error('[syncMedicamentosFromLegacy] Error upsert producto', r.CodPlex, error.message);
      continue;
    }

    processed += 1;
  }

  return { total: rows.length, processed, mode: 'postgres' as const };
}

