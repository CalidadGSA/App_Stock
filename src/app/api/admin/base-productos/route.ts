import { NextRequest, NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/rbac';
import { createAdminClient } from '@/lib/supabase/server';
import { SUCURSAL_ID_DROGUERIA } from '@/lib/sucursales/drogueria';
import {
  esSucursalVisibleEnLogin,
  filtrarSucursalesVisiblesLogin,
} from '@/lib/sucursales/login-sucursales';
import { fechaHoyArgentinaYmd } from '@/lib/utils';
import { contarDiasHabiles } from '@/lib/fechas/feriados-argentina';
import {
  rangoCalendarioCuatrimestre,
  type Cuatrimestre,
} from '@/lib/inventario/trimestre-periodo';
import {
  etiquetaTrimestre,
  iniciarGeneracion,
  leerBaseExistente,
  progresoGeneracion,
} from '@/lib/inventario/generar-base/job';

export const dynamic = 'force-dynamic';

const PERMISO = 'admin.base_productos';

function esCuatrimestre(valor: unknown): valor is Cuatrimestre {
  return valor === 1 || valor === 2 || valor === 3 || valor === 4;
}

/** Trimestre que viene, que es el que se suele generar. */
function trimestreSugerido(): { anio: number; cuatrimestre: Cuatrimestre } {
  const hoy = fechaHoyArgentinaYmd();
  const anio = parseInt(hoy.slice(0, 4), 10);
  const mes = parseInt(hoy.slice(5, 7), 10);
  const actual = Math.ceil(mes / 3);
  if (actual === 4) return { anio: anio + 1, cuatrimestre: 1 };
  return { anio, cuatrimestre: (actual + 1) as Cuatrimestre };
}

/** GET — estado del job, sucursales disponibles y trimestre sugerido. */
export async function GET() {
  const guard = await requirePermission(PERMISO);
  if (!guard.ok) return guard.response;

  const admin = await createAdminClient();
  const { data, error } = await admin
    .from('sucursales')
    .select('sucursal, nombrefantasia, activa')
    .order('sucursal');

  if (error) {
    return NextResponse.json({ error: `No se pudieron leer las sucursales: ${error.message}` }, { status: 500 });
  }

  // Las que no aparecen en el login tampoco se inventarían, así que no se ofrecen.
  const sucursales = filtrarSucursalesVisiblesLogin(
    (data ?? []) as Array<{ sucursal: number; nombrefantasia: string | null; activa: boolean | null }>
  ).map((s) => {
    return {
      sucursal: Number(s.sucursal),
      nombre: String(s.nombrefantasia ?? `Sucursal ${s.sucursal}`),
      activa: Boolean(s.activa),
      es_drogueria: Number(s.sucursal) === SUCURSAL_ID_DROGUERIA,
    };
  });

  return NextResponse.json({
    progreso: progresoGeneracion(),
    sucursales,
    sugerido: trimestreSugerido(),
  });
}

/** POST — arranca la generación en segundo plano. */
export async function POST(request: NextRequest) {
  const guard = await requirePermission(PERMISO);
  if (!guard.ok) return guard.response;

  let body: {
    anio?: unknown;
    cuatrimestre?: unknown;
    sucursales?: unknown;
    reemplazar?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 });
  }

  const anio = Number(body.anio);
  const cuatrimestre = Number(body.cuatrimestre);

  if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) {
    return NextResponse.json({ error: 'Año inválido' }, { status: 400 });
  }
  if (!esCuatrimestre(cuatrimestre)) {
    return NextResponse.json({ error: 'Trimestre inválido (1 a 4)' }, { status: 400 });
  }

  const sucursales = Array.isArray(body.sucursales)
    ? Array.from(
        new Set(
          body.sucursales
            .map((s) => Number(s))
            .filter((s) => Number.isInteger(s) && s > 0)
        )
      ).sort((a, b) => a - b)
    : [];

  if (sucursales.length === 0) {
    return NextResponse.json({ error: 'Elegí al menos una sucursal' }, { status: 400 });
  }

  const fueraDeLogin = sucursales.filter((s) => !esSucursalVisibleEnLogin(s));
  if (fueraDeLogin.length > 0) {
    return NextResponse.json(
      {
        error: `Estas sucursales no están habilitadas en el login, así que no se les genera base: ${fueraDeLogin.join(', ')}.`,
      },
      { status: 400 }
    );
  }

  const reemplazar = Boolean(body.reemplazar);
  const trimestre = etiquetaTrimestre(anio, cuatrimestre);

  // No pisar una base en uso sin confirmación explícita.
  const existente = await leerBaseExistente(anio, cuatrimestre, sucursales);
  if (existente.total > 0 && !reemplazar) {
    return NextResponse.json(
      {
        error: `Ya hay una base cargada para ${trimestre}.`,
        requiere_confirmacion: true,
        existente,
      },
      { status: 409 }
    );
  }

  const operador = guard.ctx.operador.nombrecompleto || guard.ctx.operador.operador;
  const inicio = iniciarGeneracion({ anio, cuatrimestre, sucursales, reemplazar }, operador);

  if (!inicio.ok) {
    return NextResponse.json({ error: inicio.error, progreso: inicio.progreso }, { status: 409 });
  }

  const { fecha_inicio, fecha_fin } = rangoCalendarioCuatrimestre(anio, cuatrimestre);

  return NextResponse.json(
    {
      ok: true,
      progreso: inicio.progreso,
      trimestre,
      fecha_inicio,
      fecha_fin,
      dias_habiles: contarDiasHabiles(fecha_inicio, fecha_fin),
      reemplazo: existente.total,
    },
    { status: 202 }
  );
}
