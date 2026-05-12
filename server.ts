import express from "express";
import helmet from "helmet";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
// vite is imported dynamically inside the dev-only block below to avoid breaking production where vite is not installedimport path from "path";
import path from "path";
import cookieParser from "cookie-parser";
import session from "express-session";
import crypto from "crypto";
import dotenv from "dotenv";
import { Resend } from "resend";
import { initializeRAG } from "./src/services/ragService.js";
import { updateGlobalEnvironmentalContext } from "./src/services/environmentBackend.js";
import { logger, runWithRequestContext } from "./src/utils/logger.js";
import { initTracing, getActiveTraceId } from "./src/services/observability/tracing.js";
import { validateKmsBootConfig } from "./src/server/kmsPreflight.js";
// Billing imports (buildInvoice, webpayAdapter, stripeAdapter, withIdempotency,
// webpayMetrics, mercadoPagoAdapter, currency, billing/types) moved to
// src/server/routes/billing.ts in Round 17 R2 Phase 2 split. `isAdminRole`
// went with them; in Round 17 R1 it was re-imported here for the IoT
// rotate-secret endpoint, and in Round 19 R2 Phase 4 it moved AGAIN — this
// time into telemetry.ts. server.ts no longer imports it.
// Webpay-specific `performance` import + googleapis Play client also moved.
import { sentryAdapter } from "./src/services/observability/sentryAdapter.js";
import { getErrorTracker } from "./src/services/observability/index.js";
// `assertProjectMember`/`ProjectMembershipError` formerly used inline by
// /api/audit-log; moved with the route into src/server/routes/audit.ts in
// Round 16 R5 Phase 1 split.
// Round 19 R2 Phase 4 split: gemini, reports, telemetry, gamification, misc
// extracted from server.ts. Earlier phases moved admin/health/audit/push,
// billing, curriculum/projects/oauth.
import { largeBodyJson } from "./src/server/middleware/largeBodyJson.js";
import { securityHeaders } from "./src/server/middleware/securityHeaders.js";
import { verifyAuth } from "./src/server/middleware/verifyAuth.js";
// Sprint 28 Bucket B3 — transversal Zod validation factory. Closes audit
// hallazgo H17. Each opt-in route mounts `validate(schema)` as the FIRST
// barrier; legacy `typeof` guards stay in place until Sprint 29.
import { validate } from "./src/server/middleware/validate.js";
import { z } from "zod";
import adminRouter from "./src/server/routes/admin.js";
// Sprint 23 Bucket CC — B2D admin (key management + revenue dashboards).
import b2dAdminRouter from "./src/server/routes/b2dAdmin.js";
// Sprint 23 Bucket BB — B2D public API (Climate / Hazmat / Normativa / Suite).
import b2dApiRouter from "./src/server/routes/b2d/index.js";
// Sprint 36 — Public OpenAPI 3.1 spec auto-generated from Zod schemas.
// Mounted before the global /api/ rate limiter so integrator tooling
// (Postman, Stoplight, etc.) can fetch the spec without auth or quota.
import openapiRouter from "./src/server/routes/openapi.js";
import { cspReportHandler } from "./src/server/routes/cspReport.js";
import healthRouter from "./src/server/routes/health.js";
// Sprint 26 Bucket VV — HealthVault QR sharing (ADR 0012).
import healthVaultRouter from "./src/server/routes/healthVault.js";
// Sprint 27 (audit H20) — overdue-maintenance reaper, called by Cloud
// Scheduler. Gated by verifySchedulerToken at the route level.
import maintenanceRouter from "./src/server/routes/maintenance.js";
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
import geminiRouter from "./src/server/routes/gemini.js";
// Sprint 32 Bucket UU — RLHF feedback loop (POST /api/ai/feedback,
// GET /api/ai/feedback/summary). Mounted under /api/ai so we have a
// dedicated namespace for AI-meta endpoints (separate from the Gemini
// dispatch surface in /api/gemini).
import aiFeedbackRouter from "./src/server/routes/aiFeedback.js";
import reportsRouter from "./src/server/routes/reports.js";
import susesoRouter from "./src/server/routes/suseso.js";
import telemetryRouter from "./src/server/routes/telemetry.js";
import gamificationRouter from "./src/server/routes/gamification.js";
import miscRouter from "./src/server/routes/misc.js";
import organicRouter from "./src/server/routes/organic.js";
import wisdomCapsuleRouter from "./src/server/routes/wisdomCapsule.js";
import subscriptionRouter from "./src/server/routes/subscription.js";
import zettelkastenRouter from "./src/server/routes/zettelkasten.js";
import commuteRouter from "./src/server/routes/commute.js";
import emergencyRouter from "./src/server/routes/emergency.js";
import cadRouter from "./src/server/routes/cad.js";
import complianceRouter from "./src/server/routes/compliance.js";
// Sprint 31 Bucket PP — DS 67 (Reglamento Interno) + DS 76 (Subcontratación
// Mining) PDF generators. Mounted under /api/compliance so the URL space
// matches Ley 19.628 endpoints (one compliance surface, not two).
import ds67ds76Router from "./src/server/routes/ds67ds76.js";
// Sprint 23 Bucket GG — DTE / SII admin endpoints (Bsale-backed).
import dteRouter from "./src/server/routes/dte.js";
// Sprint 24 Bucket KK — onboarding wizard endpoint.
import onboardingRouter from "./src/server/routes/onboarding.js";
// Sprint 39 PASO 2 — Wire UI bridge routes (persistence layer + insights).
import sitebookRouter from "./src/server/routes/sitebook.js";
import insightsRouter from "./src/server/routes/insights.js";
import sprintKRouter from "./src/server/routes/sprintK.js";
import { setupBackgroundTriggers } from "./src/server/triggers/backgroundTriggers.js";
import { setupHealthCheckInterval } from "./src/server/triggers/healthCheck.js";
import { setupSystemEngineTrigger } from "./src/server/triggers/systemEngineTrigger.js";
import systemEventsRouter from "./src/server/routes/systemEvents.js";
// Sprint 35 audit P1 §1.3 — distributed lease so in-process cron jobs
// (env polling 10min, project safety 6h) only run on ONE Cloud Run
// replica per tick. Without this, every replica ran the tick
// independently, burning Firestore quota.
import { acquireLease } from "./src/services/scheduler/distributedLease.js";
// Sprint 35 audit P1 §1.3 — Cloud Scheduler endpoint for the weekly
// RLHF feedback aggregator (was orphaned after Sprint 32 B1).
import adminJobsRouter from "./src/server/routes/adminJobs.js";
// Sprint 32 Bucket TT — IoT device registration + MQTT broker boot.
import iotRouter from "./src/server/routes/iot.js";
// Sprint 35 F1 — Aptitude cert biometric generator (export-only, NO push to
// MUTUAL/SUSESO/IST per memory product_signing_no_blocking_directives).
import medicalAptitudeRouter from "./src/server/routes/medicalAptitude.js";
import {
  connectMqttBroker,
  type IotBrokerAdapterName,
  type ConnectedBroker,
} from "./src/services/iot/mqttAdapter.js";
import { bridgeMqttToFirestore } from "./src/services/iot/firestoreBridge.js";
import admin from "firebase-admin";
import fs from 'fs';
// `googleapis` import removed in Round 17 R2 Phase 2 — its sole use was the
// Google Play Developer API client, which moved to billing.ts.
// `GoogleGenAI` import removed in Round 19 R2 Phase 4 — only /api/ask-guardian
// and /api/gemini consumed it, both now in src/server/routes/gemini.ts.

