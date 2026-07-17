/**
 * Cliente HTTP de la API PlexDR (corre en la red de droguería + ngrok).
 *
 * Env:
 *   PLEXDR_API_URL      ej. https://xxxx.ngrok-free.app  (sin slash final)
 *   PLEXDR_API_USER     basic auth
 *   PLEXDR_API_PASSWORD basic auth
 */

export type StockPlexdr = {
  stock_cajas: number;
  stock_unidades: number;
  unidades_por_caja: number;
  stock_sistema: number;
};

export function isPlexdrApiConfigured(): boolean {
  return Boolean(
    process.env.PLEXDR_API_URL &&
      process.env.PLEXDR_API_USER &&
      process.env.PLEXDR_API_PASSWORD
  );
}

function authHeader(): string {
  const user = process.env.PLEXDR_API_USER ?? '';
  const pass = process.env.PLEXDR_API_PASSWORD ?? '';
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

function baseUrl(): string {
  return String(process.env.PLEXDR_API_URL ?? '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * Stock en vivo de un producto vía API PlexDR (HTTP/ngrok).
 * Requiere que la API soporte ?producto_id= (versión actualizada de api_plexdr.py).
 */
export async function getStockPlexdrByProductoId(
  productoId: number
): Promise<{ ok: true; stock: StockPlexdr } | { ok: false; error: string }> {
  if (!isPlexdrApiConfigured()) {
    return { ok: false, error: 'PLEXDR_API_* no configurado' };
  }
  if (!Number.isFinite(productoId) || productoId <= 0) {
    return { ok: false, error: 'producto_id inválido' };
  }

  const url = `${baseUrl()}/stock_drogueria?producto_id=${encodeURIComponent(String(productoId))}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
        // ngrok free a veces muestra interstitial HTML sin este header
        'ngrok-skip-browser-warning': '1',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `PlexDR HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      };
    }

    const json = (await res.json()) as {
      status?: string;
      data?: Array<{
        producto_id?: number;
        cantidad_drogueria?: number;
        unidades_drogueria?: number;
        unidades_por_caja?: number;
      }>;
      detalle?: string;
    };

    if (json.status !== 'ok') {
      return { ok: false, error: json.detalle ?? 'Respuesta PlexDR inválida' };
    }

    const rows = Array.isArray(json.data) ? json.data : [];
    let cajas = 0;
    let unidades = 0;
    let upc = 1;
    for (const r of rows) {
      cajas += Number(r.cantidad_drogueria ?? 0) || 0;
      unidades += Number(r.unidades_drogueria ?? 0) || 0;
      const u = Number(r.unidades_por_caja ?? 0);
      if (Number.isFinite(u) && u > 0) upc = u;
    }

    return {
      ok: true,
      stock: {
        stock_cajas: cajas,
        stock_unidades: unidades,
        unidades_por_caja: upc,
        stock_sistema: cajas * upc + unidades,
      },
    };
  } catch (e) {
    const msg =
      e instanceof Error
        ? e.name === 'AbortError'
          ? 'Timeout consultando PlexDR'
          : e.message
        : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}
