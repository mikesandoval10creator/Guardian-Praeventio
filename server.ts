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
import { saveTokens, getValidAccessToken, revokeTokens } from "./src/services/oauthTokenStore.js";
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

// OAuth Configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.heart_rate.read',
  'https://www.googleapis.com/auth/fitness.body.read'
].join(' ');

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

// Server-side OAuth unlink: invoked by client logout flow before signOut.
// Deletes stored tokens for both Google providers. Idempotent — safe to call
// when no tokens exist.
app.post("/api/oauth/unlink", verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid;
  try {
    await Promise.all([
      revokeTokens({ uid, provider: 'google' }),
      revokeTokens({ uid, provider: 'google-drive' }),
    ]);
    // Round 17 R1 — audit row for revocation. Defensively wrapped so a
    // stale Firestore handle can't 5xx an otherwise successful unlink.
    try {
      await auditServerEvent(req, 'oauth.unlink', 'oauth', {
        providers: ['google', 'google-drive'],
      });
    } catch { /* observability never breaks request path */ }
    res.json({ success: true });
  } catch (error: any) {
    logger.error('oauth_unlink_failed', { uid, message: error?.message });
    res.status(500).json({
      error: "Failed to unlink OAuth tokens",
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

// API Routes
app.get("/api/auth/google/url", verifyAuth, (req, res) => {
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/auth/google/callback`;

  const state = crypto.randomBytes(16).toString('hex');
  const sess = req.session as any;
  sess.oauthState = state;
  // Bind this OAuth flow to the authenticated user. The callback runs in a
  // popup that shares the session cookie, so we recover the UID there
  // without ever exposing it (or the resulting tokens) to the browser.
  sess.oauthInitiator = { uid: (req as any).user.uid, provider: 'google' as const };

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state: state
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

app.get("/auth/google/callback", async (req, res) => {
  const { code, state } = req.query;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/auth/google/callback`;

  const sess = req.session as any;
  if (!state || state !== sess.oauthState) {
    return res.status(403).send("Invalid state parameter (CSRF protection)");
  }
  const initiator = sess.oauthInitiator;
  if (!initiator?.uid || initiator.provider !== 'google') {
    return res.status(403).send("OAuth initiator missing from session");
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID || "",
        client_secret: GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await response.json();
    if (!tokens.access_token) {
      console.error('Google token exchange returned no access_token:', tokens);
      return res.status(500).send("Token exchange failed");
    }

    // Store server-side; never reaches the browser.
    await saveTokens({ uid: initiator.uid, provider: 'google' }, tokens);

    // Round 17 R1 — audit the link event. The endpoint is intentionally
    // unauthed (verifyAuth never ran), so we recover the actor uid from the
    // session oauth-state initiator that /api/auth/google/url stamped before
    // the redirect. Wrapped so an audit failure can't break the popup
    // closure flow that the SPA depends on.
    try {
      await auditServerEvent(req, 'oauth.link', 'oauth', { provider: 'google' }, {
        actorOverride: { uid: initiator.uid, email: null },
      });
    } catch { /* observability never breaks request path */ }

    delete sess.oauthState;
    delete sess.oauthInitiator;

    // Tell the popup that linking succeeded — payload contains NO tokens.
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'GOOGLE_AUTH_SUCCESS',
                linked: true
              }, '${appUrl}');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Cuenta vinculada exitosamente. Puedes cerrar esta ventana.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in Google Auth Callback:', error);
    res.status(500).send("Error during authentication");
  }
});

// Proxy for Google Calendar API to avoid CORS.
// Uses tokens stored server-side via /auth/google/callback; the client never
// holds an OAuth access_token or refresh_token.
// List upcoming Calendar events (next 30 days) for predictive features.
// Used by useCalendarPredictions to detect already-scheduled CPHS meetings,
// ODI trainings, etc. and suppress duplicate suggestions.
app.get("/api/calendar/list", verifyAuth, async (req, res) => {
  const uid = (req as any).user.uid;
  const accessToken = await getValidAccessToken(
    { uid, provider: 'google' },
    GOOGLE_CLIENT_ID || "",
    GOOGLE_CLIENT_SECRET || "",
  );
  if (!accessToken) {
    // Caller treats empty list as "no calendar" — return 200 with [] so the
    // predictions hook doesn't surface a noisy error to the user when they
    // haven't linked Google Calendar yet.
    return res.json({ items: [] });
  }
  try {
    const now = new Date();
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      timeMin: now.toISOString(),
      timeMax: in30Days.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
    });
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      logger.warn('calendar_list_upstream_failed', { uid, status: response.status });
      return res.json({ items: [] });
    }
    const data = await response.json();
    res.json({ items: data.items ?? [] });
  } catch (error: any) {
    logger.error('calendar_list_failed', { uid, message: error?.message });
    res.json({ items: [] }); // graceful degradation
  }
});

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

