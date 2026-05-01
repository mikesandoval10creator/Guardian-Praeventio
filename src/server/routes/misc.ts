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
import crypto from 'crypto';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';

const router = Router();

// 3-day climate forecast endpoint for the Zettelkasten climate-risk coupling.
// Reads from environmentBackend; returns shape: { forecast: ClimateForecastDay[] }.
// Best-effort: if upstream OpenWeather is unavailable, returns empty forecast.
router.get('/environment/forecast', async (req, res) => {
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
router.post('/erp/sync', verifyAuth, async (req, res) => {
  const { erpType, action, payload } = req.body;
  const uid = (req as any).user.uid;

  try {
    console.log(`[ERP Sync] Type: ${erpType}, Action: ${action}`);

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
      message: `Sincronización con ${erpType} exitosa`,
      data: {
        syncId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        status: 'completed',
      },
    });
  } catch (error) {
    console.error(`Error syncing with ERP (${erpType}):`, error);
    res.status(500).json({ error: 'Error de sincronización con ERP' });
  }
});

// Seed Glossary Endpoint (gerente-only — prevents public abuse)
router.post('/seed-glossary', verifyAuth, async (req, res) => {
  try {
    const callerRecord = await admin.auth().getUser((req as any).user.uid);
    if (callerRecord.customClaims?.role !== 'gerente') {
      return res.status(403).json({ error: 'Forbidden: Requires gerente role' });
    }
    const { runSeed } = await import('../../services/seedBackend.js');
    await runSeed();
    res.json({ success: true, message: 'Community glossary seeded successfully' });
  } catch (error: any) {
    console.error('Error seeding glossary:', error);
    res.status(500).json({
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
    const callerRecord = await admin.auth().getUser((req as any).user.uid);
    if (callerRecord.customClaims?.role !== 'gerente') {
      return res.status(403).json({ error: 'Forbidden: Requires gerente role' });
    }
    const { seedInitialData } = await import('../../services/dataSeedService.js');
    await seedInitialData();
    res.json({ success: true, message: 'Initial project data seeded successfully' });
  } catch (error: any) {
    console.error('Error seeding data:', error);
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
      'Riesgos, Trabajadores, EPP, Hallazgos, Incidentes, Capacitación, Salud Ocupacional, Comité Paritario, Normativas, Proyectos, Emergencia';
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
    console.error('Error in legal check-updates:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
