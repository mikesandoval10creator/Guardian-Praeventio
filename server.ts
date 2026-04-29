import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { createServer as createViteServer } from "vite";
import path from "path";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "crypto";
import dotenv from "dotenv";
import { Resend } from "resend";
import { initializeRAG } from "./src/services/ragService.js";
import { autoValidateTelemetry } from "./src/services/safetyEngineBackend.js";
import { awardPoints, getLeaderboard, checkMedalEligibility } from "./src/services/gamificationBackend.js";
import { updateGlobalEnvironmentalContext } from "./src/services/environmentBackend.js";
import { logger } from "./src/utils/logger.js";
// Billing imports (buildInvoice, webpayAdapter, stripeAdapter, withIdempotency,
// webpayMetrics, mercadoPagoAdapter, currency, billing/types) moved to
// src/server/routes/billing.ts in Round 17 R2 Phase 2 split. `isAdminRole`
// went with them but is RE-IMPORTED here in Round 17 R1 because the new
// /api/admin/iot/rotate-secret endpoint also gates on admin-or-gerente.
// Webpay-specific `performance` import + googleapis Play client also moved.
import { sentryAdapter } from "./src/services/observability/sentryAdapter.js";
import { getErrorTracker } from "./src/services/observability/index.js";
// `assertProjectMember`/`ProjectMembershipError` formerly used inline by
// /api/audit-log; moved with the route into src/server/routes/audit.ts in
// Round 16 R5 Phase 1 split.
// Round 16 R5 Phase 1 split: middleware + small route modules extracted from
// server.ts. Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18.
import { verifyAuth } from "./src/server/middleware/verifyAuth.js";
import { safeSecretEqual } from "./src/server/middleware/safeSecretEqual.js";
import { canonicalize } from "./src/server/middleware/canonicalBody.js";
import { largeBodyJson } from "./src/server/middleware/largeBodyJson.js";
import { auditServerEvent } from "./src/server/middleware/auditLog.js";
import { assertProjectMemberFromBody } from "./src/server/middleware/assertProjectMemberMiddleware.js";
import { isAdminRole } from "./src/types/roles.js";
import {
  geminiLimiter,
  refereeLimiter,
} from "./src/server/middleware/limiters.js";
import adminRouter from "./src/server/routes/admin.js";
import healthRouter from "./src/server/routes/health.js";
import auditRouter from "./src/server/routes/audit.js";
import pushRouter from "./src/server/routes/push.js";
import {
  billingApiRouter,
  billingWebpayRouter,
} from "./src/server/routes/billing.js";
import curriculumRouter, {
  webauthnChallengeRouter,
} from "./src/server/routes/curriculum.js";
import projectsRouter, {
  invitationsRouter,
} from "./src/server/routes/projects.js";
import {
  oauthGoogleApiRouter,
  oauthGoogleAuthRouter,
} from "./src/server/routes/oauthGoogle.js";
import admin from "firebase-admin";
import fs from 'fs';
import { GoogleGenAI } from "@google/genai";
// `googleapis` import removed in Round 17 R2 Phase 2 — its sole use was the
// Google Play Developer API client, which moved to billing.ts.

dotenv.config();

// Round 14 — Removed routes flagged dead by A1 audit AND cross-tenant
// exploitable by A5: /api/erp/sync-workers, /api/comite/alert-email,
// /api/reports/daily-email, /api/projects/:projectId/health-check.
// Future re-introduction must use assertProjectMember.

// Round 14 (A6 audit) — KMS production pre-flight. The OAuth token store
// uses envelope encryption with a Key Encryption Key resolved by
// `KMS_ADAPTER` (see src/services/security/kmsAdapter.ts). In dev the
// default `'in-memory-dev'` is fine; in production it MUST be
// `'cloud-kms'` so the KEK lives in Google Cloud KMS and rotates via
// our documented procedure. Booting prod with the dev adapter would
// silently degrade key custody — refuse to start instead.
if (
  process.env.NODE_ENV === 'production' &&
  (process.env.KMS_ADAPTER ?? 'in-memory-dev') !== 'cloud-kms'
) {
  console.error(
    '[boot] FATAL: NODE_ENV=production but KMS_ADAPTER is not cloud-kms. Refusing to start.',
  );
  process.exit(1);
}

// Sentry initialization — must happen as early as possible, before any
// Express middleware so unhandled errors anywhere in the boot path are
// captured. Silent no-op when SENTRY_DSN isn't set; see OBSERVABILITY.md
// §1 (fall-back policy) for why a missing DSN is not fatal.
try {
  sentryAdapter.init({
    dsn: process.env.SENTRY_DSN,
    environment: (process.env.NODE_ENV === 'production'
      ? 'production'
      : process.env.NODE_ENV === 'staging'
        ? 'staging'
        : 'development') as 'production' | 'staging' | 'development',
    release: process.env.APP_VERSION ?? 'dev',
    sampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 0.1,
  });
} catch (err) {
  console.warn('[observability] Sentry init failed (continuing without it):', err);
}

const resend = new Resend(process.env.RESEND_API_KEY);

// Read Firebase Config once at startup FIRST
let firebaseConfig: any = null;
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
} catch (error) {
  console.error("Failed to read firebase-applet-config.json at startup:", error);
}

// Initialize Firebase Admin
try {
  if (!admin.apps.length) {
    const initConfig: any = {
      credential: admin.credential.applicationDefault(),
    };
    if (firebaseConfig?.projectId) {
      initConfig.projectId = firebaseConfig.projectId;
    }
    admin.initializeApp(initConfig);
  }

  // Override admin.firestore() to always return the correct database instance
  if (firebaseConfig?.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)') {
    const originalFirestore = admin.firestore;
    const { getFirestore } = await import('firebase-admin/firestore');
    
    const firestoreWrapper = () => getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);
    Object.assign(firestoreWrapper, originalFirestore);
    
    Object.defineProperty(admin, 'firestore', {
      get: () => firestoreWrapper,
      configurable: true
    });
    
    console.log(`✅ Firebase Admin configured for databaseId: ${firebaseConfig.firestoreDatabaseId}`);
  }
} catch (error) {
  if (process.env.NODE_ENV === 'production') {
    console.error("FATAL: Firebase Admin initialization failed in production.", error);
    process.exit(1);
  } else {
    console.warn("Firebase Admin initialization failed. Auth middleware will not work.", error);
  }
}