app.post("/api/calendar/sync", verifyAuth, async (req, res) => {
  const { challenges } = req.body;
  const uid = (req as any).user.uid;

  const accessToken = await getValidAccessToken(
    { uid, provider: 'google' },
    GOOGLE_CLIENT_ID || "",
    GOOGLE_CLIENT_SECRET || "",
  );
  if (!accessToken) {
    return res.status(401).json({ error: "Google account not linked" });
  }

  try {
    const results = [];
    for (const challenge of challenges) {
      const event = {
        summary: `Desafío Praeventio: ${challenge}`,
        description: 'Objetivo de seguridad y salud en el trabajo planificado desde Praeventio Guard.',
        start: {
          dateTime: new Date().toISOString(),
          timeZone: 'UTC',
        },
        end: {
          dateTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour later
          timeZone: 'UTC',
        },
      };

      const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      const data = await response.json();
      results.push(data);
    }

    // Round 17 R1 — audit the sync. Body shape: { challenges } (no PII
    // beyond the challenge titles) — we record the count, not the raw text.
    try {
      await auditServerEvent(req, 'calendar.sync', 'calendar', {
        count: Array.isArray(challenges) ? challenges.length : 0,
      });
    } catch { /* observability never breaks request path */ }

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error syncing with Google Calendar:', error);
    res.status(500).json({ error: "Failed to sync with Google Calendar" });
  }
});

