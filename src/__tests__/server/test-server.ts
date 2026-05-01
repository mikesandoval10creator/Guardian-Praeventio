// Praeventio Guard — Round 15 (I3 / A6 audit) test server harness.
//
// `server.ts` is 3027 LOC, boots Vite middleware, calls `app.listen()`,
// initializes Firebase Admin against a real GCP project, kicks off
// background timers, and mounts 50 routes. We CANNOT just `await import
// '../../server.ts'` from a test — it would block on Vite, spawn timers
// that survive the test run, and need a real GCP credential to even
// pass `admin.initializeApp`.
//
// Strategy: build a parallel minimal Express app that re-implements the
// SAME route contracts we want to cover, with the SAME middleware order
// (verifyAuth, validation, assertProjectMember, audit-log writes). The
// trade-off is that drift between server.ts and this file is possible;
// the mitigation is:
//
//   1. Each handler here is intentionally a near-verbatim copy of the
//      production handler (same status codes, same JSON shapes, same
//      error branches). A diff against server.ts after refactors will
//      surface drift quickly.
//   2. The dependencies that DO have unit tests (assertProjectMember,
//      buildInvoice, curriculum services, idempotency helpers) are
//      imported and called directly, so behavior changes there ARE
//      reflected here.
//   3. Tests focus on wiring (auth, validation, status codes, audit
//      emissions, tenant isolation) — exactly what server.ts adds on
//      top of the unit-tested pure functions.
//
// Future work: extract route handlers from server.ts into a registrar
// (`registerRoutes(app, deps)`) so this file can call the real one.
// Out of scope for I3.

import type { Express, Request, Response, NextFunction } from 'express';
import express from 'express';
import crypto from 'crypto';

import { buildInvoice } from '../../services/billing/invoice.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import {
  hashToken as curriculumHashToken,
  generateRefereeToken as curriculumGenToken,
} from '../../services/curriculum/refereeTokens.js';
import {
  createClaim as curriculumCreateClaim,
  recordRefereeEndorsement as curriculumEndorse,
  type ClaimCategory,
} from '../../services/curriculum/claims.js';

// ─────────────────────────────────────────────────────────────────────
// Fake Firebase Admin
// ─────────────────────────────────────────────────────────────────────

export interface FakeUserRecord {
  uid: string;
  email?: string;
  displayName?: string;
  customClaims?: { role?: string };
}

export interface FakeAuth {
  verifyIdToken: (token: string) => Promise<{ uid: string; email?: string }>;
  getUser: (uid: string) => Promise<FakeUserRecord>;
  getUserByEmail: (email: string) => Promise<FakeUserRecord>;
  setCustomUserClaims: (uid: string, claims: any) => Promise<void>;
  revokeRefreshTokens: (uid: string) => Promise<void>;
}

export interface FakeFirestore {
  collection(name: string): FakeCollection;
}
export interface FakeCollection {
  doc(id: string): FakeDocRef;
  add(data: any): Promise<{ id: string }>;
  where(field: string, op: string, value: any): FakeQuery;
}
export interface FakeQuery {
  where(field: string, op: string, value: any): FakeQuery;
  limit(n: number): FakeQuery;
  get(): Promise<{ empty: boolean; docs: Array<{ id: string; ref: FakeDocRef; data(): any }> }>;
}
export interface FakeDocRef {
  id: string;
  get(): Promise<{ exists: boolean; ref: FakeDocRef; data(): any }>;
  set(data: any, opts?: { merge?: boolean }): Promise<void>;
  update(data: any): Promise<void>;
  delete(): Promise<void>;
}

/** Minimal in-memory Firestore-shaped store. Keys are `${col}/${id}`. */
export class InMemoryFirestore implements FakeFirestore {
  store = new Map<string, any>();
  audit: Array<Record<string, any>> = [];
  collection(name: string): FakeCollection {
    return makeCollection(this, name);
  }
}

function makeCollection(fs: InMemoryFirestore, colName: string): FakeCollection {
  return {
    doc(id: string) {
      return makeDocRef(fs, colName, id);
    },
    async add(data: any) {
      const id = `auto_${Math.random().toString(36).slice(2, 10)}`;
      const key = `${colName}/${id}`;
      fs.store.set(key, { ...data });
      if (colName === 'audit_logs') {
        fs.audit.push({ ...data });
      }
      return { id };
    },
    where(field: string, op: string, value: any) {
      return makeQuery(fs, colName, [{ field, op, value }]);
    },
  };
}