dotenv.config();

// Round 14 — Removed routes flagged dead by A1 audit AND cross-tenant
// exploitable by A5: /api/erp/sync-workers, /api/comite/alert-email,
// /api/reports/daily-email, /api/projects/:projectId/health-check.
// Future re-introduction must use assertProjectMember.

// Round 14 (A6 audit) -> hard fail in production. The OAuth token store
// uses envelope encryption with a Key Encryption Key resolved by
// `KMS_ADAPTER` (see src/services/security/kmsAdapter.ts). Dev may use
// `in-memory-dev`; production must use `cloud-kms` plus KMS_KEY_RESOURCE_NAME.
const _kmsPreflight = validateKmsBootConfig(process.env);
for (const warning of _kmsPreflight.warnings) {
  console.warn(`[boot] WARNING: ${warning}`);
}
if (!_kmsPreflight.ok) {
  for (const error of _kmsPreflight.errors) {
    console.error(`[boot] FATAL: ${error}`);
  }
  process.exit(1);
}

// Sentry initialization — must happen as early as possible, before any
// Express middleware so unhandled errors anywhere in the boot path are
// captured. Silent no-op when SENTRY_DSN isn't set; see OBSERVABILITY.md
// §1 (fall-back policy) for why a missing DSN is not fatal.
// Sprint 22 Bucket AA — OpenTelemetry tracing init. No-op when the SDK
// packages aren't installed; emits structured logs as a fallback so the
// pattern is in code from day one. See tracing.ts for the bootstrap
// contract and the OTLP exporter env-var list.
initTracing('praeventio-guard').catch((err) => {
  console.warn('[observability] tracing init failed (continuing without it):', err);
});

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

