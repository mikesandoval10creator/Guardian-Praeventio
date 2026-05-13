// Praeventio Guard â€” Round 19 R2 Phase 4 split.
//
// "Long-tail" handlers extracted from server.ts that didn't fit any of the
// larger domain routers. Each is small enough that a dedicated file would
// be churn for churn's sake; consolidating them here keeps server.ts a
// pure bootstrap surface.
//
// Endpoints:
//   â€¢ GET  /api/legal/check-updates    â€” scans the BCN knowledge base for
//     normative impact via geminiBackend.scanLegalUpdates and returns one
//     analysis row per law. Auth-gated.
//   â€¢ POST /api/erp/sync               â€” SAP/Defontana mock. Logs the sync
//     attempt to `erp_sync_logs/` and returns a fake completion envelope
//     after a 1.5s artificial latency. Auth-gated.
//   â€¢ POST /api/seed-glossary          â€” gerente-only. Triggers
//     `seedBackend.runSeed()`.
//   â€¢ POST /api/seed-data              â€” gerente-only. Triggers
//     `dataSeedService.seedInitialData()`.
//   â€¢ GET  /api/environment/forecast   â€” climate forecast for the
//     Zettelkasten climate-risk coupling. Falls back to `{ forecast: [] }`
//     when upstream OpenWeather is unavailable so the calling
//     useCalendarPredictions hook just skips climate-risk node generation
//     instead of crashing. UNAUTHENTICATED â€” read-only public weather.
//
// Mounted via `app.use('/api', miscRouter)`. Each handler declares its full
// path suffix so the final on-the-wire URLs are byte-identical.

import { Router } from 'express';
import admin from 'firebase-admin';
import crypto from 'crypto';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { erpSyncLimiter } from '../middleware/limiters.js';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../../services/observability/index.js';

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

// Round 22 â€” input validation for POST /api/erp/sync. The handler used
// to splat `req.body` straight into Firestore + a log line, so a
// malicious caller could pass arbitrary `erpType` strings (or non-string
// values entirely) and bloat documents with arbitrary nested payloads.
// Zod gives us a typed gate: erpType is restricted to a known whitelist
// and payload must be a plain object.
const erpSyncSchema = z.object({
  erpType: z.enum(['sap', 'oracle', 'dynamics', 'odoo']),
  action: z.string().min(1).max(128),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

const router = Router();

// 3-day climate forecast endpoint for the Zettelkasten climate-risk coupling.
// Reads from environmentBackend; returns shape: { forecast: ClimateForecastDay[] }.
// Best-effort: if upstream OpenWeather is unavailable, returns empty forecast.
// Sprint 27 (audit P0 H15) â€” gate behind verifyAuth + share the
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
    res.json({ forecast: [] });
  } catch (error: any) {
    logger.warn('environment_forecast_failed', { days, message: error?.message });
    res.json({ forecast: [] });
  }
});

// ERP Integration (SAP/Defontana Mock)
router.post('/erp/sync', verifyAuth, erpSyncLimiter, async (req, res) => {
  const parsed = erpSyncSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_payload', issues: parsed.error.issues });
  }
  const { erpType, action, payload } = parsed.data;
  const uid = req.user.uid;

  try {
    logger.info('erp_sync_started', { erpType, action, uid });

    // Simulate real backend activity by logging the sync attempt
    const db = admin.firestore();
    await db.collection('erp_sync_logs').add({
      uid,
      erpType,
      action,
      payload,
      status: 'success',
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 1500));

    res.json({
      success: true,
      message: `SincronizaciÃ³n con ${erpType} exitosa`,
      data: {
        syncId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        status: 'completed',
      },
    });
  } catch (error) {
    logger.error('erp_sync_failed', error, { erpType, action, uid });
    sentryCapture(error, { endpoint: '/api/erp/sync', tags: { method: 'POST', erpType, action, uid } });
    res.status(500).json({ error: 'Error de sincronizaciÃ³n con ERP' });
  }
});

// Seed Glossary Endpoint (gerente-only â€” prevents public abuse)
router.post('/seed-glossary', verifyAuth, async (req, res) => {
  try {
    const callerRecord = await admin.auth().getUser(req.user.uid);
    if (callerRecord.customClaims?.role !== 'gerente') {
      return res.status(403).json({ error: 'Forbidden: Requires gerente role' });
    }
    const { runSeed } = await import('../../services/seedBackend.js');
    await runSeed();
    res.json({ success: true, message: 'Community glossary seeded successfully' });
  } catch (error: any) {
    logger.error('seed_glossary_failed', error);
    sentryCapture(error, { endpoint: '/api/seed-glossary', tags: { method: 'POST' } });
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message || 'Internal server error',
    });
  }
});

// Seed Data Endpoint (gerente-only â€” prevents public abuse)
router.post('/seed-data', verifyAuth, async (req, res) => {
  try {
    const callerRecord = await admin.auth().getUser(req.user.uid);
    if (callerRecord.customClaims?.role !== 'gerente') {
      return res.status(403).json({ error: 'Forbidden: Requires gerente role' });
    }
    const { seedInitialData } = await import('../../services/dataSeedService.js');
    await seedInitialData();
    res.json({ success: true, message: 'Initial project data seeded successfully' });
  } catch (error: any) {
    logger.error('seed_data_failed', error);
    sentryCapture(error, { endpoint: '/api/seed-data', tags: { method: 'POST' } });
    res.status(500).json({
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
      'Riesgos, Trabajadores, EPP, Hallazgos, Incidentes, CapacitaciÃ³n, Salud Ocupacional, ComitÃ© Paritario, Normativas, Proyectos, Emergencia';
    const results = await Promise.all(
      bcnKnowledgeBase.map(async (law: any) => {
        const analysis = await (geminiBackend.scanLegalUpdates as Function)(
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
    res.status(500).json({ error: error.message });
  }
});

export default router;