function matches(doc: any, filters: Array<{ field: string; op: string; value: any }>): boolean {
  return filters.every(({ field, op, value }) => {
    const v = field.split('.').reduce((acc: any, k) => (acc == null ? acc : acc[k]), doc);
    if (op === '==') return v === value;
    if (op === '!=') return v !== value;
    if (op === 'in') return Array.isArray(value) && value.includes(v);
    return false;
  });
}

function makeQuery(
  fs: InMemoryFirestore,
  colName: string,
  filters: Array<{ field: string; op: string; value: any }>,
  lim?: number,
): FakeQuery {
  return {
    where(field, op, value) {
      return makeQuery(fs, colName, [...filters, { field, op, value }], lim);
    },
    limit(n) {
      return makeQuery(fs, colName, filters, n);
    },
    async get() {
      const docs: Array<{ id: string; ref: FakeDocRef; data(): any }> = [];
      for (const [key, value] of fs.store.entries()) {
        const [col, id] = key.split('/');
        if (col !== colName) continue;
        if (!matches(value, filters)) continue;
        docs.push({ id, ref: makeDocRef(fs, colName, id), data: () => value });
        if (lim && docs.length >= lim) break;
      }
      return { empty: docs.length === 0, docs };
    },
  };
}

function makeDocRef(fs: InMemoryFirestore, colName: string, id: string): FakeDocRef {
  const key = `${colName}/${id}`;
  return {
    id,
    async get() {
      const data = fs.store.get(key);
      return {
        exists: data !== undefined,
        id,
        ref: makeDocRef(fs, colName, id),
        data: () => data,
      } as any;
    },
    async set(data: any, opts?: { merge?: boolean }) {
      if (opts?.merge && fs.store.has(key)) {
        // Apply field-path updates (e.g. "subscription.status")
        const cur = { ...fs.store.get(key) };
        applyMerge(cur, data);
        fs.store.set(key, cur);
      } else {
        fs.store.set(key, { ...data });
      }
    },
    async update(data: any) {
      const cur = { ...(fs.store.get(key) ?? {}) };
      applyMerge(cur, data);
      fs.store.set(key, cur);
    },
    async delete() {
      fs.store.delete(key);
    },
  };
}

/** Sentinel for arrayUnion/arrayRemove/serverTimestamp operations. */
const UNION = Symbol('arrayUnion');
const REMOVE_FIELD = Symbol('deleteField');

export const fakeFieldValue = {
  serverTimestamp: () => ({ __ts: true, at: new Date().toISOString() }),
  arrayUnion: (...items: any[]) => ({ [UNION]: items }),
  arrayRemove: (...items: any[]) => ({ __remove: items }),
  delete: () => ({ [REMOVE_FIELD]: true }),
};

