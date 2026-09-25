require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (base externa)
const { getSupabaseAdmin } = require('../../lib/supabaseAdmin'); // Supabase (interna)

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_OPERADORES || '5000', 10);
const OPERADOR_FUENTE_ONZE = 'onze';

function trimOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function isOperadorActivo(activo) {
  return String(activo ?? '').trim().toUpperCase() === 'S';
}

function operadorExUsername(operador, idoperador) {
  return `${operador}__ex${idoperador}`;
}

/**
 * Quién conserva el login ante mismo Operador:
 * 1) activo = S gana sobre N
 * 2) si empatan, gana el id más alto
 */
function debeConservarLogin(candidato, otro) {
  const aActivo = isOperadorActivo(candidato.activo);
  const bActivo = isOperadorActivo(otro.activo);
  if (aActivo !== bActivo) return aActivo;
  return Number(candidato.idoperador) > Number(otro.idoperador);
}

/**
 * Unique (operador, fuente): ante recontratación / duplicado de login,
 * conserva el nombre quien esté activo (S); el otro pasa a Operador__ex{id}.
 */
async function resolveOperadorUsername(supabase, { idoperador, operador, activo }) {
  const desired = trimOrNull(operador);
  if (!desired) {
    throw new Error(`Operador sin nombre de login (idoperador=${idoperador})`);
  }

  const id = Number(idoperador);
  const { data: conflict, error } = await supabase
    .from('operadores')
    .select('idoperador, activo')
    .eq('fuente', OPERADOR_FUENTE_ONZE)
    .eq('operador', desired)
    .neq('idoperador', id)
    .maybeSingle();

  if (error) throw error;
  if (!conflict) return desired;

  const conflictId = Number(conflict.idoperador);
  const self = { idoperador: id, activo };
  const other = { idoperador: conflictId, activo: conflict.activo };

  if (debeConservarLogin(self, other)) {
    const renamed = operadorExUsername(desired, conflictId);
    const { error: renErr } = await supabase
      .from('operadores')
      .update({ operador: renamed })
      .eq('idoperador', conflictId);
    if (renErr) throw renErr;
    console.warn(
      `⚠️ Login duplicado: id ${conflictId} (activo=${conflict.activo}) → ${renamed}; ` +
        `id ${id} (activo=${activo}) conserva ${desired}`
    );
    return desired;
  }

  const renamedSelf = operadorExUsername(desired, id);
  console.warn(
    `⚠️ Login duplicado: id ${id} (activo=${activo}) → ${renamedSelf}; ` +
      `login queda en id ${conflictId} (activo=${conflict.activo})`
  );
  return renamedSelf;
}

/** En un mismo lote MySQL, si se repite Operador: gana activo=S; empate → id más alto. */
function assignUsernamesInBatch(rows) {
  const byName = new Map();
  for (const r of rows) {
    const key = trimOrNull(r.operador);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }

  const out = [];
  for (const [name, group] of byName) {
    const winner = group.reduce((best, r) =>
      debeConservarLogin(r, best) ? r : best
    );
    const winnerId = Number(winner.idoperador);
    for (const r of group) {
      const id = Number(r.idoperador);
      out.push({
        ...r,
        operador: id === winnerId ? name : operadorExUsername(name, id),
        fuente: OPERADOR_FUENTE_ONZE,
      });
    }
  }
  return out;
}

