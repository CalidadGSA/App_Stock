import { createHmac, timingSafeEqual } from 'crypto';

type Payload = { a: 'on' | 'off'; exp: number };

function getSecret(): string | null {
  const s = process.env.MAINTENANCE_QUICK_ACTION_SECRET?.trim();
  return s && s.length >= 16 ? s : null;
}

export function canSignMaintenanceQuickAction(): boolean {
  return getSecret() != null;
}

export function signMaintenanceQuickAction(action: 'on' | 'off'): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const exp = Date.now() + 7 * 86400000;
  const payload = JSON.stringify({ a: action, exp } satisfies Payload);
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return Buffer.from(payload, 'utf8').toString('base64url') + '.' + sig;
}

export function verifyMaintenanceQuickAction(
  token: string
): { ok: true; action: 'on' | 'off' } | { ok: false; reason: string } {
  const secret = getSecret();
  if (!secret) return { ok: false, reason: 'secret' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'format' };
  const [encPayload, sig] = parts;
  if (!encPayload || !sig) return { ok: false, reason: 'format' };
  let payload: string;
  try {
    payload = Buffer.from(encPayload, 'base64url').toString('utf8');
  } catch {
    return { ok: false, reason: 'payload' };
  }
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const aBuf = Buffer.from(sig);
  const bBuf = Buffer.from(expected);
  if (aBuf.length !== bBuf.length || !timingSafeEqual(aBuf, bBuf)) {
    return { ok: false, reason: 'sig' };
  }
  let parsed: Payload;
  try {
    parsed = JSON.parse(payload) as Payload;
  } catch {
    return { ok: false, reason: 'json' };
  }
  if (parsed.exp < Date.now()) return { ok: false, reason: 'exp' };
  if (parsed.a !== 'on' && parsed.a !== 'off') return { ok: false, reason: 'action' };
  return { ok: true, action: parsed.a };
}
