'use client';

import { useEffect, useRef, useState } from 'react';

const COUNTDOWN_SECONDS = 5;
const POLL_INTERVAL_MS = 10000;

type AppStatusResponse = {
  maintenance?: boolean;
};

export default function MaintenanceGuard() {
  const [maintenanceActive, setMaintenanceActive] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SECONDS);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [roleResolved, setRoleResolved] = useState(false);
  const logoutTriggeredRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    async function cargarRol() {
      try {
        const res = await fetch('/api/dashboard', {
          cache: 'no-store',
          headers: { 'cache-control': 'no-cache' },
        });
        const data = await res.json().catch(() => ({}));
        if (!isMounted) return;
        const superadmin = String(data?.data?.rol ?? '').toLowerCase() === 'superadmin';
        setIsSuperadmin(superadmin);
        if (superadmin) {
          setMaintenanceActive(false);
        }
      } catch {
        // Si falla, tratamos como no superadmin para no relajar controles.
      } finally {
        if (isMounted) setRoleResolved(true);
      }
    }

    void cargarRol();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!roleResolved || isSuperadmin) return;

    let isMounted = true;

    async function checkMaintenance() {
      try {
        const res = await fetch('/api/app-status', {
          cache: 'no-store',
          headers: { 'cache-control': 'no-cache' },
        });
        const data = (await res.json().catch(() => ({}))) as AppStatusResponse;
        if (!isMounted) return;
        if (res.ok && data.maintenance === true) {
          setMaintenanceActive(true);
        }
      } catch {
        // Si falla la consulta, no interrumpimos al usuario.
      }
    }

    void checkMaintenance();
    const pollId = window.setInterval(() => void checkMaintenance(), POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(pollId);
    };
  }, [roleResolved, isSuperadmin]);

  useEffect(() => {
    if (isSuperadmin) return;
    if (!maintenanceActive) return;
    if (logoutTriggeredRef.current) return;

    setSecondsLeft(COUNTDOWN_SECONDS);

    const countdownId = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(countdownId);
          logoutTriggeredRef.current = true;
          void fetch('/api/auth/signout', { method: 'POST' }).finally(() => {
            window.location.href = '/login?maintenance=1';
          });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(countdownId);
    };
  }, [maintenanceActive, isSuperadmin]);

  if (!maintenanceActive) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-amber-300 bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-amber-700">Modo mantenimiento activado</h2>
        <p className="mt-2 text-sm text-gray-700">
          La aplicación entró en mantenimiento. Tu sesión se cerrará para evitar inconsistencias.
        </p>
        <p className="mt-3 text-sm font-medium text-gray-900">
          Cierre de sesión automático en {secondsLeft} segundo{secondsLeft === 1 ? '' : 's'}...
        </p>
      </div>
    </div>
  );
}
