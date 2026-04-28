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
import { performProjectSafetyHealthCheck, autoValidateTelemetry } from "./src/services/safetyEngineBackend.js";
import { awardPoints, getLeaderboard, checkMedalEligibility } from "./src/services/gamificationBackend.js";
import { updateGlobalEnvironmentalContext } from "./src/services/environmentBackend.js";
import { isValidRole, isAdminRole } from "./src/types/roles.js";
import { saveTokens, getValidAccessToken, revokeTokens } from "./src/services/oauthTokenStore.js";
import { logger } from "./src/utils/logger.js";
import { buildInvoice } from "./src/services/billing/invoice.js";
import type {
  CheckoutRequest,
  CheckoutResponse,
  CurrencyCode,
  PaymentMethod,
} from "./src/services/billing/types.js";
import { webpayAdapter } from "./src/services/billing/webpayAdapter.js";
import { stripeAdapter } from "./src/services/billing/stripeAdapter.js";
import admin from "firebase-admin";
import fs from 'fs';
import { GoogleGenAI } from "@google/genai";
import { google } from 'googleapis';

dotenv.config();

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

// Initialize Google Play Developer API
let playAuth: any = null;
const playDeveloperApi = google.androidpublisher('v3');

if (process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
    playAuth = google.auth.fromJSON(credentials);
    // @ts-ignore
    playAuth.scopes = ['https://www.googleapis.com/auth/androidpublisher'];
    console.log("Google Play Developer API client initialized.");
  } catch (error) {
    console.error("Failed to initialize Google Play API client:", error);
  }
}

const app = express();
const PORT = 3000;

/**
 * Constant-time comparison of a client-supplied secret against an expected secret.
 *
 * Both inputs are padded to the expected length before invoking
 * `crypto.timingSafeEqual`, so the running time does not branch on either
 * the provided or the expected length. A naive `if (a.length !== b.length)`
 * guard leaks the expected secret length via wall-clock timing — minor in
 * practice but trivial to avoid. The length check is folded into the final
 * boolean *after* the constant-time compare so both branches do equal work.
 *
 * Use this for shared-secret webhook authentication where the secret is
 * a compile-time/env-derived constant. Returns `false` if `provided` is
 * undefined (caller doesn't need a separate guard).
 */
function safeSecretEqual(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  // Pad provided to expected length so timingSafeEqual sees equal-size buffers
  // and does not throw. Padding bytes (zeros) don't matter — a different
  // length forces lengthOk=false regardless of the bytewise compare.
  const padded = Buffer.alloc(expectedBuf.length);
  providedBuf.copy(padded);
  const lengthOk = providedBuf.length === expectedBuf.length;
  const valueOk = crypto.timingSafeEqual(padded, expectedBuf);
  return lengthOk && valueOk;
}

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

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again after 15 minutes"
});

app.use("/api/", limiter);

// Stricter per-user rate limit for expensive AI calls
const geminiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req as any).user?.uid || req.ip || 'anonymous',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Límite de consultas IA alcanzado. Intenta de nuevo en 15 minutos." }
});

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
const largeBodyJson = express.json({ limit: '2mb' });
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

// Firebase Auth Middleware
const verifyAuth = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized: No token provided" });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    (req as any).user = decodedToken;
    next();
  } catch (error) {
    console.error("Error verifying auth token:", error);
    return res.status(401).json({ error: "Unauthorized: Invalid token" });
  }
};

// Firebase Auth uid format constraint shared by privileged admin endpoints.
const UID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;

