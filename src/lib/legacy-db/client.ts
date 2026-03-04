/**
 * Cliente para la base de datos legacy (sistema de farmacia - SOLO LECTURA).
 *
 * Configurar LEGACY_DB_TYPE en .env.local:
 *   - 'mock'     → datos de prueba estáticos (default)
 *   - 'mssql'    → SQL Server via 'mssql' npm package
 *   - 'postgres' → Postgres via 'pg' npm package
 *
 * Para conectar a SQL Server:
 *   1. npm install mssql @types/mssql
 *   2. Cambiar LEGACY_DB_TYPE=mssql en .env.local
 *   3. Completar LEGACY_DB_HOST, PORT, NAME, USER, PASSWORD
 */

export type LegacyDbType = 'mock' | 'mssql' | 'postgres';

export interface LegacyDbConfig {
  type: LegacyDbType;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  connectionString?: string;
}

export function getLegacyDbConfig(): LegacyDbConfig {
  return {
    type: (process.env.LEGACY_DB_TYPE as LegacyDbType) ?? 'mock',
    host: process.env.LEGACY_DB_HOST,
    port: process.env.LEGACY_DB_PORT ? Number(process.env.LEGACY_DB_PORT) : 1433,
    database: process.env.LEGACY_DB_NAME,
    user: process.env.LEGACY_DB_USER,
    password: process.env.LEGACY_DB_PASSWORD,
    connectionString: process.env.LEGACY_DB_CONNECTION_STRING,
  };
}