function applyMerge(target: any, patch: any) {
  for (const [k, v] of Object.entries(patch)) {
    if (k.includes('.')) {
      const parts = k.split('.');
      let cur = target;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = cur[parts[i]] ?? {};
        cur = cur[parts[i]];
      }
      const last = parts[parts.length - 1];
      if (v && typeof v === 'object' && (v as any)[REMOVE_FIELD]) {
        delete cur[last];
      } else {
        cur[last] = v;
      }
    } else if (v && typeof v === 'object' && (v as any)[UNION]) {
      const items = (v as any)[UNION];
      target[k] = Array.isArray(target[k]) ? [...new Set([...target[k], ...items])] : [...items];
    } else if (v && typeof v === 'object' && (v as any).__remove) {
      const items = (v as any).__remove;
      target[k] = Array.isArray(target[k]) ? target[k].filter((x: any) => !items.includes(x)) : target[k];
    } else if (v && typeof v === 'object' && (v as any)[REMOVE_FIELD]) {
      delete target[k];
    } else {
      target[k] = v;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Test app builder
// ─────────────────────────────────────────────────────────────────────

export interface TestServerDeps {
  auth: FakeAuth;
  firestore: InMemoryFirestore;
  resendSend: (...args: any[]) => Promise<any>;
  playVerify?: (...args: any[]) => Promise<any>;
  webpayCreate?: (req: any) => Promise<{ token: string; url: string }>;
  webpayCommit?: (token: string) => Promise<{
    status: 'AUTHORIZED' | 'REJECTED' | 'FAILED';
    buyOrder: string;
    amount: number;
    authorizationCode?: string;
  }>;
  webhookSecret?: string;
  webpayConfigured?: boolean;
}

export interface TestServerHandle {
  app: Express;
  deps: TestServerDeps;
}

const VALID_ROLES = ['admin', 'gerente', 'supervisor', 'prevencionista', 'operario', 'visualizador'];
const ADMIN_ROLES = ['admin', 'gerente'];
const UID_REGEX = /^[A-Za-z0-9_-]{1,128}$/;
const VALID_PAYMENT_METHODS = ['webpay', 'stripe', 'manual-transfer'] as const;
const VALID_CURRENCIES = ['CLP', 'USD'] as const;
const BILLING_TIER_FALLBACK: Record<string, any> = {
  'comite-paritario': { clpRegular: 10075, clpAnual: 81504, usdRegular: 13, usdAnual: 130 },
  'departamento-prevencion': { clpRegular: 26042, clpAnual: 250416, usdRegular: 33, usdAnual: 330 },
  plata: { clpRegular: 42849, clpAnual: 411513, usdRegular: 54, usdAnual: 540 },
  oro: { clpRegular: 76462, clpAnual: 734040, usdRegular: 96, usdAnual: 960 },
};

function safeSecretEqual(provided: string | undefined, expected: string): boolean {
  if (typeof provided !== 'string') return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  const padded = Buffer.alloc(expectedBuf.length);
  providedBuf.copy(padded);
  const lengthOk = providedBuf.length === expectedBuf.length;
  const valueOk = crypto.timingSafeEqual(padded, expectedBuf);
  return lengthOk && valueOk;
}

export function buildTestServer(overrides: Partial<TestServerDeps> = {}): TestServerHandle {
  const firestore = overrides.firestore ?? new InMemoryFirestore();
  const auth: FakeAuth = overrides.auth ?? {
    async verifyIdToken(token: string) {
      // Convention: token format "test:uid:email" → decoded.
      if (token === 'invalid') throw new Error('invalid token');
      const [, uid, email] = token.split(':');
      return { uid: uid ?? 'uid-default', email: email || `${uid}@test.com` };
    },
    async getUser(uid: string) {
      return { uid, email: `${uid}@test.com`, customClaims: {} };
    },
    async getUserByEmail(email: string) {
      throw Object.assign(new Error('user not found'), { code: 'auth/user-not-found' });
    },
    async setCustomUserClaims() {},
    async revokeRefreshTokens() {},
  };
  const deps: TestServerDeps = {
    firestore,
    auth,
    resendSend: overrides.resendSend ?? (async () => ({ id: 'msg_test' })),
    playVerify: overrides.playVerify,
    webpayCreate:
      overrides.webpayCreate ??
      (async () => ({ token: 'tok_test', url: 'https://webpay.test/redirect?token_ws=tok_test' })),
    webpayCommit:
      overrides.webpayCommit ??
      (async (token: string) => ({
        status: 'AUTHORIZED' as const,
        buyOrder: 'inv_test',
        amount: 11990,
        authorizationCode: 'AUTH123',
      })),
    webhookSecret: overrides.webhookSecret ?? 'webhook-secret-test',
    webpayConfigured: overrides.webpayConfigured ?? true,
  };

  const app = express();
  app.use(express.json({ limit: '64kb' }));

  // verifyAuth middleware
  const verifyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized: No token provided' });
    }
    const token = authHeader.split('Bearer ')[1];
    try {
      const decoded = await deps.auth.verifyIdToken(token);
      (req as any).user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  };

  // ─── /api/health ─────────────────────────────────────────────────
  app.get('/api/health', async (_req, res) => {
    const checks: Record<string, 'ok' | 'fail'> = {};
    let allOk = true;
    try {
      await Promise.resolve(); // mimic listCollections
      checks.firestore = 'ok';
    } catch {
      checks.firestore = 'fail';
      allOk = false;
    }
    res.status(allOk ? 200 : 503).json({
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? 'dev',
      checks,
    });
  });

  // ─── /api/audit-log ───────────────────────────────────────────────
  app.post('/api/audit-log', verifyAuth, async (req, res) => {
    const callerUid = (req as any).user.uid;
    const callerEmail = (req as any).user.email ?? null;
    const { action, module: mod, details, projectId } = req.body ?? {};

    if (typeof action !== 'string' || action.length === 0 || action.length > 64) {
      return res.status(400).json({ error: 'Invalid action' });
    }
    if (typeof mod !== 'string' || mod.length === 0 || mod.length > 64) {
      return res.status(400).json({ error: 'Invalid module' });
    }
    if (
      projectId !== undefined &&
      projectId !== null &&
      (typeof projectId !== 'string' || projectId.length > 128)
    ) {
      return res.status(400).json({ error: 'Invalid projectId' });
    }

    if (typeof projectId === 'string' && projectId.length > 0) {
      try {
        await assertProjectMember(callerUid, projectId, deps.firestore as any);
      } catch (err) {
        if (err instanceof ProjectMembershipError) {
          return res.status(err.httpStatus).json({ error: 'forbidden' });
        }
        throw err;
      }
    }

    try {
      await deps.firestore.collection('audit_logs').add({
        action,
        module: mod,
        details: details ?? {},
        userId: callerUid,
        userEmail: callerEmail,
        projectId: projectId ?? null,
        timestamp: fakeFieldValue.serverTimestamp(),
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: 'Audit log write failed' });
    }
  });

  // ─── /api/admin/set-role ─────────────────────────────────────────
  app.post('/api/admin/set-role', verifyAuth, async (req, res) => {
    const { uid, role } = req.body ?? {};
    const callerUid = (req as any).user.uid;
    if (typeof uid !== 'string' || !UID_REGEX.test(uid)) {
      return res.status(400).json({ error: 'Invalid uid' });
    }
    try {
      const callerRecord = await deps.auth.getUser(callerUid);
      if (!ADMIN_ROLES.includes(callerRecord.customClaims?.role ?? '')) {
        return res.status(403).json({ error: 'Forbidden: Requires admin role' });
      }
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      let oldRole: string | null = null;
      try {
        const target = await deps.auth.getUser(uid);
        oldRole = target.customClaims?.role ?? null;
      } catch {}
      await deps.auth.setCustomUserClaims(uid, { role });
      await deps.auth.revokeRefreshTokens(uid);
      await deps.firestore.collection('audit_logs').add({
        actor: callerUid,
        action: 'set_role',
        target: uid,
        oldRole,
        newRole: role,
        ts: fakeFieldValue.serverTimestamp(),
      });
      res.json({ success: true, message: `Role ${role} assigned to user ${uid}` });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── /api/admin/revoke-access ────────────────────────────────────
  app.post('/api/admin/revoke-access', verifyAuth, async (req, res) => {
    const { targetUid } = req.body ?? {};
    const callerUid = (req as any).user.uid;
    if (typeof targetUid !== 'string' || !UID_REGEX.test(targetUid)) {
      return res.status(400).json({ error: 'Invalid uid' });
    }
    try {
      const callerRecord = await deps.auth.getUser(callerUid);
      if (!ADMIN_ROLES.includes(callerRecord.customClaims?.role ?? '')) {
        return res.status(403).json({ error: 'Forbidden: Requires admin role to revoke access' });
      }
      await deps.auth.revokeRefreshTokens(targetUid);
      await deps.firestore.collection('user_sessions').doc(targetUid).set(
        { revokedAt: fakeFieldValue.serverTimestamp() },
        { merge: true },
      );
      await deps.firestore.collection('audit_logs').add({
        actor: callerUid,
        action: 'revoke_access',
        target: targetUid,
        ts: fakeFieldValue.serverTimestamp(),
      });
      res.json({ success: true, message: `Access revoked for user ${targetUid}` });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── /api/billing/verify ─────────────────────────────────────────
  app.post('/api/billing/verify', verifyAuth, async (req, res) => {
    const { purchaseToken, productId, type } = req.body ?? {};
    const uid = (req as any).user.uid;
    if (!deps.playVerify) {
      return res.status(500).json({ error: 'Google Play API not configured on server' });
    }
    try {
      const verificationResult = await deps.playVerify({
        type,
        productId,
        purchaseToken,
      });
      const data = verificationResult.data;
      await deps.firestore.collection('transactions').add({
        userId: uid,
        orderId: data.orderId ?? 'unknown',
        productId,
        purchaseToken,
        type: type ?? 'subscription',
        status: 'verified',
      });
      const VALID_PLANS = [
        'free',
        'comite',
        'departamento',
        'plata',
        'oro',
        'platino',
        'empresarial',
        'corporativo',
        'ilimitado',
      ];
      const resolvedPlan = VALID_PLANS.includes(productId) ? productId : 'comite';
      if (type === 'subscription') {
        const expiryDate = data.expiryTimeMillis
          ? new Date(parseInt(data.expiryTimeMillis)).toISOString()
          : null;
        const isActive = data.paymentState === 1 || data.paymentState === 2;
        await deps.firestore.collection('users').doc(uid).update({
          'subscription.planId': resolvedPlan,
          'subscription.status': isActive ? 'active' : 'expired',
          'subscription.expiryDate': expiryDate,
          'subscription.purchaseToken': purchaseToken,
        });
      } else {
        await deps.firestore.collection('users').doc(uid).update({
          [`purchased_products.${productId}`]: true,
        });
      }
      res.json({ success: true, data });
    } catch {
      res.status(500).json({ error: 'Failed to verify purchase' });
    }
  });

  // ─── /api/billing/checkout ───────────────────────────────────────
  app.post('/api/billing/checkout', verifyAuth, async (req, res) => {
    const callerUid = (req as any).user.uid;
    const callerEmail = (req as any).user.email ?? null;
    const body = req.body ?? {};
    if (typeof body.tierId !== 'string' || body.tierId.length === 0 || body.tierId.length > 64) {
      return res.status(400).json({ error: 'Invalid tierId' });
    }
    if (body.cycle !== 'monthly' && body.cycle !== 'annual') {
      return res.status(400).json({ error: 'Invalid cycle' });
    }
    if (!VALID_CURRENCIES.includes(body.currency)) {
      return res.status(400).json({ error: 'Invalid currency' });
    }
    if (!VALID_PAYMENT_METHODS.includes(body.paymentMethod)) {
      return res.status(400).json({ error: 'Invalid paymentMethod' });
    }
    if (
      !Number.isFinite(body.totalWorkers) ||
      body.totalWorkers < 0 ||
      body.totalWorkers > 1_000_000
    ) {
      return res.status(400).json({ error: 'Invalid totalWorkers' });
    }
    if (
      !Number.isFinite(body.totalProjects) ||
      body.totalProjects < 0 ||
      body.totalProjects > 100_000
    ) {
      return res.status(400).json({ error: 'Invalid totalProjects' });
    }
    const cliente = body.cliente;
    if (
      !cliente ||
      typeof cliente.nombre !== 'string' ||
      cliente.nombre.length === 0 ||
      typeof cliente.email !== 'string' ||
      !cliente.email.includes('@')
    ) {
      return res.status(400).json({ error: 'Invalid cliente' });
    }
    if (body.currency === 'CLP' && body.paymentMethod === 'stripe') {
      return res.status(400).json({ error: 'CLP requires webpay or manual-transfer' });
    }
    if (body.currency === 'USD' && body.paymentMethod === 'webpay') {
      return res.status(400).json({ error: 'USD requires stripe or manual-transfer' });
    }
    const tier = BILLING_TIER_FALLBACK[body.tierId];
    if (!tier) {
      return res.status(400).json({ error: 'Unknown tierId' });
    }
    const checkoutRequest = {
      tierId: body.tierId,
      cycle: body.cycle,
      currency: body.currency,
      totalWorkers: body.totalWorkers,
      totalProjects: body.totalProjects,
      cliente: { nombre: cliente.nombre, email: cliente.email, rut: cliente.rut },
      paymentMethod: body.paymentMethod,
    };
    const workerOverage = Math.max(0, body.totalWorkers - 25);
    const projectOverage = Math.max(0, body.totalProjects - 3);
    const invoice = buildInvoice(
      checkoutRequest as any,
      tier,
      { workers: workerOverage, projects: projectOverage, clpPerWorker: 832, clpPerProject: 5034 },
      {},
    );
    await deps.firestore.collection('invoices').doc(invoice.id).set({
      ...invoice,
      status: 'pending-payment',
      createdBy: callerUid,
      createdByEmail: callerEmail,
      createdAt: fakeFieldValue.serverTimestamp(),
    });
    let paymentUrl: string | undefined;
    let status: string = 'pending-config';
    if (body.paymentMethod === 'webpay' && deps.webpayConfigured && deps.webpayCreate) {
      try {
        const tx = await deps.webpayCreate({
          buyOrder: invoice.id.slice(0, 26),
          sessionId: callerUid,
          amount: invoice.totals.total,
          returnUrl: '/billing/return',
        });
        paymentUrl = tx.url;
        status = 'awaiting-payment';
      } catch {}
    } else if (body.paymentMethod === 'manual-transfer') {
      status = 'awaiting-payment';
    }
    res.json({
      invoiceId: invoice.id,
      invoice: { ...invoice, status: 'pending-payment' },
      paymentUrl,
      status,
    });
  });

  // ─── /api/billing/invoice/:id ────────────────────────────────────
  app.get('/api/billing/invoice/:id', verifyAuth, async (req, res) => {
    const callerUid = (req as any).user.uid;
    const invoiceId = req.params.id;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(invoiceId)) {
      return res.status(400).json({ error: 'Invalid invoice id' });
    }
    const snap = await deps.firestore.collection('invoices').doc(invoiceId).get();
    if (!snap.exists) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const data = snap.data() ?? {};
    if (data.createdBy !== callerUid) {
      return res.status(404).json({ error: 'Invoice not found' });
    }
    const safe: any = {
      id: invoiceId,
      status: data.status,
      totals: {
        subtotal: data.totals?.subtotal ?? 0,
        iva: data.totals?.iva ?? 0,
        total: data.totals?.total ?? 0,
        currency: data.totals?.currency ?? 'CLP',
      },
      emisorRut: '78231119-0',
      issuedAt: data.issuedAt ?? '',
    };
    if (safe.status === 'paid') safe.paidAt = data.paidAt;
    if (safe.status === 'rejected' && typeof data.rejectionReason === 'string') {
      safe.rejectionReason = data.rejectionReason;
    }
    res.json(safe);
  });

  // ─── /api/billing/webhook ────────────────────────────────────────
  app.post('/api/billing/webhook', async (req, res) => {
    const expectedToken = deps.webhookSecret;
    if (!expectedToken) {
      return res.status(500).send('Server configuration error');
    }
    const providedToken = req.query.token;
    if (typeof providedToken !== 'string' || !safeSecretEqual(providedToken, expectedToken)) {
      return res.status(401).send('Unauthorized');
    }
    const { message } = req.body ?? {};
    if (!message || !message.data) {
      return res.status(400).send('No message data');
    }
    const messageId: string | undefined = message.messageId || message.message_id;
    if (!messageId) {
      return res.status(200).send('OK');
    }
    // Idempotency: dedupe via processed_pubsub.
    const lockRef = deps.firestore.collection('processed_pubsub').doc(messageId);
    const lockSnap = await lockRef.get();
    if (lockSnap.exists && lockSnap.data()?.status === 'done') {
      return res.status(200).send('OK');
    }
    await lockRef.set({ status: 'in_progress', lockedAtMs: Date.now() });
    try {
      const decoded = JSON.parse(Buffer.from(message.data, 'base64').toString());
      const { subscriptionNotification } = decoded;
      if (subscriptionNotification) {
        const { purchaseToken } = subscriptionNotification;
        const usersQ = await deps.firestore
          .collection('users')
          .where('subscription.purchaseToken', '==', purchaseToken)
          .get();
        if (!usersQ.empty) {
          // Just stamp activity — we don't re-call play API in tests.
          await usersQ.docs[0].ref.update({ 'subscription.status': 'active' });
        }
      }
      await lockRef.set({ status: 'done', completedAt: new Date() }, { merge: true });
      return res.status(200).send('OK');
    } catch {
      return res.status(500).send('Webhook processing failed');
    }
  });

  // ─── /billing/webpay/return ──────────────────────────────────────
  app.get('/billing/webpay/return', async (req, res) => {
    const tokenWs = typeof req.query.token_ws === 'string' ? req.query.token_ws : null;
    if (!tokenWs || !/^[A-Za-z0-9_-]{1,128}$/.test(tokenWs)) {
      return res.status(400).send('Missing or invalid token_ws');
    }
    const lockRef = deps.firestore.collection('processed_webpay').doc(tokenWs);
    const lockSnap = await lockRef.get();
    if (lockSnap.exists && lockSnap.data()?.status === 'done') {
      const { outcome, invoiceId } = lockSnap.data() ?? {};
      const inv = invoiceId ? `?invoice=${encodeURIComponent(invoiceId)}` : '';
      if (outcome === 'paid') return res.redirect(`/pricing/success${inv}`);
      if (outcome === 'rejected') return res.redirect(`/pricing/failed${inv}`);
      return res.redirect(`/pricing/retry${inv}`);
    }
    await lockRef.set({ status: 'in_progress', lockedAtMs: Date.now() });
    try {
      const commit = await deps.webpayCommit!(tokenWs);
      const invoiceId = commit.buyOrder;
      const invoiceRef = deps.firestore.collection('invoices').doc(invoiceId);
      let outcome: 'paid' | 'rejected' | 'failed';
      if (commit.status === 'AUTHORIZED') {
        outcome = 'paid';
        await invoiceRef.set(
          { status: 'paid', paidAt: new Date().toISOString(), paymentSource: 'webpay' },
          { merge: true },
        );
        await deps.firestore.collection('audit_logs').add({
          action: 'billing.webpay-return.authorized',
          module: 'billing',
          details: { invoiceId, amount: commit.amount },
        });
      } else if (commit.status === 'REJECTED') {
        outcome = 'rejected';
        await invoiceRef.set({ status: 'rejected' }, { merge: true });
      } else {
        outcome = 'failed';
        await invoiceRef.set({ status: 'pending-payment' }, { merge: true });
      }
      await lockRef.set({ status: 'done', outcome, invoiceId }, { merge: true });
      const inv = `?invoice=${encodeURIComponent(invoiceId)}`;
      if (outcome === 'paid') return res.redirect(`/pricing/success${inv}`);
      if (outcome === 'rejected') return res.redirect(`/pricing/failed${inv}`);
      return res.redirect(`/pricing/retry${inv}`);
    } catch {
      return res.redirect('/pricing/failed?error=webpay');
    }
  });

  // ─── /api/curriculum/claim ──────────────────────────────────────
  app.post('/api/curriculum/claim', verifyAuth, async (req, res) => {
    const callerUid = (req as any).user.uid;
    const callerEmail = (req as any).user.email ?? null;
    const { claim, category, referees, signedByWorker } = req.body ?? {};

    if (typeof claim !== 'string' || claim.trim().length === 0 || claim.trim().length > 500) {
      return res.status(400).json({ error: 'claim text is required and must be ≤500 chars' });
    }
    const validCats: ClaimCategory[] = ['experience', 'certification', 'incident_record', 'other'];
    if (!validCats.includes(category)) {
      return res.status(400).json({ error: 'invalid category' });
    }
    if (!Array.isArray(referees) || referees.length !== 2) {
      return res.status(400).json({ error: 'exactly 2 referees are required' });
    }
    try {
      const audit = async (action: string, details: any) => {
        await deps.firestore.collection('audit_logs').add({
          action,
          module: 'curriculum',
          details,
          userId: callerUid,
        });
      };
      const result = await curriculumCreateClaim(
        {
          workerId: callerUid,
          workerEmail: callerEmail ?? '',
          claim,
          category,
          signedByWorker: signedByWorker ?? {},
          referees,
        },
        deps.firestore as any,
        audit,
      );
      // Fire emails (non-blocking via mocked resend)
      await Promise.all(
        result.refereeTokens.map(async (rawToken, idx) => {
          try {
            await deps.resendSend({
              from: 'Praeventio Guard <noreply@praeventio.net>',
              to: referees[idx].email,
              subject: `Te nombró referencia`,
              html: `<a href="/curriculum/referee/${rawToken}">Co-firmar</a>`,
            });
          } catch {}
        }),
      );
      res.json({ success: true, claimId: result.id });
    } catch (error: any) {
      const message = error?.message || 'Internal server error';
      if (/required|invalid|exactly 2|distinct|500/i.test(message)) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── /api/curriculum/referee/:token (POST) ──────────────────────
  app.post('/api/curriculum/referee/:token', async (req, res) => {
    const rawToken = req.params.token ?? '';
    const { action, method, signature } = req.body ?? {};
    if (!/^[0-9a-f]{64}$/.test(rawToken)) {
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
      const tokenHash = curriculumHashToken(rawToken);
      const all = await deps.firestore
        .collection('curriculum_claims')
        .where('status', '==', 'pending_referees')
        .get();
      let claimId: string | null = null;
      for (const d of all.docs) {
        const data = d.data();
        const idx = (data.referees ?? []).findIndex((r: any) => r.tokenHash === tokenHash);
        if (idx !== -1) {
          claimId = d.id;
          break;
        }
      }
      if (!claimId) {
        return res.status(404).json({ error: 'token does not match any pending claim' });
      }
      if (action === 'decline') {
        const ref = deps.firestore.collection('curriculum_claims').doc(claimId);
        const snap = await ref.get();
        const data = snap.data() as any;
        const idx = data.referees.findIndex((r: any) => r.tokenHash === tokenHash);
        const updated = data.referees.map((r: any, i: number) =>
          i === idx
            ? {
                ...r,
                declined: true,
                signedAt: new Date().toISOString(),
                signature,
                method: method ?? 'standard',
              }
            : r,
        );
        await ref.update({ referees: updated, status: 'rejected' });
        await deps.firestore.collection('audit_logs').add({
          action: 'curriculum.referee.declined',
          module: 'curriculum',
          details: { claimId },
        });
        return res.json({ success: true, verified: false, declined: true });
      }
      const audit = async (action: string, details: any) => {
        await deps.firestore.collection('audit_logs').add({
          action,
          module: 'curriculum',
          details,
        });
      };
      const result = await curriculumEndorse(
        claimId,
        rawToken,
        { signature, method: method as 'webauthn' | 'standard' },
        deps.firestore as any,
        audit,
      );
      res.json({ success: true, verified: result.verified });
    } catch (error: any) {
      const message = error?.message || 'Internal server error';
      if (/expired/i.test(message)) return res.status(410).json({ error: message });
      if (/already/i.test(message)) return res.status(409).json({ error: message });
      if (/token|match/i.test(message)) return res.status(404).json({ error: message });
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── /api/projects/:id/invite ───────────────────────────────────
  app.post('/api/projects/:id/invite', verifyAuth, async (req, res) => {
    const projectId = req.params.id;
    const callerUid = (req as any).user.uid;
    const { invitedEmail, invitedRole } = req.body ?? {};
    if (!invitedEmail || !invitedRole) {
      return res.status(400).json({ error: 'invitedEmail and invitedRole are required' });
    }
    try {
      const projectDoc = await deps.firestore.collection('projects').doc(projectId).get();
      if (!projectDoc.exists) return res.status(404).json({ error: 'Project not found' });
      const projectData = projectDoc.data()!;
      if (projectData.createdBy !== callerUid) {
        const callerRecord = await deps.auth.getUser(callerUid);
        if (
          callerRecord.customClaims?.role !== 'gerente' &&
          callerRecord.customClaims?.role !== 'admin'
        ) {
          return res
            .status(403)
            .json({ error: 'Forbidden: Only the project creator can invite members' });
        }
      }
      const existing: string[] = projectData.members || [];
      try {
        const invitedUser = await deps.auth.getUserByEmail(invitedEmail);
        if (existing.includes(invitedUser.uid)) {
          return res.status(409).json({ error: 'User is already a member of this project' });
        }
      } catch {}
      const dupQ = await deps.firestore
        .collection('invitations')
        .where('projectId', '==', projectId)
        .where('invitedEmail', '==', invitedEmail)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      if (!dupQ.empty) {
        return res.status(409).json({ error: 'A pending invitation already exists for this email' });
      }
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const inviteRef = await deps.firestore.collection('invitations').add({
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
      try {
        await deps.resendSend({
          from: 'Praeventio Guard <noreply@praeventio.net>',
          to: invitedEmail,
          subject: 'Invitation',
          html: `<a>link</a>`,
        });
      } catch {}
      res.json({ success: true, inviteId: inviteRef.id, token, expiresAt });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── /api/invitations/info/:token (public) ──────────────────────
  app.get('/api/invitations/info/:token', async (req, res) => {
    const { token } = req.params;
    try {
      const snap = await deps.firestore
        .collection('invitations')
        .where('token', '==', token)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      if (snap.empty) return res.status(404).json({ error: 'Invitation not found or already used' });
      const invite = snap.docs[0].data();
      if (new Date(invite.expiresAt) < new Date()) {
        return res.status(410).json({ error: 'Invitation has expired' });
      }
      res.json({
        projectName: invite.projectName || 'un proyecto',
        invitedRole: invite.invitedRole,
        invitedEmail: invite.invitedEmail,
        expiresAt: invite.expiresAt,
      });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── /api/invitations/:token/accept ─────────────────────────────
  app.post('/api/invitations/:token/accept', verifyAuth, async (req, res) => {
    const { token } = req.params;
    const callerUid = (req as any).user.uid;
    const callerEmail = (req as any).user.email;
    try {
      const snap = await deps.firestore
        .collection('invitations')
        .where('token', '==', token)
        .where('status', '==', 'pending')
        .limit(1)
        .get();
      if (snap.empty) return res.status(404).json({ error: 'Invitation not found or already used' });
      const inviteDoc = snap.docs[0];
      const invite = inviteDoc.data();
      if (invite.invitedEmail !== callerEmail) {
        return res
          .status(403)
          .json({ error: 'This invitation was sent to a different email address' });
      }
      if (new Date(invite.expiresAt) < new Date()) {
        await inviteDoc.ref.update({ status: 'expired' });
        return res.status(410).json({ error: 'Invitation has expired' });
      }
      const projectRef = deps.firestore.collection('projects').doc(invite.projectId);
      await projectRef.update({
        members: fakeFieldValue.arrayUnion(callerUid),
        [`memberRoles.${callerUid}`]: invite.invitedRole,
      });
      await inviteDoc.ref.update({ status: 'accepted', acceptedAt: new Date().toISOString() });
      res.json({ success: true, projectId: invite.projectId, role: invite.invitedRole });
    } catch {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ─── /api/ask-guardian ──────────────────────────────────────────
  // Minimal wiring test only — we mock the Gemini flow upstream.
  app.post('/api/ask-guardian', verifyAuth, async (req, res) => {
    const { query } = req.body ?? {};
    if (typeof query !== 'string' || query.length === 0) {
      return res.status(400).json({ error: 'query is required' });
    }
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
    }
    res.json({ response: `Echo: ${query}`, contextUsed: false });
  });

  return { app, deps };
}
