/** Heartbeat de presencia: ping cada 60s, online si hubo actividad en los últimos 3 min. */

export const PRESENCE_PING_INTERVAL_MS = 60_000;
export const PRESENCE_ONLINE_THRESHOLD_MS = 180_000;
export const PRESENCE_ADMIN_POLL_INTERVAL_MS = 30_000;

export function presenceOnlineSinceIso(nowMs = Date.now()): string {
  return new Date(nowMs - PRESENCE_ONLINE_THRESHOLD_MS).toISOString();
}