// Sprint 25 (CI fix) — fallback so module load doesn't crash when the
// secret isn't in env (CI smoke + local dev). Real sends will surface
// an upstream "invalid key" instead of a boot crash.
const resend = new Resend(process.env.RESEND_API_KEY ?? 're_ci_placeholder');

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
const PORT = Number(process.env.PORT) || 57335;

// `safeSecretEqual` extracted to src/server/middleware/safeSecretEqual.ts in
// Round 16 R5 Phase 1 split.

// Security Middleware
//
// Sprint 20 eleventh wave Bucket D — `securityHeaders` runs BEFORE helmet so
// our CSP/X-Frame-Options/Permissions-Policy/HSTS directives win for the
// headers we explicitly set. Helmet still provides the headers we don't
// override (X-DNS-Prefetch-Control, X-Permitted-Cross-Domain-Policies,
// Origin-Agent-Cluster, etc.). Mounted ABOVE auth/routes so 404s and
// unauthenticated error paths still carry the headers.
//
// Sprint 20 13th wave Bucket C — helmet's `contentSecurityPolicy` is now
// DISABLED. Reason: helmet's CSP overwrote our per-request nonce-bearing
// header with a static directive set every response, defeating the nonce
// migration. The canonical CSP source of truth is now exclusively
// `src/server/middleware/securityHeaders.ts` (per `docs/security/csp-policy.md`).
// Helmet still runs for its other defaults; only the CSP plugin is off.
app.use(securityHeaders);

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// ─── Sprint 22 Bucket AA — Request ID + log context propagation ──────────
//
// Every inbound request gets a stable identifier (X-Request-ID, echoed
// to the client). The id is generated server-side when the client
// doesn't supply one. We bind it to `runWithRequestContext` so any
// `logger.*` call inside the handler chain — including deep helpers
// that don't accept a request_id parameter — is auto-tagged with
// `request_id`. The trace_id (when OTel is wired) is bound the same way.
//
// Mounted ABOVE the rate limiter / verifyAuth / body parsers so even
// 429 / 401 / 400 paths carry the id. The header bound on the response
// gives ops engineers a stable token to search for in Cloud Logging.
const REQUEST_ID_HEADER = 'X-Request-ID';
const REQUEST_ID_REGEX = /^[A-Za-z0-9_\-:.]{1,128}$/;
app.use((req, res, next) => {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId =
    incoming && REQUEST_ID_REGEX.test(incoming)
      ? incoming
      : crypto.randomUUID();
  (req as any).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  // Pull the active trace id (when OTel resolves) so logs and Sentry
  // events can be cross-referenced with the trace backend.
  const traceId = getActiveTraceId() ?? undefined;
  runWithRequestContext({ requestId, traceId }, () => next());
});

// Sprint 21 — Bucket G: Universal Links (iOS) + App Links (Android).
//
// Apple's CDN and Google's Digital Asset Links validator both require:
//   1. HTTPS (no redirects).
//   2. `Content-Type: application/json` exactly.
//   3. The AASA file MUST NOT have a `.json` extension. The default
//      `express.static` MIME lookup would mis-serve it as
//      `application/octet-stream`, so we override the type explicitly.
//
// Mounted ABOVE the `/api/` rate limiter (`app.use("/api/", limiter)`
// further down) — these endpoints are unauthenticated and may be polled
// by Apple's `swcutil` or Google's validator dozens of times during
// store review. They also live OUTSIDE `/api/` so they would not be
// rate-limited anyway, but mounting early makes the intent obvious and
// guarantees no future global middleware accidentally swallows them.
//
// In dev (Vite middleware mode), these explicit handlers also win over
// Vite's static `public/` serving because Express runs them first.
app.get('/.well-known/apple-app-site-association', (_req, res) => {
  res.type('application/json');
  res.sendFile(
    path.resolve(process.cwd(), 'public/.well-known/apple-app-site-association'),
  );
});
app.get('/.well-known/assetlinks.json', (_req, res) => {
  res.type('application/json');
  res.sendFile(
    path.resolve(process.cwd(), 'public/.well-known/assetlinks.json'),
  );
});

