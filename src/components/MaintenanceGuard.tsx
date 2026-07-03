'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 15_000;

type AppStatusResponse = {
  maintenance?: boolean;
};

type MaintenanceCtx = {
  maintenance: boolean;
};

const MaintenanceContext = createContext<MaintenanceCtx>({ maintenance: false });

export function useMaintenanceStatus(): MaintenanceCtx {
  return useContext(MaintenanceContext);
}

export default function MaintenanceGuard({ children }: { children: React.ReactNode }) {
  const [maintenance, setMaintenance] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    async function check() {
      try {
        const res = await fetch('/api/app-status', {
          cache: 'no-store',
          headers: { 'cache-control': 'no-cache' },
        });
        const data = (await res.json().catch(() => ({}))) as AppStatusResponse;
        if (mountedRef.current) {
          setMaintenance(res.ok && data.maintenance === true);
        }
      } catch {
        // Sin conectividad → no bloquear.
      }
    }

    void check();
    const id = window.setInterval(() => void check(), POLL_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      window.clearInterval(id);
    };
  }, []);

  return (
    <MaintenanceContext.Provider value={{ maintenance }}>
      {children}
    </MaintenanceContext.Provider>
  );
}
