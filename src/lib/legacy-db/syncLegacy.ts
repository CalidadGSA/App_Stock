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
      CodLab,
      codebar,
      codebar2,
      codebar3,
      codebar4,
      Producto,
      Presentaci,
      Precio,
      Costo,
      Activo,
      cod_rubro,
      IDSubrubro,
      IDPsicofarmaco,
      visible,
      Refrigeracion,
      Fraccionable,
      FechaModificacion
    FROM medicamentos
    WHERE FechaModificacion >= '2025-01-01 00:00:00'
  `);

  const rows = result.recordset ?? [];
  const admin = await createAdminClient();

  let processed = 0;
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map((r: Record<string, unknown>) => ({
      CodPlex: Number(r.CodPlex),
      Troquel: r.Troquel != null ? Number(r.Troquel) : null,
      CodLab: r.CodLab != null ? Number(r.CodLab) : null,
      codebar: r.codebar ?? null,
      codebar2: r.codebar2 ?? null,
      codebar3: r.codebar3 ?? null,
      codebar4: r.codebar4 ?? null,
      Producto: r.Producto ?? null,
      Presentaci: r.Presentaci ?? null,
      Precio: r.Precio != null ? Number(r.Precio) : null,
      Costo: r.Costo != null ? Number(r.Costo) : null,
      Activo: r.Activo ?? null,
      cod_rubro: r.cod_rubro != null ? Number(r.cod_rubro) : 0,
      IDSubrubro: r.IDSubrubro != null ? Number(r.IDSubrubro) : null,
      IDPsicofarmaco: r.IDPsicofarmaco ?? null,
      visible: r.visible != null ? Number(r.visible) : null,
      Refrigeracion: r.Refrigeracion ?? null,
      Fraccionable: r.Fraccionable != null ? Number(r.Fraccionable) : null,
      actualizado: r.FechaModificacion ? new Date(r.FechaModificacion as string).toISOString() : new Date().toISOString(),
    }));

    const { error } = await admin
      .from('medicamentos')
      .upsert(batch, { onConflict: 'CodPlex' });

    if (error) {
      console.error('[syncMedicamentosFromLegacy] Error upsert batch', i, error.message);
      continue;
    }

    processed += batch.length;
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
      "CodLab",
      "codebar",
      "codebar2",
      "codebar3",
      "codebar4",
      "Producto",
      "Presentaci",
      "Precio",
      "Costo",
      "Activo",
      "cod_rubro",
      "IDSubrubro",
      "IDPsicofarmaco",
      "visible",
      "Refrigeracion",
      "Fraccionable",
      "FechaModificacion"
    FROM medicamentos
    WHERE "FechaModificacion" >= '2025-01-01 00:00:00'
  `);

  const admin = await createAdminClient();

  let processed = 0;
  const batchSize = 500;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize).map((r: Record<string, unknown>) => ({
      CodPlex: Number(r.CodPlex),
      Troquel: r.Troquel != null ? Number(r.Troquel) : null,
      CodLab: r.CodLab != null ? Number(r.CodLab) : null,
      codebar: r.codebar ?? null,
      codebar2: r.codebar2 ?? null,
      codebar3: r.codebar3 ?? null,
      codebar4: r.codebar4 ?? null,
      Producto: r.Producto ?? null,
      Presentaci: r.Presentaci ?? null,
      Precio: r.Precio != null ? Number(r.Precio) : null,
      Costo: r.Costo != null ? Number(r.Costo) : null,
      Activo: r.Activo ?? null,
      cod_rubro: r.cod_rubro != null ? Number(r.cod_rubro) : 0,
      IDSubrubro: r.IDSubrubro != null ? Number(r.IDSubrubro) : null,
      IDPsicofarmaco: r.IDPsicofarmaco ?? null,
      visible: r.visible != null ? Number(r.visible) : null,
      Refrigeracion: r.Refrigeracion ?? null,
      Fraccionable: r.Fraccionable != null ? Number(r.Fraccionable) : null,
      actualizado: r.FechaModificacion ? new Date(r.FechaModificacion as string).toISOString() : new Date().toISOString(),
    }));

    const { error } = await admin
      .from('medicamentos')
      .upsert(batch, { onConflict: 'CodPlex' });

    if (error) {
      console.error('[syncMedicamentosFromLegacy] Error upsert batch', i, error.message);
      continue;
    }

    processed += batch.length;
  }

  return { total: rows.length, processed, mode: 'postgres' as const };
}

