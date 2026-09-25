import { getOperadorSession } from '@/lib/auth/session';
import {
  fichaPadronAProductoLegacy,
  getProductoPadronByBarcode,
  getProductoPadronById,
  padronProductosDisponible,
  resolverStockLegacy,
} from '@/lib/padron-productos-lookup';
import {
  fichaQuantioAProductoLegacy,
  getProductoQuantioByBarcode,
  quantioProductosDisponible,
  resolverStockQuantio,
} from '@/lib/quantio-productos-lookup';
import { createAdminClient } from '@/lib/supabase/server';
import { esSesionDrogueria } from '@/lib/sucursales/sesion-drogueria';
import { enriquecerFichaConUbicacionDrogueria } from '@/lib/inventario/base-productos-drogueria';
import { getProductoIdPorCodebarOnze } from '@/lib/legacy-db/onze-medicamentos';
import { NextRequest, NextResponse } from 'next/server';
import { getSucursalIdSesion } from '@/lib/sucursales/sucursal-session';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ barcode: string }> }
) {
  const operador = await getOperadorSession();
  if (!operador) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  const allowMissingStock =
    request.nextUrl.searchParams.get('allow_missing_stock') === '1';

  const { barcode } = await params;
  const admin = await createAdminClient();
  const esDrogueria = await esSesionDrogueria();

  if (esDrogueria) {
    if (!(await quantioProductosDisponible(admin))) {
      return NextResponse.json(
        { error: 'Catálogo Quantio (droguería) no configurado' },
        { status: 503 }
      );
    }

    let ficha = await getProductoQuantioByBarcode(admin, barcode);
    if (!ficha) {
      return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
    }
    ficha = await enriquecerFichaConUbicacionDrogueria(admin, ficha);

    const stockRes = await resolverStockQuantio(
      ficha.producto_id_sistema,
      allowMissingStock
    );
    if (!stockRes.ok) {
      return NextResponse.json(
        {
          error:
            'No se pudo consultar el stock de Quantio en este momento. Volvé a intentar.',
        },
        { status: 503 }
      );
    }

    const producto = fichaQuantioAProductoLegacy(ficha, stockRes.stock);
    return NextResponse.json({ data: producto });
  }

  if (!padronProductosDisponible()) {
    return NextResponse.json(
      { error: 'Base padrón (abastecimiento) no configurada' },
      { status: 503 }
    );
  }

  let ficha = await getProductoPadronByBarcode(barcode);

  if (!ficha) {
    const idPorCodebar = await getProductoIdPorCodebarOnze(barcode);
    if (idPorCodebar != null) {
      ficha = await getProductoPadronById(idPorCodebar);
    }
  }

  if (!ficha) {
    return NextResponse.json({ error: 'Producto no encontrado' }, { status: 404 });
  }

  const sucursalId = await getSucursalIdSesion();

  const stockRes = await resolverStockLegacy(
    sucursalId,
    ficha.producto_id_sistema,
    allowMissingStock
  );

  if (!stockRes.ok) {
    const msgPorReason: Record<typeof stockRes.reason, string> = {
      no_sucursal:
        'No hay sucursal en la sesión. Cerrá sesión y volvé a ingresar eligiendo sucursal.',
      bad_ids: 'Id de producto o sucursal inválido para consultar stock.',
      unconfigured:
        'MySQL Onze no está configurado en este entorno (faltan ONZE_DB_HOST / USER / PASSWORD / NAME).',
      timeout:
        'Timeout consultando stock en MySQL Onze. Revisá que el servidor de la app pueda llegar a ONZE_DB_HOST.',
      unavailable:
        'No se pudo conectar a MySQL Onze desde este servidor. En local suele ser la LAN (192.168.x); en producción ONZE_DB_HOST tiene que ser alcanzable desde el host del deploy.',
      error: 'Error inesperado consultando stock del sistema.',
    };
    return NextResponse.json(
      {
        error: msgPorReason[stockRes.reason],
        reason: stockRes.reason,
        ...(stockRes.detail ? { detail: stockRes.detail } : {}),
      },
      { status: 503 }
    );
  }

  const producto = fichaPadronAProductoLegacy(ficha, stockRes.stock);
  return NextResponse.json({ data: producto });
}
