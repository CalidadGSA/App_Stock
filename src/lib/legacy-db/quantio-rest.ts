/**
 * Cliente Quantio REST (wsquantiorest) — stock en vivo de droguería (plexdr).
 *
 * Env:
 *   QUANTIO_REST_URL       ej. http://santaana.quantio.com.ar:8081/wsquantiorest
 *   QUANTIO_REST_USER      Userweb (Basic Auth)
 *   QUANTIO_REST_PASSWORD  Pass
 *   QUANTIO_REST_SUCURSAL  default "1" (única droguería / depósito 1)
 */

export type StockQuantioRest = {
  stock_cajas: number;
  stock_unidades: number;
  unidades_por_caja: number;
  stock_sistema: number;
};

export function isQuantioRestConfigured(): boolean {
  return Boolean(
    process.env.QUANTIO_REST_URL &&
      process.env.QUANTIO_REST_USER &&
      process.env.QUANTIO_REST_PASSWORD
  );
}

function authHeader(): string {
  const user = process.env.QUANTIO_REST_USER ?? '';
  const pass = process.env.QUANTIO_REST_PASSWORD ?? '';
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function baseUrl(): string {
  return String(process.env.QUANTIO_REST_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
}

function sucursalQuantio(): string {
  const s = String(process.env.QUANTIO_REST_SUCURSAL ?? '1').trim();
  return s || '1';
}

type QuantioPostResponse = {
  response?: {
    respcode?: string | number;
    respmsg?: string;
    content?: {
      productos?: Array<{
        id?: string | number;
        stock?: string | number;
        minimo?: string | number;
        critico?: string | number;
        maximo?: string | number;
      }>;
    };
  };
};

function stockCero(): StockQuantioRest {
  return {
    stock_cajas: 0,
    stock_unidades: 0,
    unidades_por_caja: 1,
    stock_sistema: 0,
  };
}

/** Quantio no tiene fila de stock → respcode 1 + mensaje de “sin resultado”. */
function esRespuestaSinStockQuantio(code: string, respmsg: string): boolean {
  if (code !== '1') return false;
  const msg = respmsg.toLowerCase();
  return (
    msg.includes('no se encontró') ||
    msg.includes('no se encontro') ||
    msg.includes('ningún resultado') ||
    msg.includes('ningun resultado') ||
    msg.includes('sin resultado') ||
    msg.includes('sin stock') ||
    msg.includes('no existe')
  );
}

/**
 * CONSULTAR_STOCK (POST) — stock en vivo por idproducto en sucursal/depósito Quantio.
 * Droguería trabaja solo por cajas: `stock` → cajas; unidades sueltas siempre 0.
 */
export async function getStockQuantioRestByProductoId(
  productoId: number
): Promise<{ ok: true; stock: StockQuantioRest } | { ok: false; error: string }> {
  if (!isQuantioRestConfigured()) {
    return { ok: false, error: 'QUANTIO_REST_* no configurado' };
  }
  if (!Number.isFinite(productoId) || productoId <= 0) {
    return { ok: false, error: 'producto_id inválido' };
  }

  const url = baseUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request: {
          type: 'CONSULTAR_STOCK',
          content: {
            sucursal: sucursalQuantio(),
            productos: String(productoId),
          },
        },
      }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `Quantio REST HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }

    const json = (await res.json()) as QuantioPostResponse;
    const resp = json.response;
    const code = String(resp?.respcode ?? '');
    const respmsg = String(resp?.respmsg ?? '').trim();

    // Sin fila de stock / stock 0: Quantio suele devolver respcode=1
    // "No se encontró ningún resultado" en lugar de stock=0.
    if (code !== '0') {
      if (esRespuestaSinStockQuantio(code, respmsg)) {
        return { ok: true, stock: stockCero() };
      }
      return {
        ok: false,
        error: `Quantio REST respcode=${code}: ${respmsg || 'error'}`,
      };
    }

    const productos = resp?.content?.productos ?? [];
    const row =
      productos.find((p) => Number(p.id) === productoId) ?? productos[0] ?? null;

    // Sin fila: stock en vivo = 0 (producto sin existencia en esa sucursal).
    if (!row) {
      return { ok: true, stock: stockCero() };
    }

    const stockRaw = Number(row.stock ?? 0);
    const cajas = Number.isFinite(stockRaw) ? stockRaw : 0;

    return {
      ok: true,
      stock: {
        stock_cajas: cajas,
        stock_unidades: 0,
        unidades_por_caja: 1,
        stock_sistema: cajas,
      },
    };
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.name === 'AbortError'
          ? 'Timeout consultando Quantio REST'
          : e.message
        : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
