// Praeventio Guard — Round 19 R2 Phase 4 split.
//
// "Long-tail" handlers extracted from server.ts that didn't fit any of the
// larger domain routers. Each is small enough that a dedicated file would
// be churn for churn's sake; consolidating them here keeps server.ts a
// pure bootstrap surface.
//
// Endpoints:
//   • GET  /api/legal/check-updates    — scans the BCN knowledge base for
//     normative impact via geminiBackend.scanLegalUpdates and returns one
//     analysis row per law. Auth-gated.
//   • POST /api/erp/sync               — SAP/Defontana mock. Logs the sync
//     attempt to `erp_sync_logs/` and returns a fake completion envelope
//     after a 1.5s artificial latency. Auth-gated.
//   • POST /api/seed-glossary          — gerente-only. Triggers
//     `seedBackend.runSeed()`.
//   • POST /api/seed-data              — gerente-only. Triggers
//     `dataSeedService.seedInitialData()`.
//   • GET  /api/environment/forecast   — climate forecast for the
//     Zettelkasten climate-risk coupling. Falls back to `{ forecast: [] }`
//     when upstream OpenWeather is unavailable so the calling
//     useCalendarPredictions hook just skips climate-risk node generation
//     instead of crashing. UNAUTHENTICATED — read-only public weather.
//
// Mounted via `app.use('/api', miscRouter)`. Each handler declares its full
// path suffix so the final on-the-wire URLs are byte-identical.

import { Router } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { erpSyncLimiter } from '../middleware/limiters.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../../services/observability/index.js';
// Sprint 39 audit fix (2026-05-15) — ERP integration adapter HONESTO.
// El handler anterior simulaba éxito con setTimeout(1500) + return success.
// Esto era "falsa sensación de completitud" — exactamente el patrón que
// el audit report flagged como peligroso para una app de prevención.
import {
  selectErpAdapter,
  buildNotConfiguredResult,
  ErpMissingCredentialsError,
  ErpNotImplementedError,
  type ErpAction,
} from '../../services/erp/erpAdapter.js';

function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] capture failed', e);
  }
}