// Google Play Developer API client (playAuth + playDeveloperApi) moved to
// src/server/routes/billing.ts in Round 17 R2 Phase 2 split — only the
// /api/billing/verify and /api/billing/webhook handlers consume it.

const app = express();
const PORT = 3000;

// `safeSecretEqual` extracted to src/server/middleware/safeSecretEqual.ts in
// Round 16 R5 Phase 1 split.

// Security Middleware
// CSP directives shared by prod (enforce) and dev (report-only). Reasonable for a
// Vite + Firebase + Google APIs SPA: 'unsafe-inline' for styles is required by
// Tailwind's runtime injection; img/media allow blob: + data: for previews.
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "https://*.googleapis.com", "https://apis.google.com"],
  styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
  imgSrc: ["'self'", "blob:", "data:", "https://*.googleapis.com", "https://*.gstatic.com"],
  mediaSrc: ["'self'", "blob:", "data:"],
  connectSrc: [
    "'self'",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "https://*.cloudfunctions.net",
    "wss://*.firebaseio.com"
  ],
  frameSrc: ["'self'", "https://*.firebaseapp.com", "https://accounts.google.com"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
} as const;

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production'
    ? { directives: cspDirectives as any }
    : { reportOnly: true, directives: cspDirectives as any },
  crossOriginEmbedderPolicy: false
}));

// Public health probe for Cloud Run / Marketplace listing health checks.
// Mounted AFTER helmet (so CSP headers apply) but BEFORE the /api/ rate
// limiter and verifyAuth — Cloud Run probes hit this endpoint frequently
// and without an auth token, so it must remain unauthenticated and
// unthrottled. Handler extracted to src/server/routes/health.ts in
// Round 16 R5 Phase 1 split. Final path is preserved: GET /api/health.
app.use("/api", healthRouter);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes"
});

app.use("/api/", limiter);

// `geminiLimiter` extracted to src/server/middleware/limiters.ts in
// Round 16 R5 Phase 1 split.

const sessionSecret = (() => {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error("FATAL ERROR: SESSION_SECRET is not defined in production environment.");
  }
  const generated = crypto.randomBytes(32).toString('hex');
  console.warn(
    "⚠️  SESSION_SECRET not set — generated a random one for this dev session.\n" +
    "   Sessions will not survive a server restart. Set SESSION_SECRET in .env.local for stable dev sessions."
  );
  return generated;
})();

// Default 64kb body limit. Routes that legitimately need larger bodies (e.g.,
// PDF generation with embedded report content) opt-in with a per-route limit
// applied before the global parser short-circuits on req.body presence.
// `largeBodyJson` extracted to src/server/middleware/largeBodyJson.ts in
// Round 16 R5 Phase 1 split.
app.use((req, res, next) => {
  // Per-route override for endpoints that legitimately need >64kb payloads.
  if (req.path === '/api/reports/generate-pdf') {
    return largeBodyJson(req, res, next);
  }
  return next();
});
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    sameSite: 'lax',
    httpOnly: true
  }
}));

// `verifyAuth` extracted to src/server/middleware/verifyAuth.ts in
// Round 16 R5 Phase 1 split. Imported at the top of this file.

// `UID_REGEX` moved with the admin endpoints into
// src/server/routes/admin.ts in Round 16 R5 Phase 1 split.

// Privileged admin endpoints extracted to src/server/routes/admin.ts in
// Round 16 R5 Phase 1 split. Final paths preserved: POST /api/admin/set-role
// and POST /api/admin/revoke-access.
app.use("/api/admin", adminRouter);

