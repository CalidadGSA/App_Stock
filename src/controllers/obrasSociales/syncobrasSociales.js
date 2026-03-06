require('dotenv').config();

const { pool, dbType } = require('../../db'); // MySQL (PLEX)
const dbInterna = require('../../dbInterna'); // PostgreSQL interna

const SYNC_LIMIT = parseInt(process.env.SYNC_LIMIT || '0', 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE_OBRAS_SOCIALES || '5000', 10);

/* ======================================================
   🧠 ESTADO GLOBAL SYNC obras sociales
====================================================== */
let syncState = {
  inProgress: false,
  completed: false,
  total: 0,
  processed: 0,
  startedAt: null,
  batchNumber: 0,
};

async function syncObrasSociales({ mode, limit: limitParam } = {}) {
  if (dbType !== 'mysql') {
    console.warn('⚠️ syncObrasSociales llamado con dbType !== mysql, se omite.');
    return { processed: 0, total: 0, duration: 0 };
  }

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

  if (syncState.inProgress) {
    console.log('⏸️ Sync obras sociales ya en progreso');
    return { processed: syncState.processed, total: syncState.total };
  }

  syncState.inProgress = true;
  syncState.completed = false;
  syncState.total = 0;
  syncState.processed = 0;
  syncState.startedAt = new Date();
  syncState.batchNumber = 0;

  const startTime = Date.now();

  try {
    console.log('🚀 Sync obras sociales → START');
    console.log(
      `🔧 Modo: ${SYNC_MODE_LOCAL}, SYNC_LIMIT: ${SYNC_LIMIT}, limit param: ${limitParam}`
    );

    await dbInterna.query(`
      INSERT INTO sync_status (key, completed, updated_at)
      VALUES ('obras_sociales', false, NOW())
      ON CONFLICT (key) DO UPDATE SET completed=false, updated_at=NOW()
    `);

    await dbInterna.query(`
      INSERT INTO audit_log (entity, action, status, message)
      VALUES ('obras_sociales','sync','START','Inicio sincronización obras sociales')
    `);

    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM obsociales'
    );
    const totalExterno = Number(countRows[0].total) || 0;

    // Para LAST respetamos el límite; para ALL ignoramos SYNC_LIMIT y vamos por todos.
    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      syncState.total = Math.min(effectiveLimit, totalExterno);
    } else if (SYNC_MODE_LOCAL === 'ALL') {
      syncState.total = totalExterno;
    } else {
      syncState.total =
        effectiveLimit > 0
          ? Math.min(effectiveLimit, totalExterno)
          : totalExterno;
    }

    let lastCodobsoc = 0;

    if (SYNC_MODE_LOCAL === 'LAST' && effectiveLimit > 0) {
      const [rowsMin] = await pool.query(
        `
          SELECT MIN(codobsoc) AS min_id
          FROM (
            SELECT codobsoc
            FROM obsociales
            ORDER BY codobsoc DESC
            LIMIT ?
          ) t
        `,
        [effectiveLimit]
      );

      const minId = rowsMin[0]?.min_id;

      if (minId != null) {
        lastCodobsoc = Number(minId) - 1;
      } else {
        lastCodobsoc = 0;
      }
    }

    let batchNumber = 0;

    while (true) {
      // Corte solo si hay límite efectivo (modo LAST).
      if (
        SYNC_MODE_LOCAL === 'LAST' &&
        effectiveLimit > 0 &&
        syncState.processed >= syncState.total
      ) {
        break;
      }

      batchNumber++;
      syncState.batchNumber = batchNumber;

      const [rows] = await pool.query(
        `
          SELECT
            codobsoc,
            descripcio
          FROM obsociales
          WHERE codobsoc > ?
          ORDER BY codobsoc
          LIMIT ?
        `,
        [lastCodobsoc, BATCH_SIZE]
      );

      if (!rows.length) {
        break;
      }

      try {
        console.log(
          `📦 Lote obras sociales #${batchNumber} → ${rows.length} registros (desde codobsoc > ${lastCodobsoc})`
        );

        const cols = ['codobsoc', 'descripcio'];
        const values = [];
        const params = [];
        let processedInBatch = 0;
        let lastCodobsocInBatch = lastCodobsoc;

        for (const r of rows) {
          if (
            SYNC_MODE_LOCAL === 'LAST' &&
            effectiveLimit > 0 &&
            syncState.processed + processedInBatch >= syncState.total
          ) {
            break;
          }

          const baseIndex = processedInBatch * cols.length;
          values.push(
            `(${cols
              .map((_, colIdx) => `$${baseIndex + colIdx + 1}`)
              .join(',')})`
          );
          params.push(r.codobsoc, r.descripcio);

          processedInBatch++;
          lastCodobsocInBatch = r.codobsoc;
        }

        if (processedInBatch === 0) {
          // Ya alcanzamos el límite efectivo dentro de este lote
          break;
        }

        const updateCols = cols.filter(c => c !== 'codobsoc');
        const setClause = updateCols
          .map(c => `${c}=EXCLUDED.${c}`)
          .join(',');

        const sql = `
          INSERT INTO obsociales (${cols.join(',')})
          VALUES ${values.join(',')}
          ON CONFLICT (codobsoc) DO UPDATE
          SET ${setClause}
        `;

        await dbInterna.query('BEGIN');
        await dbInterna.query(sql, params);
        await dbInterna.query('COMMIT');

        lastCodobsoc = lastCodobsocInBatch;
        syncState.processed += processedInBatch;

        console.log(
          `✅ Lote obras sociales #${batchNumber} confirmado — procesados: ${syncState.processed}/${syncState.total}`
        );
      } catch (err) {
        await dbInterna.query('ROLLBACK');
        throw err;
      }
    }

    await dbInterna.query(`
      INSERT INTO sync_status (key, completed, updated_at)
      VALUES ('obras_sociales', true, NOW())
      ON CONFLICT (key)
      DO UPDATE SET completed = true, updated_at = NOW()
    `);

    syncState.completed = true;

    await dbInterna.query(
      `
        INSERT INTO audit_log (entity, action, status, message)
        VALUES ('obras_sociales', 'sync', 'SUCCESS', $1)
      `,
      [
        `Sync obras sociales completado — ${syncState.processed} registros sincronizados`,
      ]
    );

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(
      `🏁 Sync obras sociales FINALIZADO → ${syncState.processed} registros en ${duration}s`
    );

    return {
      processed: syncState.processed,
      total: syncState.total,
      duration,
    };
  } catch (e) {
    console.error('🔥 Error sync obras sociales:', e);

    await dbInterna.query(`
      UPDATE sync_status
      SET completed=false, updated_at=NOW()
      WHERE key='obras_sociales'
    `);

    await dbInterna.query(
      `
        INSERT INTO audit_log (entity, action, status, message)
        VALUES ('obras_sociales','sync','ERROR',$1)
      `,
      [e.message]
    );

    throw e;
  } finally {
    syncState.inProgress = false;
  }
}

module.exports = { syncObrasSociales, syncState };

