'use client';

import { useEffect } from 'react';
import { PRESENCE_PING_INTERVAL_MS } from '@/lib/auth/presence';

/**
 * Envía heartbeat mientras la pestaña está visible.
 * No pings en background: al volver a la pestaña pings de inmediato.
 */
export default function PresenceHeartbeat() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    let intervalId: number | null = null;

    async function ping() {
      if (cancelled) return;
      if (document.visibilityState === 'hidden') return;
      try {
        await fetch('/api/presence/ping', {
          method: 'POST',
          keepalive: true,
        });
      } catch {
        // Silencioso: el contador simplemente no actualizará.
      }
    }

    function startInterval() {
      if (intervalId != null) return;
      intervalId = window.setInterval(() => void ping(), PRESENCE_PING_INTERVAL_MS);
    }

    function stopInterval() {
      if (intervalId == null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    }

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        void ping();
        startInterval();
      } else {
        stopInterval();
      }
    }

    void ping();
    startInterval();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      stopInterval();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