// Public health probe for Cloud Run / Marketplace listing health checks.
// Mounted AFTER helmet (so CSP headers apply) but BEFORE the /api/ rate
// limiter and verifyAuth — Cloud Run probes hit this endpoint frequently
// and without an auth token, so it must remain unauthenticated and
// unthrottled. Handler extracted to src/server/routes/health.ts in
// Round 16 R5 Phase 1 split. Final path is preserved: GET /api/health.
app.use("/api", healthRouter);
// Sprint 26 Bucket VV — HealthVault QR. The /view/:id/:secret subroute is
// PUBLIC (médico que escanea no tiene cuenta) y trae su propio limiter
// por IP. Mount BEFORE el limiter global de /api/* para no consumir el
// presupuesto compartido del paciente.
app.use("/api/health-vault", healthVaultRouter);
// Sprint 27 (audit H20) — mount the maintenance reaper. The handler is
// gated by SCHEDULER_SHARED_SECRET (constant-time bearer compare) so
// public ingress can't trigger it without the secret.
app.use("/api/maintenance", maintenanceRouter);
// Sprint 35 audit P1 §1.3 — Cloud Scheduler endpoint for the weekly
// `aggregateAiFeedback` job (Sprint 32 B1 left it orphan with no
// trigger). Gated by SCHEDULER_SHARED_SECRET like /api/maintenance.
app.use("/api/admin/jobs", adminJobsRouter);

// Sprint 20 twelfth wave Bucket A (TM-I05) — CSP violation reports.
//
// Mounted ABOVE `verifyAuth` because browsers fire these reports without
// any auth context (the violation can happen pre-login). We do not let
// them count against the global `/api/` 100 req / 15 min bucket either —
// a noisy violation rate from one tenant must not starve real traffic
// from another.
//
// Per-IP throttle of 50 req/min keeps this endpoint cheap for an attacker
// to flood; cheap to flood at this rate but easy to drown in noise. The
// route MUST come BEFORE the global `app.use("/api/", limiter)` line so
// the cspReport-only limiter is the one that fires.
//
// Body parser scope: `express.json({ type: ['application/csp-report',
// 'application/json'] })` only on this single route, so the global
// `express.json({ limit: '64kb' })` further down stays narrow. Browsers
// ship reports as `application/csp-report`, but we accept JSON too in
// case a tester runs it via curl.
const cspReportLimiter = rateLimit({
  windowMs: 60_000,
  max: 50,
  // Per-IP key — the request is unauthenticated, so uid is unavailable.
  // `ipKeyGenerator` normalises IPv6 into /64 buckets so a single client
  // cannot bypass the limit by hopping addresses inside its prefix.
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? '') || 'unknown',
  standardHeaders: true,
  legacyHeaders: false,
  // 204 even on rate-limit so the browser does not retry — it never reads
  // a body for csp-report POSTs anyway.
  statusCode: 204,
  message: '',
});
app.post(
  '/api/csp-report',
  cspReportLimiter,
  express.json({
    // Browsers honour either MIME — accept both so tests + real traffic
    // both land on the JSON parser. The 16kb cap is tight: a real CSP
    // report is well under 1 KB; anything larger is a flood.
    type: ['application/csp-report', 'application/json'],
    limit: '16kb',
  }),
  cspReportHandler,
);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes"
});

// Sprint 23 Bucket BB — B2D public API mounted BEFORE the global `/api/`
// IP rate limiter so paid B2D tiers (50–100 req/sec on Pro) are not
// crushed by the 100/15min IP cap that protects the tenant surface. The
// router carries its own express.json() + b2dFreeLimiter + b2dAuth chain,
// and DOES NOT route through `verifyAuth` (Firebase ID tokens) — B2D
// integrators authenticate via static `Bearer pk_*` API keys.
//
// Privacy boundary (PRICING.md §9.3): the entire B2D surface NEVER reads
// tenant Zettelkasten data. Audited per-route in src/server/routes/b2d/.
app.use("/api/b2d/v1", b2dApiRouter);