// Ask Guardian Endpoint (El Cerebro Externo)
app.post("/api/ask-guardian", verifyAuth, async (req, res) => {
  const { query, stream = false } = req.body;
  
  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Unified context search using Firestore Vector Search
    const { searchRelevantContext } = await import('./src/services/ragService.js');
    const context = await searchRelevantContext(query);

    // Generate response using Gemini
    const prompt = `
      Eres "El Guardián", el núcleo de inteligencia artificial de Praeventio Guard.
      Tu propósito es proteger la vida humana, analizar normativas (leyes chilenas como DS 594, Ley 16.744) y gestionar riesgos.
      Responde de forma profesional, vigilante y altamente técnica pero accionable.

      REGLA DE ORO: Si el usuario te pregunta por procedimientos específicos o leyes, prioritiza la información en el CONTEXTO LEGAL proporcionado.
      Si no hay información específica en el contexto, usa tu base de conocimientos pero aclara que es una recomendación general.

      CONTEXTO LEGAL RELEVANTE:
      ${context}

      PREGUNTA DEL USUARIO:
      ${query}
    `;

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const responseStream = await ai.models.generateContentStream({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
        }
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const result = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: prompt,
      });

      res.json({ 
        response: result.text,
        contextUsed: context !== "No se encontró contexto legal relevante."
      });
    }

  } catch (error) {
    console.error("Error in /api/ask-guardian:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Internal server error" })}\n\n`);
      res.end();
    }
  }
});

// PDF Generation Endpoint (El Cuarto de Máquinas - Reportes Ocupacionales)
app.post("/api/reports/generate-pdf", verifyAuth, async (req, res) => {
  const { incidentId, title, content, type = 'general', metadata = {} } = req.body;
  
  try {
    const PDFDocument = (await import('pdfkit')).default;
    
    // Create a document with styling and margins appropriate for legal/occupational reports
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 },
      info: {
        Title: title || 'Reporte de Seguridad',
        Author: 'Praeventio Guard AI',
      }
    });

    const buffers: Buffer[] = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {
      const pdfData = Buffer.concat(buffers);

      // We could optionally save this buffer to Firebase Storage here before sending it down

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=Reporte_SUSESO_${incidentId || Date.now()}.pdf`);
      res.setHeader('Content-Length', pdfData.length.toString());
      res.end(pdfData);
      // Round 17 R1 — emit audit row on successful generation. Wrapped so an
      // audit-write failure can't taint a response we already sent.
      try {
        void auditServerEvent(req, 'reports.pdf_generated', 'reports', {
          type,
          incidentId: incidentId ?? null,
          bytes: pdfData.length,
        });
      } catch { /* observability never breaks request path */ }
    });

    // --- PDF Construction ---

    // 1. Header (Logo/Brand Placeholder)
    doc.rect(0, 0, doc.page.width, 100).fill('#0f172a'); // Slate 900 background header
    doc.fill('#ffffff').fontSize(24).font('Helvetica-Bold').text('Praeventio Guard', 50, 35);
    doc.fontSize(10).font('Helvetica').text('Sistema Integrado de Gestión de Riesgos', 50, 65);
    doc.text(`Doc ID: ${incidentId || `REQ-${Date.now()}`}`, 400, 35, { align: 'right' });
    doc.text(`Fecha: ${new Date().toLocaleDateString('es-CL')}`, 400, 50, { align: 'right' });
    doc.text(`Tipo: ${type.toUpperCase()}`, 400, 65, { align: 'right' });

    doc.moveDown(5); // Move below header

    // 2. Title Section
    doc.fillColor('#000000').fontSize(18).font('Helvetica-Bold').text(title || 'Documento Oficial de Seguridad Ocupacional', { align: 'center' });
    doc.moveDown(1);
    
    // 3. Divider Line
    doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#e2e8f0');
    doc.moveDown(1);

    // 4. Metadata Box (If any, e.g., location, severity, supervisor)
    if (Object.keys(metadata).length > 0) {
      doc.rect(50, doc.y, 495, (Object.keys(metadata).length * 20) + 10).fill('#f8fafc');
      doc.fillColor('#334155').fontSize(10).font('Helvetica');
      let currentY = doc.y + 5;
      for (const [key, value] of Object.entries(metadata)) {
        doc.font('Helvetica-Bold').text(`${key.toUpperCase()}: `, 60, currentY, { continued: true })
           .font('Helvetica').text(String(value));
        currentY += 20;
      }
      doc.y = currentY + 15;
    }

    // 5. Main Content (Markdown roughly converted or plain text)
    doc.fillColor('#1e293b').fontSize(11).font('Helvetica');
    
    // Simple pseudo-markdown parsing for the PDF
    const lines = content ? content.split('\n') : ['Sin contenido registrado.'];
    lines.forEach(line => {
      if (line.startsWith('# ')) {
        doc.moveDown().font('Helvetica-Bold').fontSize(14).text(line.replace('# ', '')).font('Helvetica').fontSize(11);
      } else if (line.startsWith('## ')) {
        doc.moveDown().font('Helvetica-Bold').fontSize(12).text(line.replace('## ', '')).font('Helvetica').fontSize(11);
      } else if (line.startsWith('- ') || line.startsWith('* ')) {
        doc.text(`  • ${line.substring(2)}`, { indent: 10 });
      } else if (line.trim() === '') {
        doc.moveDown(0.5);
      } else {
        doc.text(line, { align: 'justify' });
      }
    });

    // 6. Footer (Page numbers and legal disclaimer)
    const totalPages = doc.bufferedPageRange().count;
    for (let i = 0; i < totalPages; i++) {
        doc.switchToPage(i);
        doc.rect(0, doc.page.height - 50, doc.page.width, 50).fill('#f1f5f9');
        doc.fillColor('#94a3b8').fontSize(8).font('Helvetica').text(
          'Documento generado por Praeventio AI. Válido como registro interno conforme a directrices Minsal.',
          50, doc.page.height - 35
        );
        doc.text(`Página ${i + 1} de ${totalPages}`, 450, doc.page.height - 35, { align: 'right' });
    }

    doc.end();
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: "Internal server error during PDF generation" });
  }
});

// OAuth Configuration (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / SCOPES) and
// the 8 Google OAuth endpoints (calendar, fitness, drive, unlink, /url +
// /callback for primary + drive + the root-mounted /auth/google/callback)
// were extracted to src/server/routes/oauthGoogle.ts in Round 18 Phase 3
// split. Mounts live below alongside the audit/push routers.

// Server-side audit log writer. Replaces direct client `addDoc(collection(db,
// 'audit_logs'), ...)` calls — those are now denied by firestore.rules
// (audit_logs:create:false) to prevent self-fabrication of audit entries.
// Handler extracted to src/server/routes/audit.ts in Round 16 R5 Phase 1
// split. Final path preserved: POST /api/audit-log.
app.use("/api", auditRouter);

// Round 17 R3 — FCM push token registration. Closes the R15/R16 mobile
// loop: the Capacitor push plugin acquires a device token at runtime and
// calls POST /api/push/register-token so the server can `arrayUnion` it
// onto users/{uid}.fcmTokens for targeted notifications. Audit row logs
// `{ platform }` only — the raw token is a credential and MUST NOT leak
// into the append-only audit_logs trail.
app.use("/api/push", pushRouter);

// Round 18 Phase 3 split: 8 Google OAuth endpoints (unlink, /api/auth/google
// /url, /auth/google/callback, /api/calendar/list, /api/calendar/sync,
// /api/fitness/sync, /api/drive/auth/url, /api/drive/auth/callback) extracted
// to src/server/routes/oauthGoogle.ts. Two mounts because /auth/google
// /callback is registered with Google Cloud Console at a fixed path.
app.use('/api', oauthGoogleApiRouter);
app.use('/auth', oauthGoogleAuthRouter);

