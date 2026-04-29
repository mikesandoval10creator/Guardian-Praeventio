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
import { updateGlobalEnvironmentalContext } from "./src/services/environmentBackend.js";
import { logger } from "./src/utils/logger.js";
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
import geminiRouter from "./src/server/routes/gemini.js";
import reportsRouter from "./src/server/routes/reports.js";
import telemetryRouter from "./src/server/routes/telemetry.js";
import gamificationRouter from "./src/server/routes/gamification.js";
import miscRouter from "./src/server/routes/misc.js";
import { setupBackgroundTriggers } from "./src/server/triggers/backgroundTriggers.js";
import { setupHealthCheckInterval } from "./src/server/triggers/healthCheck.js";
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

// Round 19 R2 Phase 4 split — POST /api/ask-guardian + POST /api/gemini
// extracted to src/server/routes/gemini.ts. The whitelisted action set
// lives with the route. Mounted at /api so the router can declare both
// sibling paths verbatim.
app.use('/api', geminiRouter);

// Round 19 R2 Phase 4 split — POST /api/reports/generate-pdf extracted to
// src/server/routes/reports.ts. The per-route 1MB body limit short-circuit
// stays in this file (above) because it MUST run before the global
// `express.json({ limit: '64kb' })` parser.
app.use('/api', reportsRouter);

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);

  if (admin.apps.length > 0) {
    triggersHandle = setupBackgroundTriggers({
      db: admin.firestore(),
      messaging: admin.messaging(),
      resend,
      firestoreNamespace: admin.firestore,
    });

    // Proactive Project Health Checks (Every 6 hours to balance quota)
    healthHandle = setupHealthCheckInterval({ db: admin.firestore() });
  }
});

// Graceful shutdown — release the onSnapshot listeners and the 6h
// interval so the process can exit cleanly on SIGTERM (Cloud Run sends
// SIGTERM ~10s before SIGKILL on revision rollover).
process.on('SIGTERM', () => {
  triggersHandle?.unsubscribe();
  healthHandle?.stop();
  process.exit(0);
});