// Proxy for Google Fit API.
// Uses tokens stored server-side via /auth/google/callback; the client never
// holds an OAuth access_token or refresh_token.
//
// DEPRECATED — Round 3 of HEALTH_CONNECT_MIGRATION.md.
// Google Fit REST sunsets in 2026; the on-device replacements (Health
// Connect on Android, HealthKit on iOS) are already wired through
// `src/services/health/`. This endpoint stays alive as a web/legacy fallback
// until 2026-12-31, after which the route is removed entirely.
app.post("/api/fitness/sync", verifyAuth, async (req, res) => {
  // Sunset / Deprecation signaling per RFC 8594. Clients that honor these
  // headers can surface their own deprecation UI; we also instrument every
  // hit so we can quantify residual call volume before the hard cutoff.
  res.setHeader('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
  res.setHeader('Deprecation', 'Wed, 31 Dec 2026 23:59:59 GMT');
  res.setHeader('Link', '</api/health-data>; rel="successor-version"');

  const uid = (req as any).user?.uid;

  // Structured deprecation log so we can quantify residual usage of the
  // legacy endpoint and confirm Telemetry.tsx truly stopped calling it.
  logger.warn('fitness_sync_deprecated_called', {
    uid,
    userAgent: req.header('user-agent') ?? 'unknown',
    sunset: '2026-12-31',
    successor: 'health-connect|healthkit (on-device, no server hop)',
  });

  const accessToken = await getValidAccessToken(
    { uid, provider: 'google' },
    GOOGLE_CLIENT_ID || "",
    GOOGLE_CLIENT_SECRET || "",
  );
  if (!accessToken) {
    return res.status(401).json({ error: "Google account not linked" });
  }

  try {
    const endTime = Date.now();
    const startTime = endTime - (7 * 24 * 60 * 60 * 1000); // Last 7 days

    const response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        aggregateBy: [
          { dataTypeName: 'com.google.heart_rate.bpm' },
          { dataTypeName: 'com.google.step_count.delta' }
        ],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: startTime,
        endTimeMillis: endTime
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Fit API error:', errorText);
      return res.status(response.status).json({ error: "Failed to fetch Google Fit data" });
    }

    const data = await response.json();
    res.json({ success: true, data });
  } catch (error) {
    console.error('Error syncing with Google Fit:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Google Drive Integration
app.get("/api/drive/auth/url", verifyAuth, (req, res) => {
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/api/drive/auth/callback`;

  const state = crypto.randomBytes(16).toString('hex');
  const sess = req.session as any;
  sess.driveOauthState = state;
  sess.driveOauthInitiator = { uid: (req as any).user.uid, provider: 'google-drive' as const };

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID || "",
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.file',
    access_type: 'offline',
    prompt: 'consent',
    state: state
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url: authUrl });
});

app.get("/api/drive/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const redirectUri = `${appUrl}/api/drive/auth/callback`;

  const sess = req.session as any;
  if (!state || state !== sess.driveOauthState) {
    return res.status(403).send("Invalid state parameter (CSRF protection)");
  }
  const initiator = sess.driveOauthInitiator;
  if (!initiator?.uid || initiator.provider !== 'google-drive') {
    return res.status(403).send("OAuth initiator missing from session");
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID || "",
        client_secret: GOOGLE_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await response.json();
    if (!tokens.access_token) {
      console.error('Drive token exchange returned no access_token:', tokens);
      return res.status(500).send("Token exchange failed");
    }

    await saveTokens({ uid: initiator.uid, provider: 'google-drive' }, tokens);

    delete sess.driveOauthState;
    delete sess.driveOauthInitiator;

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({
                type: 'DRIVE_AUTH_SUCCESS',
                linked: true
              }, '${appUrl}');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Google Drive vinculado exitosamente. Puedes cerrar esta ventana.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Error in Google Drive Auth Callback:', error);
    res.status(500).send("Error during authentication");
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

  // Decide which auth path we're on. Per-tenant: HMAC over canonical JSON
  // body, header `x-iot-signature: sha256=<hex>`. Env fallback: legacy
  // x-iot-secret header (or deprecated body.secretKey).
  let authenticated = false;
  if (perTenantSecret) {
    const sigHeader = req.header('x-iot-signature') ?? '';
    const expectedHex = crypto
      .createHmac('sha256', perTenantSecret)
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');
    const expectedHeader = `sha256=${expectedHex}`;
    if (safeSecretEqual(sigHeader, expectedHeader)) {
      authenticated = true;
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

// ─── Project Invitation System ───────────────────────────────────────────────

function buildInviteEmailHtml({ projectName, inviterName, role, token }: { projectName: string; inviterName: string; role: string; token: string }) {
  const appUrl = process.env.APP_URL || 'https://app.praeventio.net';
  const acceptUrl = `${appUrl}/invite?token=${token}`;
  const roleLabels: Record<string, string> = {
    gerente: 'Gerente de Prevención',
    prevencionista: 'Prevencionista de Riesgos',
    supervisor: 'Supervisor',
    director_obra: 'Director de Obra',
    medico_ocupacional: 'Médico Ocupacional',
    operario: 'Operario',
    contratista: 'Contratista',
  };
  const roleLabel = roleLabels[role] || role;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invitación a Praeventio</title></head><body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f4f4f5;color:#18181b">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <tr><td style="background:#09090b;padding:32px 40px;text-align:center">
      <span style="font-size:24px;font-weight:900;color:#10b981;letter-spacing:-1px">PRAEVENTIO</span>
      <span style="font-size:10px;font-weight:700;color:#6b7280;display:block;letter-spacing:4px;margin-top:2px">GUARD</span>
    </td></tr>
    <tr><td style="padding:40px">
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:900;color:#09090b">Fuiste invitado a un proyecto</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#71717a"><strong style="color:#09090b">${inviterName}</strong> te invitó a unirte a <strong style="color:#09090b">"${projectName}"</strong> como <strong style="color:#10b981">${roleLabel}</strong>.</p>
      <div style="text-align:center;margin:32px 0">
        <a href="${acceptUrl}" style="display:inline-block;background:#10b981;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;letter-spacing:0.5px">Aceptar Invitación</a>
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;text-align:center">Si no esperabas esta invitación, puedes ignorar este email.</p>
      <p style="margin:8px 0 0;font-size:11px;color:#d4d4d8;text-align:center;word-break:break-all">O copia este enlace: ${acceptUrl}</p>
    </td></tr>
    <tr><td style="background:#f9fafb;padding:20px 40px;text-align:center">
      <p style="margin:0;font-size:11px;color:#a1a1aa">© ${new Date().getFullYear()} Praeventio Guard · Plataforma de Prevención de Riesgos</p>
    </td></tr>
  </table></td></tr></table>
</body></html>`;
}

// POST /api/projects/:id/invite  — project creator sends an invitation
app.post("/api/projects/:id/invite", verifyAuth, async (req, res) => {
  const projectId = req.params.id;
  const callerUid = (req as any).user.uid;
  const { invitedEmail, invitedRole } = req.body;

  if (!invitedEmail || !invitedRole) {
    return res.status(400).json({ error: "invitedEmail and invitedRole are required" });
  }

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });

    const projectData = projectDoc.data()!;
    if (projectData.createdBy !== callerUid) {
      const callerRecord = await admin.auth().getUser(callerUid);
      if (callerRecord.customClaims?.role !== 'gerente' && callerRecord.customClaims?.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only the project creator can invite members" });
      }
    }

    // Check if user is already a member
    const existingMembers: string[] = projectData.members || [];
    try {
      const invitedUser = await admin.auth().getUserByEmail(invitedEmail);
      if (existingMembers.includes(invitedUser.uid)) {
        return res.status(409).json({ error: "User is already a member of this project" });
      }
    } catch {
      // User doesn't exist yet — invitation will add them when they register and accept
    }

    // Check for existing pending invitation
    const existingInvite = await admin.firestore().collection('invitations')
      .where('projectId', '==', projectId)
      .where('invitedEmail', '==', invitedEmail)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (!existingInvite.empty) {
      return res.status(409).json({ error: "A pending invitation already exists for this email" });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const inviteRef = await admin.firestore().collection('invitations').add({
      projectId,
      projectName: projectData.name || '',
      invitedEmail,
      invitedRole,
      invitedBy: callerUid,
      token,
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt,
    });

    // Send invitation email — failure does NOT block the response
    try {
      const callerRecord = await admin.auth().getUser(callerUid);
      const inviterName = callerRecord.displayName || callerRecord.email || 'Tu equipo';
      await resend.emails.send({
        from: 'Praeventio Guard <noreply@praeventio.net>',
        to: invitedEmail,
        subject: `${inviterName} te invitó a "${projectData.name || 'un proyecto'}" en Praeventio`,
        html: buildInviteEmailHtml({ projectName: projectData.name || 'un proyecto', inviterName, role: invitedRole, token }),
      });
    } catch (emailErr) {
      console.warn('Email delivery failed (invitation stored successfully):', emailErr);
    }

    res.json({ success: true, inviteId: inviteRef.id, token, expiresAt });
  } catch (error: any) {
    console.error("Error creating invitation:", error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? "Internal server error" : (error.message || "Internal server error") });
  }
});

// GET /api/invitations/info/:token  — public, returns safe invite preview (no auth required)
app.get("/api/invitations/info/:token", async (req, res) => {
  const { token } = req.params;
  try {
    const snapshot = await admin.firestore().collection('invitations')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .limit(1)
      .get();
    if (snapshot.empty) return res.status(404).json({ error: "Invitation not found or already used" });
    const invite = snapshot.docs[0].data();
    if (new Date(invite.expiresAt) < new Date()) return res.status(410).json({ error: "Invitation has expired" });
    // Return only safe, non-sensitive fields
    res.json({
      projectName: invite.projectName || 'un proyecto',
      invitedRole: invite.invitedRole,
      invitedEmail: invite.invitedEmail,
      expiresAt: invite.expiresAt,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/invitations/:token/accept  — invited user accepts
app.post("/api/invitations/:token/accept", verifyAuth, async (req, res) => {
  const { token } = req.params;
  const callerUid = (req as any).user.uid;
  const callerEmail = (req as any).user.email;

  try {
    const snapshot = await admin.firestore().collection('invitations')
      .where('token', '==', token)
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "Invitation not found or already used" });
    }

    const inviteDoc = snapshot.docs[0];
    const invite = inviteDoc.data();

    if (invite.invitedEmail !== callerEmail) {
      return res.status(403).json({ error: "This invitation was sent to a different email address" });
    }

    if (new Date(invite.expiresAt) < new Date()) {
      await inviteDoc.ref.update({ status: 'expired' });
      return res.status(410).json({ error: "Invitation has expired" });
    }

    const projectRef = admin.firestore().collection('projects').doc(invite.projectId);
    await projectRef.update({
      members: admin.firestore.FieldValue.arrayUnion(callerUid),
      [`memberRoles.${callerUid}`]: invite.invitedRole,
    });

    await inviteDoc.ref.update({ status: 'accepted', acceptedAt: new Date().toISOString() });

    res.json({ success: true, projectId: invite.projectId, role: invite.invitedRole });
  } catch (error: any) {
    console.error("Error accepting invitation:", error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? "Internal server error" : (error.message || "Internal server error") });
  }
});

// GET /api/projects/:id/members  — list members with display info and roles
app.get("/api/projects/:id/members", verifyAuth, async (req, res) => {
  const projectId = req.params.id;
  const callerUid = (req as any).user.uid;

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });

    const projectData = projectDoc.data()!;
    const memberUids: string[] = projectData.members || [];
    const memberRoles: Record<string, string> = projectData.memberRoles || {};

    if (!memberUids.includes(callerUid)) {
      const callerRecord = await admin.auth().getUser(callerUid);
      if (callerRecord.customClaims?.role !== 'gerente' && callerRecord.customClaims?.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Not a project member" });
      }
    }

    const memberDetails = await Promise.all(
      memberUids.map(async (uid) => {
        try {
          const userRecord = await admin.auth().getUser(uid);
          return {
            uid,
            displayName: userRecord.displayName || userRecord.email || uid,
            email: userRecord.email || '',
            photoURL: userRecord.photoURL || null,
            role: memberRoles[uid] || 'operario',
            isCreator: uid === projectData.createdBy,
          };
        } catch {
          return { uid, displayName: uid, email: '', photoURL: null, role: memberRoles[uid] || 'operario', isCreator: false };
        }
      })
    );

    // Include pending invitations
    const pendingInvites = await admin.firestore().collection('invitations')
      .where('projectId', '==', projectId)
      .where('status', '==', 'pending')
      .get();

    const invitations = pendingInvites.docs.map(doc => ({
      id: doc.id,
      invitedEmail: doc.data().invitedEmail,
      invitedRole: doc.data().invitedRole,
      createdAt: doc.data().createdAt,
      expiresAt: doc.data().expiresAt,
    }));

    res.json({ success: true, members: memberDetails, pendingInvitations: invitations });
  } catch (error: any) {
    console.error("Error listing project members:", error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? "Internal server error" : (error.message || "Internal server error") });
  }
});