// Sprint 36 — Auto-OpenAPI surface (public, no auth, cached 1h). Mounted
// BEFORE the global /api/ rate limiter so integrator tooling never hits
// the bucket. Path: /api/openapi.json + /api/openapi.html.
app.use("/api", openapiRouter);

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

// Sprint 23 Bucket CC — B2D admin panel backend (key CRUD + MRR/ARR/churn).
// Mounted at /api/admin/b2d so the same admin-role gate semantics apply
// (each endpoint inside b2dAdminRouter calls assertAdmin internally —
// matches admin.ts pattern).
app.use("/api/admin/b2d", b2dAdminRouter);

// Round 19 R2 Phase 4 split — POST /api/ask-guardian + POST /api/gemini
// extracted to src/server/routes/gemini.ts. The whitelisted action set
// lives with the route. Mounted at /api so the router can declare both
// sibling paths verbatim.
app.use('/api', geminiRouter);
// Sprint 32 Bucket UU — RLHF feedback loop. Mounted under /api/ai.
app.use('/api/ai', aiFeedbackRouter);

// Round 19 R2 Phase 4 split — POST /api/reports/generate-pdf extracted to
// src/server/routes/reports.ts. The per-route 1MB body limit short-circuit
// stays in this file (above) because it MUST run before the global
// `express.json({ limit: '64kb' })` parser.
app.use('/api', reportsRouter);

// Sprint 28 Bucket B6 — SUSESO DIAT/DIEP form generation. Mounted under
// `/api/suseso` so verify/:folio resolves cleanly from the QR codes embedded
// in printed PDFs. Closes audit hallazgo H28 (P1).
app.use('/api/suseso', susesoRouter);

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

// Round 19 R2 Phase 4 split — IoT telemetry ingestion + per-tenant secret
// rotation extracted to src/server/routes/telemetry.ts. Final paths
// preserved: POST /api/telemetry/ingest, POST /api/admin/iot/rotate-secret.
// The `IOT_TYPE_ALLOWLIST` and `lookupTenantIotSecret` helper moved with
// the route.
app.use('/api', telemetryRouter);

// Round 19 R2 Phase 4 split — long-tail handlers (legal/check-updates,
// erp/sync, seed-glossary, seed-data, environment/forecast) extracted to
// src/server/routes/misc.ts. Mounted here so the global /api/* limiter
// and JSON parser still gate them.
app.use('/api', miscRouter);
// Sprint 15 — organic structure (Crew/Process/Task) write endpoints.
app.use('/api', organicRouter);
// Sprint 15 — daily Wisdom Capsule summary endpoint.
app.use('/api', wisdomCapsuleRouter);

// ─── Project Invitation System (Round 18 Phase 3 — moved) ─────────────────
// 6 endpoints (POST /api/projects/:id/invite, GET /api/projects/:id/members,
// DELETE /api/projects/:id/members/:uid, DELETE /api/projects/:id/invite,
// GET /api/invitations/info/:token, POST /api/invitations/:token/accept)
// plus the `buildInviteEmailHtml` helper extracted to
// src/server/routes/projects.ts. Two routers because URLs span /api/projects
// and /api/invitations.
app.use('/api/projects', projectsRouter);
app.use('/api/invitations', invitationsRouter);

// Round 19 R2 Phase 4 split — gamification (points/leaderboard/check-medals)
// + AI Safety Coach (coach/chat with assertProjectMemberFromBody guard)
// extracted to src/server/routes/gamification.ts. Final paths preserved.
app.use('/api', gamificationRouter);

// Sprint 11 — POST /api/zettelkasten/nodes. Persists Bernoulli-driven
// risk nodes from the 4 client integrations (HazmatStorageDesigner,
// StructuralCalculator, VisionAnalyzer, BioAnalysis) with audit trail.
// Reuses verifyAuth + assertProjectMember + zettelkastenWriteLimiter.
app.use('/api/zettelkasten', zettelkastenRouter);

// SystemEngine — POST /api/system-events/emit. Server-side emit endpoint
// so clients without direct Firestore write rights can publish to the
// bus. Verified token's tenant claim is the authoritative tenantId; any
// mismatch with the body tenantId is rejected.
app.use('/api/system-events', systemEventsRouter);