/* ======================================================
   🧠 ESTADO GLOBAL SYNC operadores
====================================================== */
let syncOperadoresState = {
  entity: 'operadores',
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

/**
 * Sincroniza operadores desde la base externa (MySQL) hacia Supabase.
 * Soporta modos:
 *  - ALL  → todos los registros
 *  - LAST → últimos N registros según IDOperador
 */
async function syncOperadoresLegacyToSupabase({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncOperadoresLegacyToSupabase llamado con dbType !== mysql, se omite.');
    return { processed: 0, total: 0, duration: 0 };
  }

  const supabase = getSupabaseAdmin();

  const requestedMode = (mode || process.env.SYNC_MODE || 'ALL').toUpperCase();
  let SYNC_MODE_LOCAL = requestedMode;
  const effectiveLimit =
    typeof limitParam === 'number' && limitParam > 0 ? limitParam : SYNC_LIMIT;

  if (requestedMode === 'LAST' && effectiveLimit <= 0) {
    console.warn(
      '⚠️ SYNC_MODE=LAST con effectiveLimit=0 → se usa ALL para no saltar registros'
    );
    SYNC_MODE_LOCAL = 'ALL';
  }

  if (syncOperadoresState.inProgress) {
    console.log('⏸️ Sync operadores ya en progreso');
    return {
      processed: syncOperadoresState.processed,
      total: syncOperadoresState.total,
    };
  }

  syncOperadoresState.entity = 'operadores';
  syncOperadoresState.inProgress = true;
  syncOperadoresState.completed = false;
  syncOperadoresState.total = 0;
  syncOperadoresState.processed = 0;
  syncOperadoresState.startedAt = new Date();
  syncOperadoresState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync operadores → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    // Marcamos estado inicial en Supabase
    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'operadores', completed: false }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'operadores',
        action: 'sync',
        status: 'START',
        message: 'Inicio sincronización operadores',
      });
      if (error) {
        throw error;
      }
    }

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM operadores'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncOperadoresState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncOperadoresState.total = totalExterno;
    } else {
      syncOperadoresState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastIdOperador = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(IDOperador) AS min_id
          FROM (
            SELECT IDOperador
            FROM operadores
            ORDER BY IDOperador DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastIdOperador = Number(minId) - 1;
      } else {
        lastIdOperador = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncOperadoresState.processed >= syncOperadoresState.total
      ) {
        break;
      }

      batchNumber++;
      syncOperadoresState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            IDOperador     AS idoperador,
            Operador       AS operador,
            NombreCompleto AS nombrecompleto,
            Codigo         AS codigo,
            Activo         AS activo
          FROM operadores
          WHERE IDOperador > ?
          ORDER BY IDOperador
          LIMIT ?
        `,
        [lastIdOperador, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote operadores #${batchNumber} → ${rows.length} registros (desde IDOperador > ${lastIdOperador})`
        );

        const batchRaw = [];
        let processedInBatch = 0;
        let lastIdOperadorInBatch = lastIdOperador;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncOperadoresState.processed + processedInBatch >=
              syncOperadoresState.total
          ) {
            break;
          }

          const operador = trimOrNull(r.operador);
          if (!operador) {
            console.warn(
              `⚠️ Se omite idoperador=${r.idoperador}: Operador vacío en legacy`
            );
            lastIdOperadorInBatch = r.idoperador;
            processedInBatch++;
            continue;
          }

          batchRaw.push({
            idoperador: r.idoperador,
            operador,
            nombrecompleto:
              trimOrNull(r.nombrecompleto) || operador,
            codigo: r.codigo,
            activo: r.activo,
          });

          processedInBatch++;
          lastIdOperadorInBatch = r.idoperador;
        }

        if (!processedInBatch) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const batchToInsert = assignUsernamesInBatch(batchRaw);

        if (!batchToInsert.length) {
          lastIdOperador = lastIdOperadorInBatch;
          syncOperadoresState.processed += processedInBatch;
          continue;
        }

        const operadorIds = batchToInsert.map((r) => r.idoperador);
        const { data: existentes, error: fetchExistentesError } = await supabase
          .from('operadores')
          .select('idoperador')
          .in('idoperador', operadorIds);

        if (fetchExistentesError) {
          throw fetchExistentesError;
        }

        const existingSet = new Set(
          (existentes ?? []).map((e) => Number(e.idoperador))
        );

        const nuevos = [];
        const actualizar = [];

        for (const row of batchToInsert) {
          const operador = await resolveOperadorUsername(supabase, row);
          const resolved = { ...row, operador, fuente: OPERADOR_FUENTE_ONZE };
          if (existingSet.has(Number(row.idoperador))) {
            actualizar.push(resolved);
          } else {
            nuevos.push(resolved);
          }
        }

        if (nuevos.length) {
          const { error: insertError } = await supabase.from('operadores').insert(nuevos);
          if (insertError) {
            throw insertError;
          }
        }

        // Solo columnas legacy: rol / RBAC en Supabase no se tocan en updates.
        if (actualizar.length) {
          for (const row of actualizar) {
            const { idoperador, operador, nombrecompleto, codigo, activo } = row;
            const { error: updateError } = await supabase
              .from('operadores')
              .update({ operador, nombrecompleto, codigo, activo })
              .eq('idoperador', idoperador);
            if (updateError) {
              throw updateError;
            }
          }
        }

        lastIdOperador = lastIdOperadorInBatch;
        syncOperadoresState.processed += processedInBatch;

        console.log(
          `✅ Lote operadores #${batchNumber} confirmado — procesados: ${syncOperadoresState.processed}/${syncOperadoresState.total}`
        );
      } catch (err) {
        console.error('❌ Error en lote operadores:', err);
        throw err;
      }
    }

    {
      const { error } = await supabase
        .from('sync_status')
        .upsert({ key: 'operadores', completed: true }, { onConflict: 'key' });
      if (error) {
        throw error;
      }
    }

    syncOperadoresState.completed = true;

    {
      const { error } = await supabase.from('audit_log').insert({
        entity: 'operadores',
        action: 'sync',
        status: 'SUCCESS',
        message: `Sync operadores completado — ${syncOperadoresState.processed} registros sincronizados`,
      });
      if (error) {
        throw error;
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync operadores FINALIZADO → ${syncOperadoresState.processed} registros en ${duration}s`
    );

    return {
      processed: syncOperadoresState.processed,
      total: syncOperadoresState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync operadores:', e);

    const supabase = getSupabaseAdmin();

    await supabase
      .from('sync_status')
      .upsert({ key: 'operadores', completed: false }, { onConflict: 'key' });

    await supabase.from('audit_log').insert({
      entity: 'operadores',
      action: 'sync',
      status: 'ERROR',
      message: e.message || String(e),
    });

    throw e;
  } finally {
    syncOperadoresState.inProgress = false;
  }
}

module.exports = { syncOperadoresLegacyToSupabase, syncOperadoresState };