// Desconexión Forzada (Revoke Tokens - El Haki del Rey / Security)
app.post("/api/admin/revoke-access", verifyAuth, async (req, res) => {
  const { targetUid } = req.body;
  const callerUid = (req as any).user.uid;

  if (typeof targetUid !== 'string' || !UID_REGEX.test(targetUid)) {
    return res.status(400).json({ error: 'Invalid uid' });
  }

  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: "Forbidden: Requires admin role to revoke access" });
    }

    // Revoca los refresh tokens. El usuario será desconectado cuando su token a corto plazo expire (o si es validado estrictamente)
    await admin.auth().revokeRefreshTokens(targetUid);

    // Opcional: Escribir en base de datos para que el cliente detecte el baneo inmediatamente
    await admin.firestore().collection('user_sessions').doc(targetUid).set({
      revokedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Audit trail — see audit_logs schema at the top of this file.
    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'revoke_access',
      target: targetUid,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });

    res.json({ success: true, message: `Access revoked for user ${targetUid}` });
  } catch (error) {
    logger.error("admin_revoke_access_failed", error, { callerUid, targetUid });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Sincronización Nocturna con ERP (Módulo Cloud Functions Mock / API First)
app.post("/api/erp/sync-workers", verifyAuth, async (req, res) => {
  const { workers, projectId } = req.body;
  const callerUid = (req as any).user.uid;
  
  try {
    if (!Array.isArray(workers)) {
      return res.status(400).json({ error: "Invalid payload: workers must be an array" });
    }

    const batch = admin.firestore().batch();
    let synced = 0;

    for (const worker of workers) {
      if (!worker.id || !worker.name) continue;
      const workerRef = admin.firestore()
        .collection('projects')
        .doc(projectId)
        .collection('workers')
        .doc(worker.id.toString());
        
      batch.set(workerRef, {
        ...worker,
        updatedViaERP: true,
        lastSync: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      synced++;
    }

    await batch.commit();
    res.json({ success: true, syncedCount: synced, message: `Sincronizados ${synced} trabajadores desde ERP externo.` });
  } catch (error) {
    console.error("Error syncing ERP data:", error);
    res.status(500).json({ error: "Internal server error during ERP sync" });
  }
});

// Custom Claims Endpoint (El Haki del Rey)
app.post("/api/admin/set-role", verifyAuth, async (req, res) => {
  const { uid, role } = req.body;
  const callerUid = (req as any).user.uid;

  if (typeof uid !== 'string' || !UID_REGEX.test(uid)) {
    return res.status(400).json({ error: 'Invalid uid' });
  }

  try {
    // Verify caller is admin/gerente (matches firestore.rules' isAdmin())
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: "Forbidden: Requires admin role" });
    }

    if (!isValidRole(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    // Capture the existing role before mutation for audit_logs.
    let oldRole: string | null = null;
    try {
      const targetRecord = await admin.auth().getUser(uid);
      oldRole = (targetRecord.customClaims?.role as string | undefined) ?? null;
    } catch {
      // Target may not exist yet; setCustomUserClaims will surface the error.
    }

    await admin.auth().setCustomUserClaims(uid, { role });

    // Force re-auth so the client picks up the new claim immediately rather
    // than continuing with a stale ID token until natural expiry.
    await admin.auth().revokeRefreshTokens(uid);

    // Audit trail — see audit_logs schema notes at the top of this file.
    await admin.firestore().collection('audit_logs').add({
      actor: callerUid,
      action: 'set_role',
      target: uid,
      oldRole,
      newRole: role,
      ts: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip,
      ua: req.header('user-agent') || null,
    });

    res.json({ success: true, message: `Role ${role} assigned to user ${uid}` });
  } catch (error) {
    logger.error("admin_set_role_failed", error, { callerUid, targetUid: uid });
    res.status(500).json({ error: "Internal server error" });
  }
});

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
//
// The endpoint stamps the actor uid + email from the verified token (NOT from
// req.body), so a worker cannot impersonate someone else. action/module are
// validated; `details` is opaque (callers responsible for not putting secrets
// in there).
app.post("/api/audit-log", verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;
  const { action, module: mod, details, projectId } = req.body ?? {};

  if (typeof action !== 'string' || action.length === 0 || action.length > 64) {
    return res.status(400).json({ error: "Invalid action" });
  }
  if (typeof mod !== 'string' || mod.length === 0 || mod.length > 64) {
    return res.status(400).json({ error: "Invalid module" });
  }
  if (projectId !== undefined && projectId !== null && (typeof projectId !== 'string' || projectId.length > 128)) {
    return res.status(400).json({ error: "Invalid projectId" });
  }

  try {
    await admin.firestore().collection('audit_logs').add({
      action,
      module: mod,
      details: details ?? {},
      userId: callerUid,
      userEmail: callerEmail,
      projectId: projectId ?? null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });
    res.json({ success: true });
  } catch (error: any) {
    logger.error('audit_log_write_failed', { uid: callerUid, action, message: error?.message });
    res.status(500).json({
      error: "Audit log write failed",
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

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

    res.json({ success: true, results });
  } catch (error) {
    console.error('Error syncing with Google Calendar:', error);
    res.status(500).json({ error: "Failed to sync with Google Calendar" });
  }
});

// Proxy for Google Fit API.
// Uses tokens stored server-side via /auth/google/callback; the client never
// holds an OAuth access_token or refresh_token.
app.post("/api/fitness/sync", verifyAuth, async (req, res) => {
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
// Authentication: shared secret in the `X-IoT-Secret` request header
// (timing-safe compared against IOT_WEBHOOK_SECRET). For one release we still
// accept the secret in the JSON body for backwards compatibility, logging a
// deprecation warning. Remove the body fallback in the next release.
// Aligned with the frontend type union in src/pages/Telemetry.tsx + Evacuation.tsx
// ('wearable' | 'machinery'). 'iot', 'environmental', 'machine' are reserved for
// gateway-originated telemetry. Keep this in sync if the frontend union changes.
const IOT_TYPE_ALLOWLIST = new Set(['iot', 'wearable', 'machinery', 'environmental', 'machine']);
app.post("/api/telemetry/ingest", async (req, res) => {
  const { type, source, metric, value, unit, status, projectId } = req.body ?? {};

  const expectedSecret = process.env.IOT_WEBHOOK_SECRET;
  if (!expectedSecret) {
    logger.error("iot_webhook_misconfigured", undefined, {
      reason: "IOT_WEBHOOK_SECRET not set",
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

  // Constant-time comparison via safeSecretEqual: pads the provided value to
  // the expected length so neither length nor bytes leak through wall-clock
  // timing. The previous `length !== length` short-circuit was technically
  // a length-disclosure side channel.
  if (!safeSecretEqual(secretKey as string, expectedSecret)) {
    return res.status(401).json({ error: "Unauthorized: Invalid secret key" });
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

// Project Health Check Endpoint
app.post("/api/projects/:projectId/health-check", verifyAuth, async (req, res) => {
  const { projectId } = req.params;
  try {
    const result = await performProjectSafetyHealthCheck(projectId);
    if (!result) return res.status(404).json({ error: "Project not found" });
    res.json({ success: true, result });
  } catch (error: any) {
    console.error(`Error performing health check for project ${projectId}:`, error);
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

// Email Alerts: CPHS (Comité Paritario) critical findings
app.post("/api/comite/alert-email", verifyAuth, async (req, res) => {
  const { projectId, findingTitle, findingDescription, severity, recipients } = req.body as {
    projectId: string;
    findingTitle: string;
    findingDescription: string;
    severity: string;
    recipients: string[]; // array of email addresses
  };

  if (!projectId || !findingTitle || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "projectId, findingTitle, and recipients[] are required" });
  }

  const db = admin.firestore();
  const projectSnap = await db.collection('projects').doc(projectId).get();
  const projectName = projectSnap.exists ? (projectSnap.data()?.name || 'Proyecto') : 'Proyecto';

  const severityColor: Record<string, string> = {
    'Crítica': '#ef4444',
    'Alta': '#f97316',
    'Media': '#eab308',
    'Baja': '#22c55e',
  };
  const color = severityColor[severity] || '#6b7280';
  const date = new Date().toLocaleString('es-CL', { timeZone: 'America/Santiago' });

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:sans-serif;background:#f4f4f5">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <div style="background:#09090b;padding:24px 32px;display:flex;align-items:center;gap:12px">
    <span style="font-size:20px;font-weight:900;color:#10b981;letter-spacing:-1px">GUARDIAN</span>
    <span style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-1px">PRAEVENTIO</span>
  </div>
  <div style="padding:32px">
    <div style="display:inline-block;padding:4px 12px;background:${color}20;border:1px solid ${color}40;border-radius:8px;margin-bottom:16px">
      <span style="font-size:11px;font-weight:700;color:${color};text-transform:uppercase;letter-spacing:.08em">⚠ Alerta CPHS — ${severity || 'Sin clasificar'}</span>
    </div>
    <h2 style="margin:0 0 8px;font-size:20px;font-weight:900;color:#09090b">${findingTitle}</h2>
    <p style="margin:0 0 24px;font-size:14px;color:#71717a;line-height:1.6">${findingDescription || 'Sin descripción adicional.'}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px">
      <tr><td style="padding:10px 0;border-bottom:1px solid #f4f4f5;font-size:12px;color:#a1a1aa;font-weight:700;text-transform:uppercase">Proyecto</td><td style="padding:10px 0;border-bottom:1px solid #f4f4f5;font-size:13px;color:#09090b;font-weight:600">${projectName}</td></tr>
      <tr><td style="padding:10px 0;font-size:12px;color:#a1a1aa;font-weight:700;text-transform:uppercase">Detectado</td><td style="padding:10px 0;font-size:13px;color:#09090b;font-weight:600">${date}</td></tr>
    </table>
    <p style="margin:24px 0 0;font-size:11px;color:#a1a1aa;text-align:center">Este aviso fue generado automáticamente por Guardian Praeventio para el Comité Paritario.</p>
  </div>
</div></body></html>`;

  try {
    await resend.emails.send({
      from: 'Praeventio Guard <noreply@praeventio.net>',
      to: recipients,
      subject: `[CPHS ${projectName}] Hallazgo ${severity || ''}: ${findingTitle}`,
      html,
    });
    res.json({ success: true });
  } catch (err: any) {
    console.error("Error sending CPHS alert email:", err);
    res.status(500).json({ error: err.message });
  }
});

// Email Reports: daily safety summary for a project
app.post("/api/reports/daily-email", verifyAuth, async (req, res) => {
  const { projectId, recipients } = req.body as { projectId: string; recipients: string[] };

  if (!projectId || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "projectId and recipients[] are required" });
  }

  const db = admin.firestore();
  const projectSnap = await db.collection('projects').doc(projectId).get();
  if (!projectSnap.exists) return res.status(404).json({ error: "Project not found" });
  const projectName = projectSnap.data()?.name || 'Proyecto';

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const nodesSnap = await db.collection('nodes')
    .where('projectId', '==', projectId)
    .where('createdAt', '>=', since.toISOString())
    .get();

  const nodes = nodesSnap.docs.map(d => d.data());
  const incidents = nodes.filter(n => n.type === 'Incidente' || n.type === 'Hallazgo');
  const risks = nodes.filter(n => n.type === 'Riesgo');
  const audits = nodes.filter(n => n.type === 'Auditoría');
  const criticalCount = incidents.filter(n => n.metadata?.severity === 'Crítica' || n.metadata?.criticidad === 'Crítica').length;

  const date = new Date().toLocaleDateString('es-CL', { timeZone: 'America/Santiago', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const statRow = (label: string, value: number, color: string) =>
    `<tr><td style="padding:12px 16px;font-size:13px;color:#52525b;border-bottom:1px solid #f4f4f5">${label}</td><td style="padding:12px 16px;text-align:right;font-size:15px;font-weight:900;color:${color};border-bottom:1px solid #f4f4f5">${value}</td></tr>`;

  const recentRows = incidents.slice(0, 5).map(n =>
    `<tr><td style="padding:10px 16px;font-size:12px;color:#09090b;border-bottom:1px solid #f4f4f5">${n.title || 'Sin título'}</td><td style="padding:10px 16px;font-size:11px;color:#71717a;border-bottom:1px solid #f4f4f5;text-align:right">${n.metadata?.criticidad || n.metadata?.severity || '—'}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:sans-serif;background:#f4f4f5">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">
  <div style="background:#09090b;padding:24px 32px">
    <span style="font-size:20px;font-weight:900;color:#10b981;letter-spacing:-1px">GUARDIAN</span>
    <span style="font-size:20px;font-weight:900;color:#fff;letter-spacing:-1px"> PRAEVENTIO</span>
    <p style="margin:8px 0 0;font-size:12px;color:#71717a">Reporte Diario de Seguridad • ${date}</p>
  </div>
  <div style="padding:32px">
    <h2 style="margin:0 0 4px;font-size:18px;font-weight:900;color:#09090b">${projectName}</h2>
    <p style="margin:0 0 24px;font-size:13px;color:#71717a">Resumen de actividad en las últimas 24 horas.</p>
    <table style="width:100%;border-collapse:collapse;border:1px solid #f4f4f5;border-radius:12px;overflow:hidden;margin-bottom:24px">
      ${statRow('Incidentes / Hallazgos nuevos', incidents.length, incidents.length > 0 ? '#ef4444' : '#22c55e')}
      ${statRow('Críticos', criticalCount, criticalCount > 0 ? '#ef4444' : '#22c55e')}
      ${statRow('Riesgos identificados', risks.length, '#f97316')}
      ${statRow('Auditorías realizadas', audits.length, '#6366f1')}
      ${statRow('Total registros nuevos', nodes.length, '#09090b')}
    </table>
    ${incidents.length > 0 ? `<h3 style="font-size:12px;font-weight:700;color:#a1a1aa;text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px">Últimos incidentes</h3>
    <table style="width:100%;border-collapse:collapse;border:1px solid #f4f4f5;border-radius:12px;overflow:hidden;margin-bottom:24px">${recentRows}</table>` : ''}
    <p style="margin:0;font-size:11px;color:#a1a1aa;text-align:center">Reporte generado automáticamente por Guardian Praeventio.</p>
  </div>
</div></body></html>`;

  try {
    await resend.emails.send({
      from: 'Praeventio Guard <noreply@praeventio.net>',
      to: recipients,
      subject: `[Reporte Diario] ${projectName} — ${incidents.length} incidente${incidents.length !== 1 ? 's' : ''} en 24h`,
      html,
    });
    res.json({ success: true, stats: { incidents: incidents.length, criticalCount, risks: risks.length, audits: audits.length } });
  } catch (err: any) {
    console.error("Error sending daily report email:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────

// Gamification Endpoints
app.post("/api/gamification/points", verifyAuth, async (req, res) => {
  const { amount, reason } = req.body;
  const uid = (req as any).user.uid;
  try {
    await awardPoints(uid, amount, reason);
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
    res.json({ success: true, newMedals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Safety Coach Endpoint
app.post("/api/coach/chat", verifyAuth, async (req, res) => {
  const { message, projectContext } = req.body;
  const uid = (req as any).user.uid;
  try {
    const { getSafetyCoachResponse } = await import('./src/services/coachBackend.js');
    const db = admin.firestore();
    const userStats = (await db.collection('user_stats').doc(uid).get()).data() || { points: 0, medals: [], loginStreak: 0 };
    const recentIncidents = (await db.collection('incidents').where('projectId', '==', projectContext?.id || 'global').limit(5).get()).docs.map(d => d.data());
    
    const response = await getSafetyCoachResponse(uid, userStats, recentIncidents, message);
    res.json({ success: true, response });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

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

// Billing Endpoints
app.post("/api/billing/verify", verifyAuth, async (req, res) => {
  const { purchaseToken, productId, type } = req.body;
  const uid = (req as any).user.uid;
  const packageName = process.env.GOOGLE_PLAY_PACKAGE_NAME;

  if (!playAuth || !packageName) {
    return res.status(500).json({ error: "Google Play API not configured on server" });
  }

  try {
    let verificationResult;
    if (type === 'subscription') {
      verificationResult = await playDeveloperApi.purchases.subscriptions.get({
        auth: playAuth,
        packageName,
        subscriptionId: productId,
        token: purchaseToken
      });
    } else {
      verificationResult = await playDeveloperApi.purchases.products.get({
        auth: playAuth,
        packageName,
        productId,
        token: purchaseToken
      });
    }

    const data = verificationResult.data;
    const db = admin.firestore();

    // Log transaction
    await db.collection('transactions').add({
      userId: uid,
      orderId: data.orderId || 'unknown',
      packageName,
      productId,
      purchaseToken,
      type: type || 'subscription',
      status: 'verified',
      rawResponse: data,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    // Validate productId is a known plan name (whitelist)
    const VALID_PLANS = ['free','comite','departamento','plata','oro','platino','empresarial','corporativo','ilimitado'];
    const resolvedPlan = VALID_PLANS.includes(productId) ? productId : 'comite';

    // Update user subscription status
    if (type === 'subscription') {
      const expiryDate = data.expiryTimeMillis ? new Date(parseInt(data.expiryTimeMillis)).toISOString() : null;
      // paymentState 1 = received, 2 = free trial
      const isActive = data.paymentState === 1 || data.paymentState === 2;

      await db.collection('users').doc(uid).update({
        'subscription.planId': resolvedPlan,
        'subscription.status': isActive ? 'active' : 'expired',
        'subscription.expiryDate': expiryDate,
        'subscription.purchaseToken': purchaseToken,
        'subscription.orderId': data.orderId,
        'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // One-time purchase logic
      await db.collection('users').doc(uid).update({
        [`purchased_products.${productId}`]: true,
        'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.json({ success: true, data });
  } catch (error: any) {
    logger.error("purchase_verification_failed", error, { uid });
    res.status(500).json({
      error: "Failed to verify purchase",
      // Avoid leaking Firebase/googleapis internals in production responses.
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

app.post("/api/billing/webhook", async (req, res) => {
  // Verify shared secret — configure WEBHOOK_SECRET in Pub/Sub push subscription URL as ?token=<secret>
  // Fail closed: missing config means we reject everything rather than accept everyone.
  const expectedToken = process.env.WEBHOOK_SECRET;
  if (!expectedToken) {
    logger.error("rtdn_webhook_misconfigured", undefined, {
      reason: "WEBHOOK_SECRET not set",
    });
    return res.status(500).send("Server configuration error");
  }

  // Constant-time comparison via safeSecretEqual: pads the provided value to
  // the expected length so neither length nor bytes leak through wall-clock
  // timing. The previous `length !== length` short-circuit was technically
  // a length-disclosure side channel.
  const providedToken = req.query.token;
  if (typeof providedToken !== 'string' || !safeSecretEqual(providedToken, expectedToken)) {
    return res.status(401).send("Unauthorized");
  }

  // RTDN Verification (Google Cloud Pub/Sub push)
  const { message } = req.body;
  if (!message || !message.data) {
    return res.status(400).send("No message data");
  }

  try {
    // Idempotency (two-step "lock then complete"): Pub/Sub may redeliver the
    // same message. Dedupe via processed_pubsub/{messageId} with a status
    // field instead of a single existence check.
    //
    // States:
    //   - status === 'done'        → already handled, ACK 200.
    //   - status === 'in_progress' && lockedAt < 5 min ago → another worker
    //                                 is processing; ACK 200 to suppress
    //                                 redelivery. (We deliberately choose
    //                                 200 over 503: Pub/Sub will redeliver
    //                                 anyway after the ack-deadline if the
    //                                 in-flight processor crashes, and the
    //                                 staleness window below will let that
    //                                 redelivery acquire the lock.)
    //   - status === 'in_progress' && lockedAt >= 5 min ago → stale lock from
    //                                 a crashed processor; we steal it.
    //   - absent                   → fresh — write 'in_progress' then process.
    //
    // On exception during processing we deliberately do NOT update the doc;
    // the 5-minute staleness window will permit a future redelivery to
    // re-acquire the lock and retry. This fixes the prior bug where the
    // existence-only marker was written *before* processing, so any crash
    // permanently silenced redeliveries.
    //
    // The expiresAt field is a hint for a Firestore TTL policy configured at
    // the console (collection: processed_pubsub, field: expiresAt) — Firestore
    // TTL is not configured from code.
    const messageId: string | undefined = message.messageId || message.message_id;
    const db = admin.firestore();
    const STALE_LOCK_MS = 5 * 60 * 1000;
    let processedRef: admin.firestore.DocumentReference | null = null;
    if (messageId) {
      processedRef = db.collection('processed_pubsub').doc(messageId);
      const processedSnap = await processedRef.get();
      if (processedSnap.exists) {
        const data = processedSnap.data() || {};
        if (data.status === 'done') {
          // Duplicate delivery, already handled. ACK so Pub/Sub stops retrying.
          return res.status(200).send("OK");
        }
        if (data.status === 'in_progress') {
          const lockedAt: admin.firestore.Timestamp | undefined = data.lockedAt;
          const lockedAtMs = lockedAt?.toMillis ? lockedAt.toMillis() : 0;
          if (lockedAtMs && Date.now() - lockedAtMs < STALE_LOCK_MS) {
            // Another worker is in-flight. ACK to avoid duplicate work; if it
            // crashes, the next redelivery (after the ack-deadline) will see a
            // stale lock and proceed.
            logger.info('rtdn_in_progress_skip', { messageId });
            return res.status(200).send("OK");
          }
          logger.warn('rtdn_stale_lock_stealing', { messageId, lockedAtMs });
        }
      }
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      // TODO(billing): if a future deploy adds a helper like
      //   withIdempotency(db, messageId, work)
      // this inline block is the canonical reference implementation.
      await processedRef.set(
        {
          status: 'in_progress',
          lockedAt: admin.firestore.FieldValue.serverTimestamp(),
          receivedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt, // hint for Firestore TTL policy (configure in console)
        },
        { merge: true },
      );
    }

    const decodedData = JSON.parse(Buffer.from(message.data, 'base64').toString());
    const { subscriptionNotification } = decodedData;
    const packageName = decodedData.packageName;

    // Log only non-sensitive metadata. NEVER log purchaseToken — it's a
    // bearer credential for Google Play.
    logger.info('rtdn_received', {
      notificationType: subscriptionNotification?.notificationType,
      subscriptionId: subscriptionNotification?.subscriptionId,
      packageName,
    });

    if (subscriptionNotification) {
      const { purchaseToken, subscriptionId } = subscriptionNotification;

      // Update the user whose token matches
      const userQuery = await db.collection('users').where('subscription.purchaseToken', '==', purchaseToken).get();

      if (!userQuery.empty) {
        const userDoc = userQuery.docs[0];
        logger.info('rtdn_updating_user_subscription', { userId: userDoc.id });

        // Fetch fresh state from Google
        const verificationResult = await playDeveloperApi.purchases.subscriptions.get({
          auth: playAuth,
          packageName,
          subscriptionId,
          token: purchaseToken
        });

        const data = verificationResult.data;
        const isActive = data.paymentState === 1 || data.paymentState === 2;
        const expiryDate = data.expiryTimeMillis ? new Date(parseInt(data.expiryTimeMillis)).toISOString() : null;

        await userDoc.ref.update({
          'subscription.status': isActive ? 'active' : 'expired',
          'subscription.expiryDate': expiryDate,
          'subscription.updatedAt': admin.firestore.FieldValue.serverTimestamp()
        });
      }
    }

    // Mark idempotency lock as 'done' only AFTER all processing succeeded.
    // If any step above threw, we fall into the catch — leaving 'in_progress'
    // intact — so the staleness window will permit a future redelivery to
    // retry. Best-effort: a failure to update the marker is logged but does
    // not fail the webhook (the work is already done; the worst case is one
    // duplicate run after the staleness window).
    if (processedRef) {
      try {
        await processedRef.update({
          status: 'done',
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (e) {
        logger.warn('rtdn_idempotency_finalize_failed', { messageId, error: (e as Error)?.message });
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    // Deliberate: do NOT update processed_pubsub here. Leaving the doc as
    // 'in_progress' allows the staleness window to grant a future redelivery
    // a fresh attempt — see the comment block at the top of this handler.
    logger.error("rtdn_webhook_failed", error);
    res.status(500).send("Webhook processing failed");
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Chilean B2B Billing scaffolding (IMP5)
//
// Two endpoints:
//   POST /api/billing/checkout              — create invoice + (eventually)
//                                             redirect URL for Webpay/Stripe.
//   POST /api/billing/invoice/:id/mark-paid — admin manual fallback for
//                                             transferencia bancaria.
//
// Persistence:
//   Invoices are written to the `invoices/{id}` Firestore collection via the
//   Admin SDK only. firestore.rules treats this collection as default-deny
//   (server-only writes) — clients must NEVER read/write it directly. Do
//   not add a rule for `invoices/{id}` without an explicit threat-model
//   review; a wrong rule there leaks tax data and PII.
//
// Real provider integration is NOT in this commit — `webpayAdapter` and
// `stripeAdapter` throw on every method except `isConfigured()`. See
// BILLING.md for the runbook to wire transbank-sdk + stripe.
// ───────────────────────────────────────────────────────────────────────────

// Tier pricing fallback: real source of truth is
// `src/services/pricing/tiers.ts` (IMP1's territory). Until that lands, we
// read from a small inline table mirroring `tiers.test.ts` so this endpoint
// type-checks and serves a 5xx with a helpful message for unknown tiers
// rather than crashing on import.
type BillingTier = {
  clpRegular: number;
  clpAnual: number;
  usdRegular: number;
  usdAnual: number;
};
const BILLING_TIER_FALLBACK: Record<string, BillingTier> = {
  // Net amounts (pre-IVA) for CLP; display amounts (incl IVA) live in tiers.ts.
  // 10075 * 1.19 = 11989.25 → ceil 11990 (matches tiers.test.ts)
  'comite-paritario': { clpRegular: 10075, clpAnual: 81504, usdRegular: 13, usdAnual: 130 },
  'departamento-prevencion': { clpRegular: 26042, clpAnual: 250416, usdRegular: 33, usdAnual: 330 },
  'plata': { clpRegular: 42849, clpAnual: 411513, usdRegular: 54, usdAnual: 540 },
  'oro': { clpRegular: 76462, clpAnual: 734040, usdRegular: 96, usdAnual: 960 },
  'titanio': { clpRegular: 210076, clpAnual: 2016720, usdRegular: 263, usdAnual: 2630 },
  'diamante': { clpRegular: 420160, clpAnual: 4033536, usdRegular: 526, usdAnual: 5260 },
  'empresarial': { clpRegular: 1260496, clpAnual: 12099960, usdRegular: 1578, usdAnual: 15780 },
  'corporativo': { clpRegular: 2521000, clpAnual: 24201600, usdRegular: 3158, usdAnual: 31580 },
  'ilimitado': { clpRegular: 5042008, clpAnual: 48403252, usdRegular: 6315, usdAnual: 63150 },
};

function resolveBillingTier(tierId: string): BillingTier | null {
  return BILLING_TIER_FALLBACK[tierId] ?? null;
}

// Per-unit overage (CLP, net of IVA). Mirrors tiers.test.ts which uses
// $990/worker incl IVA → 990/1.19 ≈ 832.
const OVERAGE_CLP_PER_WORKER_NET = 832;
const OVERAGE_CLP_PER_PROJECT_NET = 5034; // 5990 / 1.19

const VALID_PAYMENT_METHODS: ReadonlyArray<PaymentMethod> = [
  'webpay', 'stripe', 'manual-transfer',
];
const VALID_CURRENCIES: ReadonlyArray<CurrencyCode> = ['CLP', 'USD'];

app.post("/api/billing/checkout", verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;

  try {
    const body = req.body ?? {};

    // Input validation — fail closed. Never trust currency/method from client.
    if (typeof body.tierId !== 'string' || body.tierId.length === 0 || body.tierId.length > 64) {
      return res.status(400).json({ error: "Invalid tierId" });
    }
    if (body.cycle !== 'monthly' && body.cycle !== 'annual') {
      return res.status(400).json({ error: "Invalid cycle" });
    }
    if (!VALID_CURRENCIES.includes(body.currency)) {
      return res.status(400).json({ error: "Invalid currency" });
    }
    if (!VALID_PAYMENT_METHODS.includes(body.paymentMethod)) {
      return res.status(400).json({ error: "Invalid paymentMethod" });
    }
    if (!Number.isFinite(body.totalWorkers) || body.totalWorkers < 0 || body.totalWorkers > 1_000_000) {
      return res.status(400).json({ error: "Invalid totalWorkers" });
    }
    if (!Number.isFinite(body.totalProjects) || body.totalProjects < 0 || body.totalProjects > 100_000) {
      return res.status(400).json({ error: "Invalid totalProjects" });
    }
    const cliente = body.cliente;
    if (
      !cliente ||
      typeof cliente.nombre !== 'string' || cliente.nombre.length === 0 || cliente.nombre.length > 256 ||
      typeof cliente.email !== 'string' || !cliente.email.includes('@') || cliente.email.length > 256 ||
      (cliente.rut !== undefined && (typeof cliente.rut !== 'string' || cliente.rut.length > 32))
    ) {
      return res.status(400).json({ error: "Invalid cliente" });
    }

    // CLP must use webpay or manual-transfer. USD must use stripe.
    if (body.currency === 'CLP' && body.paymentMethod === 'stripe') {
      return res.status(400).json({ error: "CLP requires webpay or manual-transfer" });
    }
    if (body.currency === 'USD' && body.paymentMethod === 'webpay') {
      return res.status(400).json({ error: "USD requires stripe or manual-transfer" });
    }

    const tier = resolveBillingTier(body.tierId);
    if (!tier) {
      return res.status(400).json({ error: "Unknown tierId" });
    }

    const checkoutRequest: CheckoutRequest = {
      tierId: body.tierId,
      cycle: body.cycle,
      currency: body.currency,
      totalWorkers: body.totalWorkers,
      totalProjects: body.totalProjects,
      cliente: {
        nombre: cliente.nombre,
        email: cliente.email,
        rut: cliente.rut,
      },
      paymentMethod: body.paymentMethod,
    };

    // Compute overage off the tier limits. For now only Comité Paritario
    // and Departamento have variable overage in the fallback; the real
    // calculation belongs in pricing/tiers.ts.
    const workerOverage = Math.max(0, body.totalWorkers - 25);
    const projectOverage = Math.max(0, body.totalProjects - 3);

    const invoice = buildInvoice(
      checkoutRequest,
      tier,
      {
        workers: workerOverage,
        projects: projectOverage,
        clpPerWorker: OVERAGE_CLP_PER_WORKER_NET,
        clpPerProject: OVERAGE_CLP_PER_PROJECT_NET,
      },
      {
        emisorRazonSocial: process.env.BILLING_EMISOR_RAZON_SOCIAL,
      },
    );

    const db = admin.firestore();
    // Use the locally generated invoice.id as the Firestore doc id so the
    // CheckoutResponse and the Firestore document agree.
    await db.collection('invoices').doc(invoice.id).set({
      ...invoice,
      status: 'pending-payment',
      createdBy: callerUid,
      createdByEmail: callerEmail,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Adapter call — typed stubs throw, so we fall back to 'pending-config'.
    let paymentUrl: string | undefined;
    let status: CheckoutResponse['status'] = 'pending-config';

    if (body.paymentMethod === 'webpay' && webpayAdapter.isConfigured()) {
      try {
        const tx = await webpayAdapter.createTransaction({
          buyOrder: invoice.id.slice(0, 26),
          sessionId: callerUid,
          amount: invoice.totals.total,
          returnUrl: `${process.env.APP_BASE_URL ?? ''}/billing/return`,
        });
        paymentUrl = tx.url;
        status = 'awaiting-payment';
      } catch (err) {
        logger.error('webpay_create_failed', err, { invoiceId: invoice.id });
      }
    } else if (body.paymentMethod === 'stripe' && stripeAdapter.isConfigured()) {
      try {
        const session = await stripeAdapter.createCheckoutSession({
          invoiceId: invoice.id,
          priceId: process.env[`STRIPE_PRICE_${body.tierId.toUpperCase().replace(/-/g, '_')}`] ?? '',
          quantity: 1,
          customerEmail: cliente.email,
          successUrl: `${process.env.APP_BASE_URL ?? ''}/billing/success?invoice=${invoice.id}`,
          cancelUrl: `${process.env.APP_BASE_URL ?? ''}/billing/cancel?invoice=${invoice.id}`,
          metadata: { invoiceId: invoice.id, tierId: body.tierId },
        });
        paymentUrl = session.url;
        status = 'awaiting-payment';
      } catch (err) {
        logger.error('stripe_create_failed', err, { invoiceId: invoice.id });
      }
    } else if (body.paymentMethod === 'manual-transfer') {
      // No external provider — admin marks paid via /mark-paid endpoint.
      status = 'awaiting-payment';
    }

    const response: CheckoutResponse = {
      invoiceId: invoice.id,
      invoice: { ...invoice, status: 'pending-payment' },
      paymentUrl,
      status,
    };
    res.json(response);
  } catch (error: any) {
    logger.error('billing_checkout_failed', error, { uid: callerUid });
    res.status(500).json({
      error: "Checkout failed",
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

app.post("/api/billing/invoice/:id/mark-paid", verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const callerEmail: string | null = (req as any).user.email ?? null;
  const invoiceId = req.params.id;

  if (typeof invoiceId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(invoiceId)) {
    return res.status(400).json({ error: "Invalid invoice id" });
  }

  try {
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res.status(403).json({ error: "Forbidden: admin role required" });
    }

    const db = admin.firestore();
    const ref = db.collection('invoices').doc(invoiceId);
    const snap = await ref.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Invoice not found" });
    }
    const current = snap.data();
    if (current?.status === 'paid') {
      return res.json({ success: true, alreadyPaid: true });
    }
    if (current?.status === 'cancelled' || current?.status === 'refunded') {
      return res.status(409).json({ error: `Cannot mark ${current.status} invoice as paid` });
    }

    await ref.update({
      status: 'paid',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paidBy: callerUid,
      paidByEmail: callerEmail,
      paymentSource: 'manual',
    });

    // Mirror /api/audit-log behavior — write directly via Admin SDK so we
    // stamp the same fields without an extra HTTP hop.
    await db.collection('audit_logs').add({
      action: 'billing.mark-paid',
      module: 'billing',
      details: { invoiceId, total: current?.totals?.total, currency: current?.totals?.currency },
      userId: callerUid,
      userEmail: callerEmail,
      projectId: null,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      ip: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('billing_mark_paid_failed', error, { uid: callerUid, invoiceId });
    res.status(500).json({
      error: "Mark-paid failed",
      details: process.env.NODE_ENV === 'production' ? undefined : error?.message,
    });
  }
});

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