// Sprint 12 — POST /api/commute/{start,sample,end}. Server-side mirror of
// the client `useCommuteSession` writes for accidente-de-trayecto (Ley
// 16.744 SUSESO). Member-guarded + per-uid rate limited.
app.use('/api/commute', commuteRouter);

// Sprint 14 — POST /api/emergency/sos. Worker-initiated SOS alert
// (SOSButton 3s long-press) writes a tenants/{tenantId}/emergency_alerts/{id}
// row and fans out an FCM push to every supervisor/gerente/prevencionista
// member of the project. notify-brigada (defined inline below) is left in
// place; the new router only owns /sos so the two paths can coexist.
app.use('/api/emergency', emergencyRouter);

// Sprint 17a — POST /api/cad/convert-dwg (stub; Sprint 18 wires ODA File
// Converter server-side so the frontend can stay MIT-only — see ADR 0002).
app.use('/api/cad', cadRouter);

// Sprint 32 Bucket TT — IoT device registration. Mounted under /api/iot
// so the surface stays separate from /api/telemetry/ingest (gateway HMAC
// path) and /api/admin/iot/rotate-secret (admin-only).
app.use('/api/iot', iotRouter);

// Sprint 35 F1 — Aptitude cert biometric router. POST /generate +
// /sign-challenge + /sign. Doctor/admin/gerente role gate. Generates
// the artifact ONLY — empresa cliente prints + signs in person + sends.
app.use('/api/medical', medicalAptitudeRouter);

// Sprint 23 Bucket FF — Ley 19.628 compliance surface (consent + RAT +
// data-subject access/rectification/erasure/portability). All write paths
// go through verifyAuth; the RAT catalog is intentionally public.
app.use('/api/compliance', complianceRouter);

// Sprint 31 Bucket PP — DS 67 + DS 76 PDF reglamento generators. Same
// /api/compliance surface; the routes are namespaced under /ds67 and /ds76.
app.use('/api/compliance', ds67ds76Router);

// Sprint 24 Bucket KK — POST /api/onboarding/complete. Self-service
// tenant onboarding (industry, countries, tier, invites, first project).
app.use('/api', onboardingRouter);

// Sprint 39 PASO 2 — Wire UI bridge: persistence-backed read/write endpoints.
// `sitebook` exposes the Libro de Obra (atomic folio + idempotent writes).
// `insights` aggregates the inputs for risk-ranking, safety-talks and
// role-view widgets (read-only — engines are pure, server only stages data).
app.use('/api/sitebook', sitebookRouter);
app.use('/api/insights', insightsRouter);
app.use('/api/sprint-k', sprintKRouter);

// Sprint 21 Ola 4 Bucket M.5 — IANA-registered MIME for `.usdz` so iOS
// Safari invokes AR Quick Look. Without this header the browser treats
// the file as a generic download. Applies to BOTH dev (vite middleware)
// and prod (express.static) — declared upstream so both paths inherit it.
app.get(/^\/models\/ar\/.*\.usdz$/, (_req, res, next) => {
  res.type('model/vnd.usdz+zip');
  next();
});

// Sprint 21 Ola 5 Bucket O (Brecha B) — cross-origin isolation headers
// for the SLM offline weights served under `/models/slm/*`.
//
// ONNX Runtime Web's WASM threading + SharedArrayBuffer code paths
// require the page to be cross-origin isolated. We scope COEP=require-corp
// to `/models/slm/*` rather than the whole app because globally enabling
// it would break our embedded Google Maps / Stripe / OAuth callbacks
// (they don't ship CORP headers).
//
// The `immutable` cache directive is safe because the weights are
// versioned by URL (cache-busted via `cacheVersion` in OnnxSlmAdapter).
app.use('/models/slm', (_req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  next();
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  // Sprint 20 13th wave Bucket C — production index.html is read once at
  // boot and cached; per-request work is just swapping the __CSP_NONCE__
  // placeholder for the nonce that securityHeaders middleware put in
  // res.locals.cspNonce. Re-reading the file every request would be a
  // perf cliff for a high-traffic root route. If the file is missing
  // (broken build), fall through to a 503 rather than serving the
  // template literal placeholder to a real browser.
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath, { index: false }));

  let INDEX_HTML_TEMPLATE: string | null = null;
  try {
    INDEX_HTML_TEMPLATE = fs.readFileSync(
      path.join(distPath, 'index.html'),
      'utf8',
    );
  } catch (err) {
    console.warn('[boot] dist/index.html not readable; SPA fallback will 503:', err);
  }

  app.get('*', (req, res) => {
    if (!INDEX_HTML_TEMPLATE) {
      return res.status(503).type('text/plain').send('SPA bundle missing');
    }
    const nonce = (res.locals.cspNonce as string | undefined) ?? '';
    // Global replace: even though there's only one __CSP_NONCE__ hit
    // today, future template additions can include the placeholder
    // anywhere and still get substituted in a single pass.
    const html = INDEX_HTML_TEMPLATE.replace(/__CSP_NONCE__/g, nonce);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  });
}