// Round 22 — input validation for POST /api/erp/sync. The handler used
// to splat `req.body` straight into Firestore + a log line, so a
// malicious caller could pass arbitrary `erpType` strings (or non-string
// values entirely) and bloat documents with arbitrary nested payloads.
// Zod gives us a typed gate: erpType is restricted to a known whitelist
// and payload must be a plain object.
// Sprint 39 — extendido a buk/talana/mock (chilenos + adapter de pruebas).
// `oracle` y `dynamics` aceptados por compatibilidad pero NO tienen
// adapter — caen en NOT_IMPLEMENTED honesto en lugar de simular éxito.
// Codex P1 fix (PR #266): `erpType` ahora es OPCIONAL — el server lee
// ERP_ADAPTER del env por default. Si el body lo provee, valida que sea
// uno con adapter real (sap/buk/talana/mock), si no devuelve 400.
const erpSyncSchema = z.object({
  erpType: z
    .enum(['sap', 'buk', 'talana', 'mock', 'oracle', 'dynamics', 'odoo'])
    .optional(),
  action: z.enum([
    'manual_sync',
    'fetch_employees',
    'fetch_org_chart',
    'push_worker_status',
    'push_training_record',
  ]),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

// Adapters con implementación real (los demás caen en not_implemented honesto).
const SUPPORTED_ERP_ADAPTERS = new Set(['sap', 'buk', 'talana', 'mock']);

const router = Router();

// 3-day climate forecast endpoint for the Zettelkasten climate-risk coupling.
// Reads from environmentBackend; returns shape: { forecast: ClimateForecastDay[] }.
// Best-effort: if upstream OpenWeather is unavailable, returns empty forecast.
// Sprint 27 (audit P0 H15) — gate behind verifyAuth + share the
// per-uid erpSyncLimiter so a logged-in attacker can't burn the
// upstream OpenWeather quota in a tight loop.
router.get('/environment/forecast', verifyAuth, erpSyncLimiter, async (req, res) => {
  const days = Math.min(7, Math.max(1, parseInt(String(req.query.days ?? '3'), 10) || 3));
  try {
    // environmentBackend currently exposes updateGlobalEnvironmentalContext
    // for current weather. A dedicated multi-day getForecast helper is a
    // follow-up; for now we degrade gracefully so useCalendarPredictions
    // doesn't crash and just skips climate-risk node generation.
    const mod = (await import('../../services/environmentBackend.js')) as Record<string, unknown>;
    const getForecast = mod.getForecast as ((d: number) => Promise<unknown[]>) | undefined;
    if (typeof getForecast === 'function') {
      const forecast = await getForecast(days);
      return res.json({ forecast });
    }
    return res.json({ forecast: [] });
  } catch (error: any) {
    logger.warn('environment_forecast_failed', { days, message: error?.message });
    return res.json({ forecast: [] });
  }
});

// ERP Integration (Sprint 39 — adapter HONESTO).
// Reemplaza la simulación setTimeout+success genérico con un adapter real
// que distingue 3 estados:
//   - not_configured (no ERP_ADAPTER seteado) → HTTP 503
//   - mock (ERP_ADAPTER=mock) → HTTP 200 con mode:'mock' explícito
//   - real (sap/buk/talana) → HTTP 200 si éxito; HTTP 502/501 si stub
//
// El front DEBE inspeccionar `mode` y mostrar banner "Modo prueba — no
// sincronizó con ERP real" cuando reciba `mode: 'mock'`. Si recibe
// `mode: 'not_configured'`, contactar admin.
router.post('/erp/sync', verifyAuth, erpSyncLimiter, async (req, res) => {
  const parsed = erpSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
  }
  const { erpType, action, payload } = parsed.data;
  const uid = req.user!.uid;
  // Tenant context — viene del verifyAuth claim, no del body
  const tenantId =
    (req.user as { tenantId?: string }).tenantId ?? 'default';

  // Codex P1 fix (PR #266): Si el body provee erpType válido, lo usamos;
  // si no, el server lee ERP_ADAPTER del env. Frontend ya NO manda erpType
  // (ver src/pages/ERPIntegration.tsx) — el body queda para callers
  // server-to-server / admin tools que sí quieran override explícito.
  const requestedAdapter = erpType as 'sap' | 'buk' | 'talana' | 'mock' | undefined;

  // Codex P2 fix (PR #266 + #267 follow-up): Helper compartido para loggear
  // intentos antes de devolver respuesta — incluye los modos de falla
  // (missing_creds, not_implemented) para audit trail completo. Si el write
  // a Firestore falla, NO bloqueamos la respuesta (try-catch interno).
  const db = admin.firestore();
  const logAttempt = async (
    mode: string,
    extraStatus: string,
    extraMsg?: string,
    extraErpType?: string,
  ): Promise<void> => {
    try {
      await db.collection('erp_sync_logs').add({
        uid,
        erpType: extraErpType ?? requestedAdapter ?? process.env.ERP_ADAPTER ?? null,
        action,
        payload,
        status: extraStatus,
        mode,
        message: extraMsg ?? null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (logErr) {
      // No bloquear la respuesta si el log falla.
      logger.warn('erp_sync_log_failed', { uid, action, error: String(logErr) });
    }
  };

  try {
    logger.info('erp_sync_started', { erpType: requestedAdapter, envAdapter: process.env.ERP_ADAPTER, action, uid });

    // Codex P2 fix (PR #267/#268 follow-up — moved inside try):
    // Rechazar legacy types (oracle/dynamics/odoo) ANTES del env fallback.
    // Si el body manda oracle/dynamics/odoo, NO caer al env adapter — eso
    // procesaría una request de Oracle a través de un SAP/Buk/Talana real
    // y loggearía el erpType equivocado. Devolver 501 honesto.
    //
    // Codex 2026-05-15: el write a audit log debe ser fail-soft. Antes el
    // `await ...add()` estaba fuera del try, así que si Firestore tiraba,
    // Express 4 devolvía 500 en lugar del 501 honesto que queremos. Ahora
    // usamos `logAttempt()` compartido que es fail-soft por diseño.
    if (erpType && !SUPPORTED_ERP_ADAPTERS.has(erpType)) {
      await logAttempt(
        'not_implemented',
        'not_implemented',
        `Legacy erpType "${erpType}" rejected (no adapter implementation).`,
        erpType,
      );
      logger.warn('erp_sync_legacy_type_rejected', { erpType, action, uid });
      return res.status(501).json({
        success: false,
        mode: 'not_implemented',
        message: `ERP adapter "${erpType}" no tiene implementación. Soportados: sap, buk, talana, mock.`,
        reason: 'Tipo ERP legacy sin adapter — no caemos al env adapter para evitar logs incorrectos',
        timestamp: new Date().toISOString(),
      });
    }

    const adapter = selectErpAdapter({
      adapterName: requestedAdapter,
    });

    if (!adapter) {
      const result = buildNotConfiguredResult({
        tenantId,
        action: action as ErpAction,
        data: payload,
      });
      await logAttempt('not_configured', 'not_configured', result.message);
      logger.warn('erp_sync_not_configured', { erpType: requestedAdapter, action, uid });
      return res.status(503).json({ success: false, ...result });
    }

    const result = await adapter.sync({
      tenantId,
      action: action as ErpAction,
      data: payload,
    });

    await logAttempt(result.mode, result.ok ? 'success' : 'failed', result.message);

    return res.json({ success: result.ok, ...result });
  } catch (error) {
    // Errores tipados del adapter → respuestas honestas + audit log
    if (error instanceof ErpMissingCredentialsError) {
      await logAttempt('missing_credentials', 'failed', error.message);
      logger.warn('erp_sync_missing_credentials', { erpType: requestedAdapter, action, uid, message: error.message });
      return res.status(503).json({
        success: false,
        mode: 'missing_credentials',
        message: error.message,
        reason: 'ERP adapter requiere credenciales que no están configuradas en este servidor',
        timestamp: new Date().toISOString(),
      });
    }
    if (error instanceof ErpNotImplementedError) {
      await logAttempt('not_implemented', 'failed', error.message);
      logger.warn('erp_sync_not_implemented', { erpType: requestedAdapter, action, uid, message: error.message });
      return res.status(501).json({
        success: false,
        mode: 'not_implemented',
        message: error.message,
        reason: 'Adapter declarado pero acción aún no implementada (stub honesto)',
        timestamp: new Date().toISOString(),
      });
    }
    await logAttempt('failed', 'failed', (error as Error)?.message ?? 'unknown');
    logger.error('erp_sync_failed', error, { erpType: requestedAdapter, action, uid });
    sentryCapture(error, { endpoint: '/api/erp/sync', tags: { method: 'POST', erpType: requestedAdapter ?? null, action, uid } });
    return res.status(502).json({
      success: false,
      mode: 'failed',
      error: 'Error de sincronización con ERP',
      timestamp: new Date().toISOString(),
    });
  }
});

// Seed Glossary Endpoint (gerente-only — prevents public abuse)
router.post('/seed-glossary', verifyAuth, async (req, res) => {
  try {
    const callerRecord = await admin.auth().getUser(req.user!.uid);
    if (callerRecord.customClaims?.role !== 'gerente') {
      return res.status(403).json({ error: 'Forbidden: Requires gerente role' });
    }
    const { runSeed } = await import('../../services/seedBackend.js');
    await runSeed();
    await auditServerEvent(req, 'misc.seedGlossary', 'misc', {
      actorUid: req.user!.uid,
    });
    return res.json({ success: true, message: 'Community glossary seeded successfully' });
  } catch (error: any) {
    logger.error('seed_glossary_failed', error);
    sentryCapture(error, { endpoint: '/api/seed-glossary', tags: { method: 'POST' } });
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

// Seed Data Endpoint (gerente-only — prevents public abuse)
router.post('/seed-data', verifyAuth, async (req, res) => {
  try {
    const callerRecord = await admin.auth().getUser(req.user!.uid);
    if (callerRecord.customClaims?.role !== 'gerente') {
      return res.status(403).json({ error: 'Forbidden: Requires gerente role' });
    }
    const { seedInitialData } = await import('../../services/dataSeedService.js');
    await seedInitialData();
    await auditServerEvent(req, 'misc.seedData', 'misc', {
      actorUid: req.user!.uid,
    });
    return res.json({ success: true, message: 'Initial project data seeded successfully' });
  } catch (error: any) {
    logger.error('seed_data_failed', error);
    sentryCapture(error, { endpoint: '/api/seed-data', tags: { method: 'POST' } });
    return res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

// Legal Monitor: scan BCN knowledge base for normative impact on system modules
router.get('/legal/check-updates', verifyAuth, async (_req, res) => {
  try {
    const { bcnKnowledgeBase } = await import('../../data/bcnKnowledgeBase.js');
    const geminiBackend = await import('../../services/geminiBackend.js');
    const modulesSummary =
      'Riesgos, Trabajadores, EPP, Hallazgos, Incidentes, Capacitación, Salud Ocupacional, Comité Paritario, Normativas, Proyectos, Emergencia';
    const results = await Promise.all(
      bcnKnowledgeBase.map(async (law: any) => {
        const analysis = await (geminiBackend.scanLegalUpdates as (
          lawTitle: string,
          lawContent: string,
          modules: string,
        ) => Promise<Record<string, unknown>>)(
          law.title,
          law.content,
          modulesSummary,
        );
        return {
          lawId: law.id,
          title: law.title,
          lastUpdated: law.lastUpdated,
          relevantModules: law.relevantModules,
          ...analysis,
        };
      }),
    );
    res.json({ results });
  } catch (error: any) {
    logger.error('legal_check_updates_failed', error);
    sentryCapture(error, { endpoint: '/api/legal/check-updates', tags: { method: 'GET' } });
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message });
  }
});

export default router;