// 3-day climate forecast endpoint for the Zettelkasten climate-risk coupling.
// Reads from environmentBackend; returns shape: { forecast: ClimateForecastDay[] }.
// Best-effort: if upstream OpenWeather is unavailable, returns empty forecast.
app.get("/api/environment/forecast", async (req, res) => {
  const days = Math.min(7, Math.max(1, parseInt(String(req.query.days ?? '3'), 10) || 3));
  try {
    // environmentBackend currently exposes updateGlobalEnvironmentalContext
    // for current weather. A dedicated multi-day getForecast helper is a
    // follow-up; for now we degrade gracefully so useCalendarPredictions
    // doesn't crash and just skips climate-risk node generation.
    const mod = (await import('./src/services/environmentBackend.js')) as Record<string, unknown>;
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
app.post("/api/erp/sync", verifyAuth, async (req, res) => {
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
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Simulate network latency
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    res.json({ 
      success: true, 
      message: `Sincronización con ${erpType} exitosa`,
      data: {
        syncId: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        status: 'completed'
      }
    });
  } catch (error) {
    console.error(`Error syncing with ERP (${erpType}):`, error);
    res.status(500).json({ error: "Error de sincronización con ERP" });
  }
});

// IoT Webhook Ingestion Endpoint.
// Authentication (Round 17 R1 — per-tenant secret rotation):
//   1. The client may declare a tenant via `x-tenant-id` header or
//      `tenantId` body field. When supplied, the server looks up
//      `tenants/{tenantId}.iotSecret` (Admin SDK Firestore read) and uses
//      that as the expected secret for THIS request, comparing via
//      HMAC-SHA256 over the canonical body (`x-iot-signature: sha256=<hex>`
//      header). HMAC over the body — instead of a bare shared-secret header
//      — means a captured signature can't be replayed against a modified
//      payload.
//   2. If no per-tenant secret is found (or rotation flag missing), the
//      endpoint falls back to the legacy shared `IOT_WEBHOOK_SECRET` env
//      and logs `telemetry_no_per_tenant_secret`. The fallback path keeps
//      the old `x-iot-secret` header (timing-safe equality) and the
//      deprecated body `secretKey` field working for one more release.
//   3. If `IOT_WEBHOOK_SECRET` is also missing, the endpoint refuses.
//
// Operators rotate a tenant's secret via POST /api/admin/iot/rotate-secret
// (gated by `isAdminRole`); the rotation endpoint is the ONLY opportunity
// for the operator to read the raw secret — we never echo it back.
//
// Aligned with the frontend type union in src/pages/Telemetry.tsx +
// Evacuation.tsx ('wearable' | 'machinery'). 'iot', 'environmental',
// 'machine' are reserved for gateway-originated telemetry. Keep this in
// sync if the frontend union changes.
const IOT_TYPE_ALLOWLIST = new Set(['iot', 'wearable', 'machinery', 'environmental', 'machine']);

/**
 * Round 17 R1 — Look up a tenant's per-tenant IoT secret. Returns null when
 * the tenant doc is missing, the field is absent, or anything throws —
 * never crashes the request path. Caller falls back to env secret.
 */
async function lookupTenantIotSecret(tenantId: string): Promise<string | null> {
  try {
    const snap = await admin.firestore().collection('tenants').doc(tenantId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const secret = data.iotSecret;
    if (typeof secret !== 'string' || secret.length === 0) return null;
    return secret;
  } catch (err: any) {
    logger.warn('telemetry_tenant_lookup_failed', { tenantId, message: err?.message });
    return null;
  }
}

app.post("/api/telemetry/ingest", async (req, res) => {
  const { type, source, metric, value, unit, status, projectId } = req.body ?? {};

  // Per-tenant scope: header takes precedence over body (header is set by
  // gateways; body is set by mobile-edge devices that can't override hdrs).
  const headerTenantId = req.header('x-tenant-id');
  const bodyTenantId = (req.body ?? {}).tenantId;
  const tenantId =
    typeof headerTenantId === 'string' && headerTenantId.length > 0
      ? headerTenantId
      : typeof bodyTenantId === 'string' && bodyTenantId.length > 0
        ? bodyTenantId
        : null;

  const envSecret = process.env.IOT_WEBHOOK_SECRET;
  let perTenantSecret: string | null = null;
  if (tenantId) {
    perTenantSecret = await lookupTenantIotSecret(tenantId);
    if (!perTenantSecret) {
      logger.warn('telemetry_no_per_tenant_secret', { tenantId });
    }
  }

  // Decide which auth path we're on. Per-tenant: HMAC-SHA256 over the
  // RFC 8785 canonical-JSON form of the request body, header
  // `x-iot-signature: sha256=<hex>`. Env fallback: legacy x-iot-secret
  // header (or deprecated body.secretKey).
  //
  // Round 18 R6 (R6→R17 MEDIUM #2): the signing input is now the RFC 8785
  // canonical-JSON form of the parsed body (sorted keys, no whitespace,
  // shortest numeric form). Producers in any language MUST canonicalise
  // before HMACing or signatures will diverge. This is the documented,
  // intentional break of the prior `JSON.stringify(req.body)` contract —
  // see src/server/middleware/canonicalBody.ts for the rationale and the
  // LEGACY_HMAC_FALLBACK flag is honored below for emergency rollback.
  let authenticated = false;
  if (perTenantSecret) {
    const sigHeader = req.header('x-iot-signature') ?? '';
    const canonicalBody = canonicalize(req.body ?? {});
    const expectedHex = crypto
      .createHmac('sha256', perTenantSecret)
      .update(canonicalBody)
      .digest('hex');
    const expectedHeader = `sha256=${expectedHex}`;
    if (safeSecretEqual(sigHeader, expectedHeader)) {
      authenticated = true;
    } else if (process.env.LEGACY_HMAC_FALLBACK === '1') {
      // DEPRECATED — emergency rollback path. Producer is still sending
      // legacy `JSON.stringify(req.body)` HMACs. Verify under the old
      // contract; log every match so operators can see who is still on
      // the legacy path. Remove once telemetry shows zero hits.
      const legacyHex = crypto
        .createHmac('sha256', perTenantSecret)
        .update(JSON.stringify(req.body ?? {}))
        .digest('hex');
      if (safeSecretEqual(sigHeader, `sha256=${legacyHex}`)) {
        logger.warn('telemetry_hmac_legacy_fallback', { tenantId });
        authenticated = true;
      }
    }
  }

  if (!authenticated) {
    if (!envSecret) {
      logger.error("iot_webhook_misconfigured", undefined, {
        reason: "IOT_WEBHOOK_SECRET not set and no per-tenant secret matched",
      });
      return res.status(500).json({ error: "Server configuration error" });
    }
    let secretKey: unknown = req.header('x-iot-secret');
    if (typeof secretKey !== 'string' || secretKey.length === 0) {
      // Backwards-compat: accept body field for one release. DEPRECATED.
      if (typeof req.body?.secretKey === 'string' && req.body.secretKey.length > 0) {
        secretKey = req.body.secretKey;
        logger.warn('iot_webhook_secret_in_body_deprecated', {
          source: typeof source === 'string' ? source : 'unknown',
          hint: 'Move shared secret to X-IoT-Secret header; body field removed next release.',
        });
      } else {
        return res.status(401).json({ error: "Unauthorized: Invalid secret key" });
      }
    }
    if (!safeSecretEqual(secretKey as string, envSecret)) {
      return res.status(401).json({ error: "Unauthorized: Invalid secret key" });
    }
    authenticated = true;
  }

  if (!type || !source || !metric || value === undefined) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Conservative input validation before any DB write.
  if (typeof type !== 'string' || !IOT_TYPE_ALLOWLIST.has(type)) {
    return res.status(400).json({ error: "Invalid type" });
  }
  if (typeof source !== 'string' || source.length === 0 || source.length > 64) {
    return res.status(400).json({ error: "Invalid source" });
  }
  if (typeof metric !== 'string' || metric.length === 0 || metric.length > 64) {
    return res.status(400).json({ error: "Invalid metric" });
  }

  try {
    const db = admin.firestore();

    // Auto-validate with AI backend
    const validation = await autoValidateTelemetry({ type, source, metric, value, unit, status });
    const finalStatus = validation?.isAnomalous ? "alert" : (status || "normal");
    const threatLevel = validation?.threatLevel || "None";

    await db.collection('telemetry_events').add({
      type,
      source,
      metric,
      value: Number(value),
      unit: unit || "",
      status: finalStatus,
      threatLevel,
      aiValidation: validation,
      projectId: projectId || "global",
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    res.json({
      success: true,
      message: "Telemetry event ingested successfully",
      aiValidation: validation
    });
  } catch (error) {
    logger.error('iot_ingest_failed', error, { type, source, metric });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Round 17 R1 — IoT secret rotation. Admin-only. Generates a new 32-byte
// hex secret, stores it on `tenants/{tenantId}.iotSecret` along with a
// `iotSecretRotatedAt` server timestamp, audits the rotation, and returns
// the raw secret in the response body. THIS IS THE ONLY OPPORTUNITY for the
// operator to see the raw secret — subsequent reads of the tenant doc never
// echo it back through any user-facing surface.
//
// Note: this endpoint is intentionally not under /api/admin (which is the
// pre-existing `adminRouter` mount with its own surface). It lives at
// /api/admin/iot/rotate-secret directly so that mounting order is
// preserved and the body parser/limits already on /api/ apply.
app.post("/api/admin/iot/rotate-secret", verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const { tenantId } = req.body ?? {};
  if (typeof tenantId !== 'string' || tenantId.length === 0 || tenantId.length > 128) {
    return res.status(400).json({ error: 'Invalid tenantId' });
  }
  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: 'Forbidden: Requires admin role' });
    }
    const newSecret = crypto.randomBytes(32).toString('hex');
    await admin.firestore().collection('tenants').doc(tenantId).set(
      {
        iotSecret: newSecret,
        iotSecretRotatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    try {
      await auditServerEvent(req, 'admin.iot.secret_rotated', 'admin', {
        tenantId,
      });
    } catch { /* observability never breaks request path */ }
    // ONLY response surface that ever exposes the raw secret. Caller MUST
    // copy it now — it cannot be read back from Firestore via any non-admin
    // path, and even admin reads should be discouraged.
    return res.json({ secret: newSecret });
  } catch (error: any) {
    logger.error('admin_iot_rotate_failed', { callerUid, tenantId, message: error?.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Seed Glossary Endpoint (gerente-only — prevents public abuse)
app.post("/api/seed-glossary", verifyAuth, async (req, res) => {
  try {
    const callerRecord = await admin.auth().getUser((req as any).user.uid);
    if (callerRecord.customClaims?.role !== 'gerente') {
      return res.status(403).json({ error: "Forbidden: Requires gerente role" });
    }
    const { runSeed } = await import('./src/services/seedBackend.js');
    await runSeed();
    res.json({ success: true, message: "Community glossary seeded successfully" });
  } catch (error: any) {
    console.error('Error seeding glossary:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? "Internal server error" : (error.message || "Internal server error") });
  }
});

// Seed Data Endpoint (gerente-only — prevents public abuse)
app.post("/api/seed-data", verifyAuth, async (req, res) => {
  try {
    const callerRecord = await admin.auth().getUser((req as any).user.uid);
    if (callerRecord.customClaims?.role !== 'gerente') {
      return res.status(403).json({ error: "Forbidden: Requires gerente role" });
    }
    const { seedInitialData } = await import('./src/services/dataSeedService.js');
    await seedInitialData();
    res.json({ success: true, message: "Initial project data seeded successfully" });
  } catch (error: any) {
    console.error('Error seeding data:', error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? "Internal server error" : (error.message || "Internal server error") });
  }
});

// ─── Project Invitation System (Round 18 Phase 3 — moved) ─────────────────
// 6 endpoints (POST /api/projects/:id/invite, GET /api/projects/:id/members,
// DELETE /api/projects/:id/members/:uid, DELETE /api/projects/:id/invite,
// GET /api/invitations/info/:token, POST /api/invitations/:token/accept)
// plus the `buildInviteEmailHtml` helper extracted to
// src/server/routes/projects.ts. Two routers because URLs span /api/projects
// and /api/invitations.
app.use('/api/projects', projectsRouter);
app.use('/api/invitations', invitationsRouter);

// Gamification Endpoints
app.post("/api/gamification/points", verifyAuth, async (req, res) => {
  const { amount, reason } = req.body;
  const uid = (req as any).user.uid;
  try {
    await awardPoints(uid, amount, reason);
    // Round 17 R1 — audit row for awarded points (compliance trail per
    // Ley 16.744 — gamification tied to safety behaviors must be auditable).
    try {
      await auditServerEvent(req, 'gamification.points_awarded', 'gamification', {
        amount: typeof amount === 'number' ? amount : null,
        reason: typeof reason === 'string' ? reason : null,
      });
    } catch { /* observability never breaks request path */ }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/gamification/leaderboard", verifyAuth, async (req, res) => {
  try {
    const leaderboard = await getLeaderboard();
    res.json({ success: true, leaderboard });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/gamification/check-medals", verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid;
  try {
    const newMedals = await checkMedalEligibility(uid);
    // Round 17 R1 — audit row for medal checks. Records the count of new
    // medals awarded; the medal IDs themselves are NOT secrets but live in
    // user_stats so we keep the audit row lightweight.
    try {
      await auditServerEvent(req, 'gamification.medals_checked', 'gamification', {
        newMedalCount: Array.isArray(newMedals) ? newMedals.length : 0,
      });
    } catch { /* observability never breaks request path */ }
    res.json({ success: true, newMedals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Safety Coach Endpoint
//
// Round 17 R1 — was unverified-projectId. Clients NOT sending projectId in
// body now get 400; clients sending wrong-tenant projectId now get 403.
// The endpoint reads RAG context (incidents) scoped by projectId, so a
// missing membership check would let a token from tenant A pull tenant B
// context. `assertProjectMemberFromBody` enforces this; we additionally
// require a non-empty projectId here (the middleware is no-op when absent
// to keep audit-log-style optional callers working, but coach/chat MUST
// have a tenant scope).
app.post(
  "/api/coach/chat",
  verifyAuth,
  assertProjectMemberFromBody(),
  async (req, res) => {
    const { message, projectId } = req.body ?? {};
    const uid = (req as any).user.uid;
    if (typeof projectId !== 'string' || projectId.length === 0) {
      return res.status(400).json({ error: 'projectId is required' });
    }
    try {
      const { getSafetyCoachResponse } = await import('./src/services/coachBackend.js');
      const db = admin.firestore();
      const userStats = (await db.collection('user_stats').doc(uid).get()).data() || { points: 0, medals: [], loginStreak: 0 };
      const recentIncidents = (await db.collection('incidents').where('projectId', '==', projectId).limit(5).get()).docs.map(d => d.data());

      const response = await getSafetyCoachResponse(uid, userStats, recentIncidents, message);

      // Round 17 R1 — audit row tagged with projectId for tenant trail.
      try {
        await auditServerEvent(req, 'coach.chat', 'coach', {
          projectId,
          messageLength: typeof message === 'string' ? message.length : 0,
        }, { projectId });
      } catch { /* observability never breaks request path */ }

      res.json({ success: true, response });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  },
);

// Legal Monitor: scan BCN knowledge base for normative impact on system modules
app.get("/api/legal/check-updates", verifyAuth, async (req, res) => {
  try {
    const { bcnKnowledgeBase } = await import('./src/data/bcnKnowledgeBase.js');
    const geminiBackend = await import('./src/services/geminiBackend.js');
    const modulesSummary = "Riesgos, Trabajadores, EPP, Hallazgos, Incidentes, Capacitación, Salud Ocupacional, Comité Paritario, Normativas, Proyectos, Emergencia";
    const results = await Promise.all(
      bcnKnowledgeBase.map(async (law: any) => {
        const analysis = await (geminiBackend.scanLegalUpdates as Function)(law.title, law.content, modulesSummary);
        return { lawId: law.id, title: law.title, lastUpdated: law.lastUpdated, relevantModules: law.relevantModules, ...analysis };
      })
    );
    res.json({ results });
  } catch (error: any) {
    console.error("Error in legal check-updates:", error);
    res.status(500).json({ error: error.message });
  }
});

// Gemini API Proxy
const ALLOWED_GEMINI_ACTIONS = [
  'generateEmbeddingsBatch',
  'autoConnectNodes',
  'semanticSearch',
  'analyzeFastCheck',
  'predictGlobalIncidents',
  'analyzeRiskWithAI',
  'analyzePostureWithAI',
  'generateEmergencyPlan',
  'analyzeSafetyImage',
  'generateISOAuditChecklist',
  'generatePTS',
  'generatePTSWithManufacturerData',
  'generateEmergencyScenario',
  'generateRealisticIoTEvent',
  'processDocumentToNodes',
  'simulateRiskPropagation',
  'enrichNodeData',
  'analyzeRootCauses',
  'queryBCN',
  'getChatResponse',
  'getSafetyAdvice',
  'generateActionPlan',
  'generateSafetyReport',
  'auditAISuggestion',
  'generatePersonalizedSafetyPlan',
  'analyzeDocumentCompliance',
  'generateTrainingRecommendations',
  'investigateIncidentWithAI',
  'auditProjectComplianceWithAI',
  'analyzeAttendancePatterns',
  'generateSafetyCapsule',
  'suggestRisksWithAI',
  'suggestNormativesWithAI',
  'syncNodeToNetwork',
  'syncBatchToNetwork',
  'generateCompensatoryExercises',
  'analyzeBioImage',
  'generatePredictiveForecast',
  'generateOperationalTasks',
  'generateEmergencyPlanJSON',
  'forecastSafetyEvents',
  'analyzeRiskNetwork',
  'predictAccidents',
  'analyzeSiteMapDensity',
  'generateTrainingQuiz',
  'validateRiskImageClick',
  'calculateDynamicEvacuationRoute',
  'processAudioWithAI',
  'analyzeVisionImage',
  'verifyEPPWithAI',
  'analyzeRiskNetworkHealth',
  'analyzeFeedPostForRiskNetwork',
  'analyzePsychosocialRisks',
  'auditLegalGap',
  'evaluateNormativeImpact',
  'analyzeChemicalRisk',
  'suggestChemicalSubstitution',
  'generateStressPreventionTips',
  'generateShiftHandoverInsights',
  'analyzeShiftFatiguePatterns',
  'generateCustomSafetyTraining',
  'optimizePPEInventory',
  'calculateStructuralLoad',
  'designHazmatStorage',
  'evaluateMinsalCompliance',
  'generateModuleRecommendations',
  'generateExecutiveSummary',
  'analyzeFaenaRiskWithAI',
  'extractAcademicSummary',
  'calculateComplianceSummary',
  'processGlobalSafetyAudit',
  'calculatePreventionROI',
  'generateSusesoFormMetadata',
  'predictEPPReplacement',
  'auditEPPCompliance',
  'suggestMeetingAgenda',
  'summarizeAgreements',
  'mapRisksToSurveillance',
  'analyzeHealthPatterns',
  'analyzeRiskCorrelations',
  'downloadSpecificNormative',
  'searchRelevantContext',
  'getNutritionSuggestion',
  'scanLegalUpdates'
];

app.post("/api/gemini", verifyAuth, geminiLimiter, async (req, res) => {
  const { action, args } = req.body;
  
  if (!ALLOWED_GEMINI_ACTIONS.includes(action)) {
    return res.status(403).json({ error: `Forbidden: Action ${action} is not allowed` });
  }

  try {
    const geminiBackend = await import('./src/services/geminiBackend.js');
    if (typeof geminiBackend[action as keyof typeof geminiBackend] === 'function') {
      const result = await (geminiBackend[action as keyof typeof geminiBackend] as Function)(...args);
      res.json({ result });
    } else {
      res.status(400).json({ error: `Action ${action} not found` });
    }
  } catch (error: any) {
    console.error(`Error in Gemini API Proxy for ${action}:`, error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? "Internal server error" : (error.message || "Internal server error") });
  }
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production") {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Billing routes — extracted to src/server/routes/billing.ts in Round 17 R2
// Phase 2 split. Two mounts because /billing/webpay/return MUST live at the
// root (Transbank commerce config has the exact path) while the rest of the
// billing surface stays under /api/billing/.
app.use("/api/billing", billingApiRouter);
app.use("/billing", billingWebpayRouter);

// Initialize RAG system asynchronously
initializeRAG().catch(console.error);

// Start background environmental polling (every 10 minutes)
setInterval(() => {
  updateGlobalEnvironmentalContext().catch(console.error);
}, 10 * 60 * 1000);

// Run immediately at startup
updateGlobalEnvironmentalContext().catch(console.error);

// Setup Realtime Triggers (Simulated Cloud Functions via Firebase Admin)
const setupBackgroundTriggers = () => {
  try {
    const db = admin.firestore();
    let isInitialLoadIncidents = true;
    let isInitialLoadRAG = true;

    // Trigger 1: Listen to new critical incidents → real FCM push to supervisors
    db.collection('nodes')
      .where('type', 'in', ['Hallazgo', 'Incidente', 'Riesgo'])
      .onSnapshot((snapshot) => {
        if (isInitialLoadIncidents) {
          isInitialLoadIncidents = false;
          return;
        }
        
        snapshot.docChanges().forEach(async (change) => {
          if (change.type === 'added') {
            const data = change.doc.data();
            const isCritical = data.metadata?.severity === 'Crítica' || data.metadata?.severity === 'Alta';
            if (!isCritical || !data.projectId) return;

            try {
              // Gather FCM tokens of supervisors/gerentes in this project
              const membersSnap = await db.collection(`projects/${data.projectId}/members`).get();
              const supervisorUids: string[] = [];
              membersSnap.forEach(d => {
                const role = d.data().role;
                if (role === 'supervisor' || role === 'gerente' || role === 'prevencionista') {
                  supervisorUids.push(d.id);
                }
              });

              if (supervisorUids.length === 0) return;

              const tokenDocs = await Promise.all(
                supervisorUids.map(uid => db.collection('users').doc(uid).get())
              );
              const tokens = tokenDocs
                .map(d => d.data()?.fcmToken as string | undefined)
                .filter((t): t is string => !!t);

              if (tokens.length === 0) return;

              await admin.messaging().sendEachForMulticast({
                tokens,
                notification: {
                  title: `⚠️ Incidente ${data.metadata?.severity || 'Crítico'}`,
                  body: `${data.title || 'Nuevo incidente'} — ${data.metadata?.location || 'Ver detalles en la app'}`,
                },
                data: { projectId: data.projectId, nodeId: change.doc.id },
                android: { priority: 'high' },
              });

              // Also send CPHS alert email to supervisors who have emails registered
              const emailRecipients = tokenDocs
                .map(d => d.data()?.email as string | undefined)
                .filter((e): e is string => !!e && e.includes('@'));
              if (emailRecipients.length > 0 && process.env.RESEND_API_KEY) {
                const projectSnap = await db.collection('projects').doc(data.projectId).get();
                const projectName = projectSnap.data()?.name || 'Proyecto';
                const severity = data.metadata?.severity || data.metadata?.criticidad || 'Alta';
                const severityColor: Record<string, string> = { 'Crítica': '#ef4444', 'Alta': '#f97316', 'Media': '#eab308', 'Baja': '#22c55e' };
                const color = severityColor[severity] || '#6b7280';
                const date = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });
                const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:sans-serif;background:#f4f4f5"><div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)"><div style="background:#09090b;padding:24px 32px"><span style="font-size:20px;font-weight:900;color:#10b981">GUARDIAN</span><span style="font-size:20px;font-weight:900;color:#fff"> PRAEVENTIO</span></div><div style="padding:32px"><div style="display:inline-block;padding:4px 12px;background:${color}20;border:1px solid ${color}40;border-radius:8px;margin-bottom:16px"><span style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase">⚠ Alerta CPHS — ${severity}</span></div><h2 style="margin:0 0 8px;font-size:20px;font-weight:900;color:#09090b">${data.title || 'Nuevo incidente crítico'}</h2><p style="margin:0 0 24px;font-size:14px;color:#71717a;line-height:1.6">${data.description || ''}</p><table style="width:100%;border-collapse:collapse"><tr><td style="padding:10px 0;border-bottom:1px solid #f4f4f5;font-size:12px;color:#a1a1aa;font-weight:700;text-transform:uppercase">Proyecto</td><td style="padding:10px 0;border-bottom:1px solid #f4f4f5;font-size:13px;font-weight:600">${projectName}</td></tr><tr><td style="padding:10px 0;font-size:12px;color:#a1a1aa;font-weight:700;text-transform:uppercase">Detectado</td><td style="padding:10px 0;font-size:13px;font-weight:600">${date}</td></tr></table><p style="margin:24px 0 0;font-size:11px;color:#a1a1aa;text-align:center">Aviso automático generado por Guardian Praeventio para el Comité Paritario.</p></div></div></body></html>`;
                await resend.emails.send({
                  from: 'Praeventio Guard <noreply@praeventio.net>',
                  to: emailRecipients,
                  subject: `[CPHS ${projectName}] Incidente ${severity}: ${data.title || 'Nuevo incidente'}`,
                  html,
                }).catch(e => console.warn('[TRIGGER: CPHS Email] delivery failed:', e));
              }
            } catch (err) {
              console.error('[TRIGGER: FCM Push] Error:', err);
            }
          }
        });
      }, (error) => {
        console.error("Error in incidents background trigger listener:", error);
      });

    // Trigger 2: RAG Continuous Ingestion Pipeline (Auto-Vectorize Knowledge)
    // Whenever a new normative, PTS, protocol, or document node is created/updated, generate embeddings
    db.collection('nodes')
      .where('type', 'in', ['normative', 'pts', 'protocol', 'document'])
      .onSnapshot(async (snapshot) => {
        if (isInitialLoadRAG) {
          isInitialLoadRAG = false;
          return;
        }

        for (const change of snapshot.docChanges()) {
          // Process newly added or modified documents
          if (change.type === 'added' || change.type === 'modified') {
            const data = change.doc.data();
            
            // Skip processing if it already has an embedding or is currently being processed
            if (data._ragProcessingStatus === 'completed' || data._ragProcessingStatus === 'processing') {
              continue;
            }

            console.log(`[TRIGGER: RAG Pipeline] => Generating embeddings for: ${change.doc.id} (${data.type})`);
            
            try {
              // Mark as processing
              await change.doc.ref.update({ _ragProcessingStatus: 'processing' });
              
              const { GoogleGenAI } = await import('@google/genai');
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              
              // Prepare text for vectorization
              const textToEmbed = `Título: ${data.title || ''}\nDescripción: ${data.description || ''}\nContenido: ${data.content || ''}`;
              
              if (textToEmbed.trim().length < 10) {
                 await change.doc.ref.update({ _ragProcessingStatus: 'skipped_too_short' });
                 continue;
              }

              // Assume generic embed call or load the geminiBackend method
              const { generateEmbeddingsBatch } = await import('./src/services/geminiBackend.js');
              const [embedding] = await generateEmbeddingsBatch([textToEmbed]);

              if (embedding && embedding.length > 0) {
                // Save vector to Firestore (requires Enterprise setup ideally or simple array for now)
                await change.doc.ref.update({
                  embedding,
                  _ragProcessingStatus: 'completed',
                  _ragProcessedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log(`[TRIGGER: RAG Pipeline] ✅ Embeddings successfully saved for ${change.doc.id}`);
              } else {
                throw new Error("Empty embedding returned");
              }
            } catch (error) {
              console.error(`[TRIGGER: RAG Pipeline] ❌ Error processing ${change.doc.id}:`, error);
              await change.doc.ref.update({ 
                 _ragProcessingStatus: 'failed',
                 _ragError: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }
        }
      }, (error) => {
        console.error("Error in RAG background trigger listener:", error);
      });

  } catch (err) {
    console.error("Failed to setup background triggers:", err);
  }
};

// ─────────────────────────────────────────────────────────────────────
// Round 18 Phase 3 split — Curriculum claims + WebAuthn challenge.
//
// 5 curriculum endpoints (POST /claim, GET /claims, POST /claim/:id/resend,
// GET /referee/:token, POST /referee/:token) plus the WebAuthn challenge
// issuance endpoint extracted to src/server/routes/curriculum.ts. The
// helpers (`buildCurriculumAuditor`, `buildClaimEmailHtml`, `buildWebAuthnDb`)
// moved with them — they had no other callers in server.ts. Mounted
// via TWO routers because the WebAuthn endpoint lives at /api/auth/...
// not /api/curriculum/...
// ─────────────────────────────────────────────────────────────────────
app.use('/api/curriculum', curriculumRouter);
app.use('/api/auth', webauthnChallengeRouter);

// Round 13: Express terminal error middleware. MUST be the last `app.use(...)`
// — Express only treats 4-arg middleware as an error handler, and only
// the first one registered after the failing route runs. Any unhandled
// exception thrown synchronously inside a route, or an `await`-rejected
// promise that bubbles out of an async handler with `next(err)` (or with
// Express 5's automatic forwarding), lands here.
//
// Safety contract:
//   • Wrapped in try/catch — observability MUST NOT break the response.
//   • Sends 500 ONLY if headers haven't been sent (protects against
//     double-send when the route already started streaming).
//   • Does NOT call `next(err)` — this is the terminal handler. Calling
//     next would defer to Express's default handler which writes an HTML
//     error page; the JSON shape we emit here is what callers expect.
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      {
        endpoint: req.url,
        tags: { method: req.method },
      },
    );
  } catch (trackerError) {
    // Observability layer faulted — log via console (NOT logger, to
    // avoid recursion through observability) and keep going.
    // eslint-disable-next-line no-console
    console.warn('[observability] error tracker captureException failed:', trackerError);
  }
  try {
    logger.error('express_unhandled_error', err instanceof Error ? err : new Error(String(err)), {
      method: req.method,
      url: req.url,
    });
  } catch {
    /* logger faulted — last-ditch fallback below still fires */
  }
  if (!res.headersSent) {
    res.status(500).json({ error: 'internal_server_error' });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);

  if (admin.apps.length > 0) {
    setupBackgroundTriggers();
  }

  // Proactive Project Health Checks (Every 6 hours to balance quota)
  setInterval(async () => {
    try {
      const db = admin.firestore();
      const projects = await db.collection('projects').get();
      const { performProjectSafetyHealthCheck } = await import('./src/services/safetyEngineBackend.js');
      
      for (const project of projects.docs) {
        await performProjectSafetyHealthCheck(project.id).catch(e => 
          console.error(`Error in health check for ${project.id}:`, e)
        );
      }
    } catch (error) {
      console.error("Error in background health checks:", error);
    }
  }, 6 * 60 * 60 * 1000);
});