// Billing routes — extracted to src/server/routes/billing.ts in Round 17 R2
// Phase 2 split. Two mounts because /billing/webpay/return MUST live at the
// root (Transbank commerce config has the exact path) while the rest of the
// billing surface stays under /api/billing/.
app.use("/api/billing", billingApiRouter);
// Round 22 — audit fix CRITICAL #1: subscription upgrade with payment verify
app.use("/api/subscription", subscriptionRouter);
app.use("/billing", billingWebpayRouter);
// Sprint 23 Bucket GG — DTE / SII admin endpoints. Mount AFTER /api/billing
// because the auto-issue path is invoked from billing handlers; mounting the
// admin surface here keeps the route surface co-located with billing.
app.use("/api/dte", dteRouter);

// Initialize RAG system asynchronously
initializeRAG().catch(console.error);

// Start background environmental polling (every 10 minutes).
// Sprint 27 (audit P0 H10) — capture the timer handle so SIGTERM can
// clear it; otherwise Cloud Run's 10-second drain budget can't exit
// cleanly on revision rollover.
//
// Sprint 35 audit P1 §1.3 — gate the tick with a Firestore-backed
// distributed lease so only ONE Cloud Run replica fetches the global
// environmental context per interval. TTL = 9 minutes (slightly less
// than the 10-minute period) so a crashed replica's lease expires
// before the next tick and the cluster doesn't stall.
const RUNTIME_INSTANCE_ID =
  process.env.K_REVISION ||
  process.env.HOSTNAME ||
  `pid-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
const ENV_POLL_INTERVAL_MS = 10 * 60 * 1000;
const ENV_POLL_LEASE_TTL_MS = 9 * 60 * 1000;

async function envPollingTick(): Promise<void> {
  try {
    const lease = await acquireLease(
      'envPolling',
      ENV_POLL_LEASE_TTL_MS,
      RUNTIME_INSTANCE_ID,
    );
    if (!lease.acquired) return; // another replica owns this tick
    await updateGlobalEnvironmentalContext();
  } catch (err) {
    // NEVER crash the timer — log + Sentry capture and let the next
    // interval re-attempt. The audit explicitly requires this safety.
    console.error('[envPolling] tick failed:', err);
    try {
      getErrorTracker().captureException(
        err instanceof Error ? err : new Error(String(err)),
        { trigger: 'envPolling', tags: { phase: 'tick' } } as any,
      );
    } catch {
      /* swallow */
    }
  }
}

const environmentalPollingHandle = setInterval(
  () => {
    void envPollingTick();
  },
  ENV_POLL_INTERVAL_MS,
);

// Run immediately at startup (also lease-gated so only one replica wins).
void envPollingTick();

// Round 21 R21 B1 Phase 5 split — `setupBackgroundTriggers` (FCM + RAG
// onSnapshot listeners) extracted to src/server/triggers/backgroundTriggers.ts.
// `setupHealthCheckInterval` (the 6h project safety pass) extracted to
// src/server/triggers/healthCheck.ts. Both expose stop/unsubscribe handles
// for graceful shutdown — wired into SIGTERM below.

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

// Prototype Fusion Phase 6.1 — FCM notify-brigada endpoint
// Sends emergency FCM push to all supervisors/gerentes/prevencionistas in a project
//
// Sprint 32 audit P0 — `/api/emergency/notify-brigada` migrated to
// src/server/routes/emergency.ts so it reuses `sendToProjectSupervisors`
// (cross-collection lookup `users/{uid}.fcmTokens` + cache). The previous
// inline implementation regressed H7 (Sprint 27 fix) by reading only the
// legacy `members/{uid}.fcmToken` singular field, producing `notified: 0`
// for installations that registered tokens via /api/push/register-token.
// The route is now exposed via `app.use('/api/emergency', emergencyRouter)`
// at the top of this file.

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

let triggersHandle: { unsubscribe: () => void } | null = null;
let healthHandle: { stop: () => void } | null = null;
let systemEngineHandle: { unsubscribe: () => void } | null = null;
let mqttBrokerHandle: ConnectedBroker | null = null;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);

  if (admin.apps.length > 0) {
    triggersHandle = setupBackgroundTriggers({
      db: admin.firestore(),
      messaging: admin.messaging(),
      resend,
      firestoreNamespace: admin.firestore,
    });

    // SystemEngine — server-side trigger. Listens via collectionGroup so a
    // single subscription covers every tenant's system_events subcollection.
    // Cleanup is wired into SIGTERM (no leaked listener on rolling deploy).
    systemEngineHandle = setupSystemEngineTrigger({
      db: admin.firestore(),
    });

    // Proactive Project Health Checks (Every 6 hours to balance quota).
    // Sprint 35 audit P1 §1.3 — gate with distributed lease so only one
    // Cloud Run replica runs the 6h safety pass. TTL = 5h 30m: shorter
    // than the interval so a crashed replica's lease expires before the
    // next tick.
    healthHandle = setupHealthCheckInterval({
      db: admin.firestore(),
      gate: async () => {
        const lease = await acquireLease(
          'projectHealthCheck',
          5 * 60 * 60 * 1000 + 30 * 60 * 1000,
          RUNTIME_INSTANCE_ID,
        );
        return lease.acquired;
      },
    });

    // Sprint 32 Bucket TT (audit P0 W2) — MQTT broker boot.
    //
    // Gated by env so dev / preview environments don't try to connect
    // to a real broker (and the cloud / emqx factories are still
    // stubbed — see ADR 0015). When IOT_BROKER_ENABLED is unset we log
    // a warn and skip; existing routes (`/api/iot/devices/register`,
    // `/api/telemetry/ingest`) keep working without a broker.
    if (process.env.IOT_BROKER_ENABLED === '1') {
      const adapterName = (process.env.IOT_BROKER_ADAPTER ?? 'memory') as IotBrokerAdapterName;
      connectMqttBroker({
        adapter: adapterName,
        cloud: adapterName === 'cloud'
          ? {
              projectId: process.env.IOT_GCP_PROJECT_ID ?? '',
              region: process.env.IOT_GCP_REGION ?? '',
              registryId: process.env.IOT_GCP_REGISTRY_ID ?? '',
              credentials: process.env.IOT_GCP_CREDENTIALS,
            }
          : undefined,
        emqx: adapterName === 'emqx'
          ? {
              url: process.env.IOT_EMQX_URL ?? '',
              cert: process.env.IOT_EMQX_CERT ?? '',
              key: process.env.IOT_EMQX_KEY ?? '',
              ca: process.env.IOT_EMQX_CA ?? '',
            }
          : undefined,
        onTelemetry: async (sample, ctx) => {
          await bridgeMqttToFirestore(sample, {
            tenantId: ctx.tenantId,
            projectId: ctx.projectId,
          });
        },
      })
        .then((handle) => {
          mqttBrokerHandle = handle;
          console.log(`[iot] MQTT broker connected (adapter=${adapterName})`);
        })
        .catch((err) => {
          console.warn('[iot] MQTT broker boot failed (continuing without it):', err);
        });
    } else {
      console.warn('[iot] MQTT broker disabled (set IOT_BROKER_ENABLED=1 to enable).');
    }
  }
});

// Graceful shutdown — release the onSnapshot listeners and the 6h
// interval so the process can exit cleanly on SIGTERM (Cloud Run sends
// SIGTERM ~10s before SIGKILL on revision rollover).
process.on('SIGTERM', () => {
  triggersHandle?.unsubscribe();
  healthHandle?.stop();
  systemEngineHandle?.unsubscribe();
  // Sprint 27 (audit P0 H10) — clear the env polling interval too.
  clearInterval(environmentalPollingHandle);
  // Sprint 32 Bucket TT — release the MQTT broker subscription.
  if (mqttBrokerHandle) {
    mqttBrokerHandle.unsubscribe().catch(() => {
      /* shutdown — swallow */
    });
  }
  process.exit(0);
});
