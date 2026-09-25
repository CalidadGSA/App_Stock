/**
 * Límite de intentos de login fallidos, en memoria (la app corre en un solo proceso PM2).
 * El código de operador es numérico y corto, así que sin esto la fuerza bruta es barata.
 *
 * Dos contadores independientes en ventana deslizante:
 *  - por IP (frena a un atacante contra muchos operadores),
 *  - por operador (frena a muchas IPs contra un mismo operador).
 * Un login exitoso limpia ambos. Configurable por env (LOGIN_RATE_LIMIT_*).
 */

function readEnvInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const VENTANA_MS = readEnvInt('LOGIN_RATE_LIMIT_WINDOW_SEC', 15 * 60) * 1000;
const MAX_POR_IP = readEnvInt('LOGIN_RATE_LIMIT_MAX_PER_IP', 30);
const MAX_POR_OPERADOR = readEnvInt('LOGIN_RATE_LIMIT_MAX_PER_OPERADOR', 10);

type Registro = { fallos: number[] };

declare const globalThis: {
  __loginRateLimit?: { porIp: Map<string, Registro>; porOperador: Map<string, Registro> };
};

function stores() {
  if (!globalThis.__loginRateLimit) {
    globalThis.__loginRateLimit = { porIp: new Map(), porOperador: new Map() };
  }
  return globalThis.__loginRateLimit;
}

function podar(reg: Registro | undefined, ahora: number): number[] {
  if (!reg) return [];
  reg.fallos = reg.fallos.filter((t) => ahora - t < VENTANA_MS);
  return reg.fallos;
}

function limpiarVencidos(map: Map<string, Registro>, ahora: number) {
  // Evita que el Map crezca sin límite con IPs/operadores que nunca vuelven.
  if (map.size < 5000) return;
  for (const [k, reg] of map) {
    if (podar(reg, ahora).length === 0) map.delete(k);
  }
}

export type ResultadoRateLimit = { ok: true } | { ok: false; retryAfterSec: number };

function evaluar(fallos: number[], max: number, ahora: number): number | null {
  if (fallos.length < max) return null;
  const masViejo = fallos[fallos.length - max]!;
  return Math.max(1, Math.ceil((masViejo + VENTANA_MS - ahora) / 1000));
}

export function verificarRateLimitLogin(params: { ip: string; operador: string }): ResultadoRateLimit {
  const { porIp, porOperador } = stores();
  const ahora = Date.now();
  const ip = params.ip || 'unknown';
  const op = params.operador.trim().toUpperCase();

  const esperaIp = evaluar(podar(porIp.get(ip), ahora), MAX_POR_IP, ahora);
  const esperaOp = op ? evaluar(podar(porOperador.get(op), ahora), MAX_POR_OPERADOR, ahora) : null;
  const espera = Math.max(esperaIp ?? 0, esperaOp ?? 0);
  if (espera > 0) return { ok: false, retryAfterSec: espera };
  return { ok: true };
}

export function registrarIntentoLogin(params: { ip: string; operador: string; exito: boolean }): void {
  const { porIp, porOperador } = stores();
  const ahora = Date.now();
  const ip = params.ip || 'unknown';
  const op = params.operador.trim().toUpperCase();

  if (params.exito) {
    porIp.delete(ip);
    if (op) porOperador.delete(op);
    return;
  }

  limpiarVencidos(porIp, ahora);
  limpiarVencidos(porOperador, ahora);
  for (const [map, key] of [
    [porIp, ip],
    [porOperador, op],
  ] as const) {
    if (!key) continue;
    const reg = map.get(key) ?? { fallos: [] };
    podar(reg, ahora);
    reg.fallos.push(ahora);
    map.set(key, reg);
  }
}
