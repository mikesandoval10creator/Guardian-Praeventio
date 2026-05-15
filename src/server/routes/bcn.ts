// Praeventio Guard — BCN snapshot endpoint.
//
// Decisión usuario 2026-05-15: "honesto" = funciona REAL. El BunkerManager
// ya no muestra error "endpoint pending"; ahora consume este endpoint que
// fetcha leyes reales desde la Biblioteca del Congreso Nacional (BCN) vía
// `src/services/bcnService.ts:fetchLawFromBCN()` y devuelve un snapshot
// indexado para distribución offline.
//
// Mounted at /api/bcn en server.ts.

import { Router } from 'express';
import {
  fetchLawFromBCN,
  CRITICAL_LAWS,
  type BCNLaw,
} from '../../services/bcnService.js';
import { logger } from '../../utils/logger.js';

export const bcnRouter = Router();

// Cache en memoria del snapshot — BCN no cambia frecuentemente y el fetch
// individual de cada ley puede tomar segundos. Cacheamos por 1 hora para
// evitar hammering al servidor de BCN.
let cachedSnapshot: {
  version: string;
  fetchedAt: string;
  laws: BCNLaw[];
  totalSizeBytes: number;
} | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

/**
 * GET /api/bcn/snapshot
 *
 * Devuelve un snapshot REAL de las leyes críticas Praeventio Guard,
 * fetched live desde BCN (con cache 1h). El BunkerManager persiste este
 * payload en IndexedDB para operación offline.
 *
 * Respuesta:
 * ```
 * {
 *   version: ISO-timestamp,
 *   fetchedAt: ISO-timestamp,
 *   content: {
 *     laws: BCNLaw[],
 *     totalSizeBytes: number,
 *     citationsCount: number
 *   }
 * }
 * ```
 *
 * Errores:
 *   - 502 si BCN está caído y no hay snapshot en cache (no podemos servir
 *     datos fabricados — devolvemos error honesto)
 *   - 500 si error inesperado
 */
bcnRouter.get('/snapshot', async (_req, res) => {
  try {
    const now = Date.now();
    const cacheValid = cachedSnapshot && now - cachedAt < CACHE_TTL_MS;

    if (!cacheValid) {
      // Cache stale o vacío — refetchar desde BCN.
      logger.info('bcn_snapshot_fetching', { laws: CRITICAL_LAWS.length });
      const lawResults = await Promise.allSettled(
        CRITICAL_LAWS.map((law) => fetchLawFromBCN(law.id)),
      );
      const laws: BCNLaw[] = [];
      let failed = 0;
      for (const result of lawResults) {
        if (result.status === 'fulfilled' && result.value) {
          laws.push(result.value);
        } else {
          failed += 1;
        }
      }

      // Si BCN está completamente caído (todas fallaron) Y no tenemos
      // cache anterior, no podemos servir nada honestamente.
      if (laws.length === 0 && !cachedSnapshot) {
        logger.warn('bcn_snapshot_all_failed', { attempted: CRITICAL_LAWS.length });
        return res.status(502).json({
          error: 'bcn_unavailable',
          message:
            'No se pudo conectar a la Biblioteca del Congreso Nacional. ' +
            'Reintenta en unos minutos. (No servimos datos fabricados.)',
        });
      }

      // Si algunas fallaron pero tenemos al menos algunas, actualizamos
      // cache parcial. El cliente recibe las que sí pudimos descargar.
      const totalSizeBytes = laws.reduce(
        (sum, law) => sum + (law.texto?.length ?? 0),
        0,
      );
      cachedSnapshot = {
        version: new Date(now).toISOString(),
        fetchedAt: new Date(now).toISOString(),
        laws,
        totalSizeBytes,
      };
      cachedAt = now;
      logger.info('bcn_snapshot_cached', {
        lawsFetched: laws.length,
        failed,
        totalSizeBytes,
      });
    }

    // Devolvemos snapshot (fresco o cacheado, pero siempre con datos REALES).
    return res.json({
      version: cachedSnapshot!.version,
      fetchedAt: cachedSnapshot!.fetchedAt,
      content: {
        laws: cachedSnapshot!.laws.map((law) => ({
          idNorma: law.idNorma,
          titulo: law.titulo,
          fechaPublicacion: law.fechaPublicacion,
          organismo: law.organismo,
          texto: law.texto,
        })),
        totalSizeBytes: cachedSnapshot!.totalSizeBytes,
        citationsCount: cachedSnapshot!.laws.length,
      },
    });
  } catch (error: unknown) {
    logger.error('bcn_snapshot_failed', error as Error);
    return res.status(500).json({
      error: 'bcn_snapshot_error',
      message:
        error instanceof Error
          ? error.message
          : 'Error desconocido al fetchar BCN snapshot.',
    });
  }
});

export default bcnRouter;