// DELETE /api/projects/:id/members/:uid  — remove a member
app.delete("/api/projects/:id/members/:uid", verifyAuth, async (req, res) => {
  const { id: projectId, uid: targetUid } = req.params;
  const callerUid = (req as any).user.uid;

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });

    const projectData = projectDoc.data()!;

    const isCreator = projectData.createdBy === callerUid;
    const isSelf = callerUid === targetUid;
    if (!isCreator && !isSelf) {
      const callerRecord = await admin.auth().getUser(callerUid);
      if (callerRecord.customClaims?.role !== 'gerente' && callerRecord.customClaims?.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only the project creator can remove members" });
      }
    }

    if (targetUid === projectData.createdBy) {
      return res.status(400).json({ error: "Cannot remove the project creator" });
    }

    await admin.firestore().collection('projects').doc(projectId).update({
      members: admin.firestore.FieldValue.arrayRemove(targetUid),
      [`memberRoles.${targetUid}`]: admin.firestore.FieldValue.delete(),
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error("Error removing project member:", error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? "Internal server error" : (error.message || "Internal server error") });
  }
});

// DELETE /api/projects/:id/invite  — project creator cancels a pending invitation
app.delete("/api/projects/:id/invite", verifyAuth, async (req, res) => {
  const projectId = req.params.id;
  const callerUid = (req as any).user.uid;
  const { inviteId } = req.body;

  if (!inviteId) {
    return res.status(400).json({ error: "inviteId is required" });
  }

  try {
    const projectDoc = await admin.firestore().collection('projects').doc(projectId).get();
    if (!projectDoc.exists) return res.status(404).json({ error: "Project not found" });

    const projectData = projectDoc.data()!;
    const isCreator = projectData.createdBy === callerUid;
    if (!isCreator) {
      const callerRecord = await admin.auth().getUser(callerUid);
      if (callerRecord.customClaims?.role !== 'gerente' && callerRecord.customClaims?.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Only the project creator can cancel invitations" });
      }
    }

    const inviteDoc = await admin.firestore().collection('invitations').doc(inviteId).get();
    if (!inviteDoc.exists) return res.status(404).json({ error: "Invitation not found" });
    if (inviteDoc.data()!.projectId !== projectId) {
      return res.status(403).json({ error: "Invitation does not belong to this project" });
    }

    await inviteDoc.ref.delete();
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error canceling invitation:", error);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? "Internal server error" : (error.message || "Internal server error") });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

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
// Round 14 — Curriculum claims (R5 agent scope).
//
// Flagship anti-fraud feature: workers create signed claims about their
// own experience, and 2 named referees co-sign via magic-link emails.
// Once both co-sign, the claim becomes immutable in Firestore. See
// `src/services/curriculum/claims.ts` for the engine + invariants.
//
// Endpoints below are intentionally placed at the end of server.ts —
// before the terminal error middleware — so they participate in the
// global error handler but do NOT interfere with R1's deletion blocks
// or KMS pre-flight at the top of the file.
// ─────────────────────────────────────────────────────────────────────
import {
  createClaim as curriculumCreateClaim,
  recordRefereeEndorsement as curriculumEndorse,
  getClaimsByWorker as curriculumGetByWorker,
  type ClaimCategory,
  type AuditLogger as CurriculumAuditLogger,
} from "./src/services/curriculum/claims.js";
import { hashToken as curriculumHashToken, generateRefereeToken as curriculumGenToken } from "./src/services/curriculum/refereeTokens.js";

/** Server-side audit-log writer for curriculum events. Uses the same
 *  audit_logs collection as /api/audit-log; differences:
 *    • userId is the server (we stamp 'system' if no caller uid is
 *      available — referee endpoint is unauthed).
 *    • timestamp is server-stamped via FieldValue.serverTimestamp().
 *  Failures are logged but never break the main flow.                */
function buildCurriculumAuditor(callerUid: string | null, callerEmail: string | null, ipMaybe?: string, uaMaybe?: string): CurriculumAuditLogger {
  return async (action, details) => {
    try {
      await admin.firestore().collection('audit_logs').add({
        action,
        module: 'curriculum',
        details: details ?? {},
        userId: callerUid ?? 'system',
        userEmail: callerEmail ?? null,
        projectId: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: ipMaybe ?? null,
        userAgent: uaMaybe ?? null,
      });
    } catch (err: any) {
      logger.error('curriculum_audit_failed', { action, message: err?.message });
    }
  };
}

function buildClaimEmailHtml({ workerName, refereeName, claimText, magicLink }: { workerName: string; refereeName: string; claimText: string; magicLink: string }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Co-firma un claim en Praeventio</title></head><body style="margin:0;padding:0;font-family:'Segoe UI',Arial,sans-serif;background:#f4f4f5;color:#18181b">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0"><tr><td align="center">
  <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">
    <tr><td style="background:#09090b;padding:32px 40px;text-align:center">
      <span style="font-size:24px;font-weight:900;color:#10b981;letter-spacing:-1px">PRAEVENTIO</span>
      <span style="font-size:10px;font-weight:700;color:#6b7280;display:block;letter-spacing:4px;margin-top:2px">GUARD</span>
    </td></tr>
    <tr><td style="padding:40px">
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:900;color:#09090b">Te nombraron como referencia</h2>
      <p style="margin:0 0 16px;font-size:14px;color:#71717a">Hola <strong style="color:#09090b">${refereeName}</strong>, <strong style="color:#09090b">${workerName}</strong> te nombró referencia en un claim verificable de su currículum profesional.</p>
      <blockquote style="margin:16px 0;padding:14px 16px;background:#f4f4f5;border-left:4px solid #10b981;border-radius:8px;font-size:13px;color:#27272a;font-style:italic">"${claimText.replace(/"/g, '&quot;')}"</blockquote>
      <p style="margin:0 0 24px;font-size:13px;color:#71717a">Si confirmas que es verídico, co-fírmalo para incorporarlo a su currículum portátil. Si no lo conoces o crees que es falso, puedes rechazarlo.</p>
      <div style="text-align:center;margin:32px 0">
        <a href="${magicLink}" style="display:inline-block;background:#10b981;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:14px 32px;border-radius:10px;letter-spacing:0.5px">Revisar y Co-firmar</a>
      </div>
      <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;text-align:center">El enlace expira en 14 días. Si no lo conoces a ${workerName}, ignora este email.</p>
      <p style="margin:8px 0 0;font-size:11px;color:#d4d4d8;text-align:center;word-break:break-all">O copia este enlace: ${magicLink}</p>
    </td></tr>
    <tr><td style="background:#f9fafb;padding:20px 40px;text-align:center">
      <p style="margin:0;font-size:11px;color:#a1a1aa">© ${new Date().getFullYear()} Praeventio Guard · Plataforma de Prevención de Riesgos</p>
    </td></tr>
  </table></td></tr></table>
</body></html>`;
}

// In-memory per-token resend rate limit. The global /api/ limiter applies
// too; this is the per-claim cooldown so a worker can't spam-resend a
// magic-link to the same referee. Resets on server restart — fine for
// MVP volumes (high-traffic abuse would still be caught upstream).
const curriculumResendCooldown = new Map<string, number>();
const CURRICULUM_RESEND_COOLDOWN_MS = 30_000;

// POST /api/curriculum/claim — worker creates a claim (signed) and the
// server fires off the 2 magic-link emails to the referees.
app.post("/api/curriculum/claim", verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;
  const ipMaybe = req.ip ?? undefined;
  const uaMaybe = req.header('user-agent') ?? undefined;
  const { claim, category, referees, signedByWorker } = req.body ?? {};

  if (typeof claim !== 'string' || claim.trim().length === 0 || claim.trim().length > 500) {
    return res.status(400).json({ error: 'claim text is required and must be ≤500 chars' });
  }
  const validCategories: ClaimCategory[] = ['experience', 'certification', 'incident_record', 'other'];
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: 'invalid category' });
  }
  if (!Array.isArray(referees) || referees.length !== 2) {
    return res.status(400).json({ error: 'exactly 2 referees are required' });
  }

  try {
    const audit = buildCurriculumAuditor(callerUid, callerEmail, ipMaybe, uaMaybe);
    const callerRecord = await admin.auth().getUser(callerUid).catch(() => null);
    const workerName = callerRecord?.displayName || callerEmail || 'Trabajador Praeventio';
    const result = await curriculumCreateClaim(
      {
        workerId: callerUid,
        workerEmail: callerEmail ?? '',
        claim,
        category,
        signedByWorker: signedByWorker ?? {},
        referees,
      },
      admin.firestore() as any,
      audit,
    );

    // Send the 2 magic-link emails. We do NOT block the response on
    // email delivery — failures are logged and the worker can use
    // /api/curriculum/claim/:id/resend to retry.
    const appUrl = process.env.APP_URL || 'https://app.praeventio.net';
    await Promise.all(result.refereeTokens.map(async (rawToken, idx) => {
      const ref = referees[idx];
      const magicLink = `${appUrl}/curriculum/referee/${rawToken}`;
      try {
        await resend.emails.send({
          from: 'Praeventio Guard <noreply@praeventio.net>',
          to: ref.email,
          subject: `${workerName} te nombró referencia en un claim — Praeventio`,
          html: buildClaimEmailHtml({
            workerName,
            refereeName: ref.name,
            claimText: claim,
            magicLink,
          }),
        });
      } catch (emailErr) {
        logger.error('curriculum_email_failed', { claimId: result.id, refereeIndex: idx, message: (emailErr as any)?.message });
      }
    }));

    res.json({ success: true, claimId: result.id });
  } catch (error: any) {
    const message = error?.message || 'Internal server error';
    // Validation-style errors thrown by the service map to 400.
    if (/required|invalid|exactly 2|distinct|500/i.test(message)) {
      return res.status(400).json({ error: message });
    }
    logger.error('curriculum_claim_create_failed', { uid: callerUid, message });
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : message });
  }
});

// GET /api/curriculum/claims — list claims for the authenticated worker.
app.get("/api/curriculum/claims", verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  try {
    const claims = await curriculumGetByWorker(callerUid, admin.firestore() as any);
    res.json({ success: true, claims });
  } catch (error: any) {
    logger.error('curriculum_claims_list_failed', { uid: callerUid, message: error?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────
// Round 17 (R5) — WebAuthn server-issued challenge endpoint.
//
// Closes the R6/R16 MEDIUM finding: client-generated WebAuthn challenges
// are replay-vulnerable. Server-issued, single-use, 5-minute-TTL
// challenges are now the only acceptable input to navigator.credentials.
//
// Round 17 — server-issued challenges replace client-generated MVP.
// Replay-resistant per ISO 27001 §A.9.4.1.
//
// GET /api/auth/webauthn/challenge — issues a fresh challenge for the
// authenticated user. Returns { challengeId, challenge } where
// `challenge` is base64-url-safe so the client can decode it back into
// a Uint8Array for the WebAuthn API. The client subsequently submits
// (challengeId, signed-assertion) to /api/auth/webauthn/verify (TODO,
// future round) — the verifier calls consumeWebAuthnChallenge() so the
// challenge can never be replayed.
// ─────────────────────────────────────────────────────────────────────
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
  type MinimalChallengesDb as WebAuthnChallengesDb,
} from "./src/services/auth/webauthnChallenge.js";

/** Adapter that bridges the firebase-admin Firestore handle to our
 *  injection-friendly MinimalChallengesDb surface. The `updateIf`
 *  primitive is implemented via a transaction with a precondition
 *  read-then-write so two concurrent consume() calls cannot both win. */
function buildWebAuthnDb(): WebAuthnChallengesDb {
  const fs = admin.firestore();
  return {
    now: () => Date.now(),
    collection(name: string) {
      const col = fs.collection(name);
      return {
        doc(id: string) {
          const ref = col.doc(id);
          return {
            async get() {
              const snap = await ref.get();
              return {
                exists: snap.exists,
                id: snap.id,
                data: () => (snap.exists ? (snap.data() as Record<string, unknown>) : undefined),
              };
            },
            async set(data: Record<string, unknown>) {
              await ref.set(data);
            },
            async updateIf(
              precondition: (current: Record<string, unknown> | undefined) => boolean,
              patch: Record<string, unknown>,
            ): Promise<boolean> {
              return fs.runTransaction(async (tx) => {
                const snap = await tx.get(ref);
                const current = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
                if (!precondition(current)) return false;
                tx.update(ref, patch);
                return true;
              });
            },
          };
        },
      };
    },
  };
}

app.get("/api/auth/webauthn/challenge", verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  try {
    const { challengeId, challenge } = generateWebAuthnChallenge();
    await storeWebAuthnChallenge(callerUid, challengeId, challenge, buildWebAuthnDb());
    res.json({
      challengeId,
      // base64 — the client decodes via `Uint8Array.from(atob(...), c => c.charCodeAt(0))`
      challenge: Buffer.from(challenge).toString('base64'),
      ttlSeconds: 300,
    });
  } catch (error: any) {
    logger.error('webauthn_challenge_issue_failed', { uid: callerUid, message: error?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/curriculum/claim/:id/resend — re-email the magic link to one
// of the still-pending referees. Rate-limited per (claimId,refereeIndex).
app.post("/api/curriculum/claim/:id/resend", verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const claimId = req.params.id;
  const { refereeIndex } = req.body ?? {};
  if (refereeIndex !== 0 && refereeIndex !== 1) {
    return res.status(400).json({ error: 'refereeIndex must be 0 or 1' });
  }
  try {
    const snap = await admin.firestore().collection('curriculum_claims').doc(claimId).get();
    if (!snap.exists) return res.status(404).json({ error: 'claim not found' });
    const claim = snap.data() as any;
    if (claim.workerId !== callerUid) return res.status(403).json({ error: 'not your claim' });
    if (claim.status !== 'pending_referees') return res.status(409).json({ error: 'claim is not pending' });
    const slot = claim.referees?.[refereeIndex];
    if (!slot || slot.signedAt) return res.status(409).json({ error: 'referee already responded' });

    const cdKey = `${claimId}:${refereeIndex}`;
    const now = Date.now();
    const last = curriculumResendCooldown.get(cdKey) ?? 0;
    if (now - last < CURRICULUM_RESEND_COOLDOWN_MS) {
      return res.status(429).json({ error: 'too many resends — espera unos segundos' });
    }
    curriculumResendCooldown.set(cdKey, now);

    // We cannot resend the original raw token (only its hash is stored).
    // Resend semantics: rotate the token — issue a NEW raw token, replace
    // the slot's hash, and email that. Old token in flight becomes a
    // no-op (no slot matches its hash).
    const newRaw = curriculumGenToken();
    const newHash = curriculumHashToken(newRaw);
    const updatedReferees = claim.referees.map((r: any, i: number) => i === refereeIndex ? { ...r, tokenHash: newHash } : r);
    await snap.ref.update({ referees: updatedReferees });

    const callerRecord = await admin.auth().getUser(callerUid).catch(() => null);
    const workerName = callerRecord?.displayName || callerRecord?.email || 'Trabajador Praeventio';
    const appUrl = process.env.APP_URL || 'https://app.praeventio.net';
    const magicLink = `${appUrl}/curriculum/referee/${newRaw}`;
    try {
      await resend.emails.send({
        from: 'Praeventio Guard <noreply@praeventio.net>',
        to: slot.email,
        subject: `Recordatorio: ${workerName} necesita tu co-firma — Praeventio`,
        html: buildClaimEmailHtml({
          workerName,
          refereeName: slot.name,
          claimText: claim.claim,
          magicLink,
        }),
      });
    } catch (emailErr) {
      logger.error('curriculum_resend_email_failed', { claimId, message: (emailErr as any)?.message });
    }
    res.json({ success: true });
  } catch (error: any) {
    logger.error('curriculum_resend_failed', { uid: callerUid, message: error?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// `refereeLimiter` extracted to src/server/middleware/limiters.ts in
// Round 16 R5 Phase 1 split.

// GET /api/curriculum/referee/:token — public preview for the magic-link
// landing page. Returns minimal claim metadata if the token matches.
app.get("/api/curriculum/referee/:token", refereeLimiter, async (req, res) => {
  const rawToken = req.params.token ?? '';
  if (typeof rawToken !== 'string' || !/^[0-9a-f]{64}$/.test(rawToken)) {
    return res.status(400).json({ error: 'invalid token format' });
  }
  try {
    const tokenHash = curriculumHashToken(rawToken);
    // Token-hash lookup. We need a `where` query because the hash lives
    // inside the `referees` array — we filter client-side after fetching
    // by status. A scoped indexed approach (referees_index sub-collection)
    // would scale better; this is fine for MVP volumes.
    const all = await admin.firestore().collection('curriculum_claims')
      .where('status', 'in', ['pending_referees', 'verified', 'expired'])
      .get();
    let matchedClaim: any = null;
    let matchedIdx = -1;
    for (const d of all.docs) {
      const data = d.data();
      const idx = (data.referees ?? []).findIndex((r: any) => r.tokenHash === tokenHash);
      if (idx !== -1) {
        matchedClaim = { ...data, id: d.id };
        matchedIdx = idx;
        break;
      }
    }
    if (!matchedClaim) return res.status(404).json({ error: 'token does not match any claim' });
    if (new Date(matchedClaim.expiresAt).getTime() < Date.now() && matchedClaim.status === 'pending_referees') {
      // Lazy expire on read.
      await admin.firestore().collection('curriculum_claims').doc(matchedClaim.id).update({ status: 'expired' });
      matchedClaim.status = 'expired';
    }
    const slot = matchedClaim.referees[matchedIdx];
    let workerName = matchedClaim.workerEmail || 'Trabajador Praeventio';
    try {
      const wr = await admin.auth().getUser(matchedClaim.workerId);
      workerName = wr.displayName || wr.email || workerName;
    } catch { /* worker may have been deleted; fall back to email */ }
    res.json({
      claimText: matchedClaim.claim,
      workerName,
      workerEmail: matchedClaim.workerEmail,
      refereeName: slot.name,
      refereeEmail: slot.email,
      category: matchedClaim.category,
      status: matchedClaim.status,
      alreadySigned: !!slot.signedAt,
      expiresAt: matchedClaim.expiresAt,
    });
  } catch (error: any) {
    logger.error('curriculum_referee_preview_failed', { message: error?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/curriculum/referee/:token — public co-sign / decline.
// UNAUTHED: the security barrier is the 256-bit token. The server hashes
// it and matches against the stored slot. Rate-limited via refereeLimiter.
app.post("/api/curriculum/referee/:token", refereeLimiter, async (req, res) => {
  const rawToken = req.params.token ?? '';
  const { action, method, signature } = req.body ?? {};
  if (typeof rawToken !== 'string' || !/^[0-9a-f]{64}$/.test(rawToken)) {
    return res.status(400).json({ error: 'invalid token format' });
  }
  if (action !== 'cosign' && action !== 'decline') {
    return res.status(400).json({ error: 'action must be cosign or decline' });
  }
  if (action === 'cosign' && method !== 'webauthn' && method !== 'standard') {
    return res.status(400).json({ error: 'method must be webauthn or standard' });
  }
  if (typeof signature !== 'string' || signature.length === 0 || signature.length > 1024) {
    return res.status(400).json({ error: 'signature is required (≤1024 chars)' });
  }
  try {
    // Locate the claim id by scanning (same as preview).
    const tokenHash = curriculumHashToken(rawToken);
    const all = await admin.firestore().collection('curriculum_claims')
      .where('status', '==', 'pending_referees')
      .get();
    let claimId: string | null = null;
    for (const d of all.docs) {
      const data = d.data();
      const idx = (data.referees ?? []).findIndex((r: any) => r.tokenHash === tokenHash);
      if (idx !== -1) { claimId = d.id; break; }
    }
    if (!claimId) return res.status(404).json({ error: 'token does not match any pending claim' });

    if (action === 'decline') {
      // Decline path: mark slot.declined = true and flip claim to rejected.
      const ref = admin.firestore().collection('curriculum_claims').doc(claimId);
      const snap = await ref.get();
      const data = snap.data() as any;
      const idx = data.referees.findIndex((r: any) => r.tokenHash === tokenHash);
      const updatedReferees = data.referees.map((r: any, i: number) => i === idx ? { ...r, declined: true, signedAt: new Date().toISOString(), signature, method: method ?? 'standard' } : r);
      await ref.update({ referees: updatedReferees, status: 'rejected' });
      const audit = buildCurriculumAuditor(null, null, req.ip ?? undefined, req.header('user-agent') ?? undefined);
      await audit('curriculum.referee.declined', { claimId, refereeEmail: data.referees[idx].email });
      return res.json({ success: true, verified: false, declined: true });
    }

    // Cosign path: delegate to the service.
    const audit = buildCurriculumAuditor(null, null, req.ip ?? undefined, req.header('user-agent') ?? undefined);
    const result = await curriculumEndorse(
      claimId,
      rawToken,
      { signature, method: method as 'webauthn' | 'standard' },
      admin.firestore() as any,
      audit,
    );
    res.json({ success: true, verified: result.verified });
  } catch (error: any) {
    const message = error?.message || 'Internal server error';
    if (/expired/i.test(message)) return res.status(410).json({ error: message });
    if (/already/i.test(message)) return res.status(409).json({ error: message });
    if (/token|match/i.test(message)) return res.status(404).json({ error: message });
    logger.error('curriculum_referee_endorse_failed', { message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
