// Praeventio Guard — Round 18 Phase 3 split.
//
// Curriculum claims + portable referee co-signing endpoints + WebAuthn
// challenge issuance, extracted from server.ts. Closes Phase 3 of the
// modular-routes refactor (Phases 1/2 shipped admin/health/audit/push and
// billing). Phase 4 (oauth/gemini/ask-guardian/telemetry) is deferred.
//
// Mounted at `/api/curriculum` (5 routes) in server.ts plus the
// /api/auth/webauthn/challenge endpoint which lives on the same router
// because it shares the WebAuthn challenges-DB adapter and is part of the
// same security surface (curriculum cosign uses the WebAuthn flow).
//
// Final paths preserved verbatim — DO NOT change:
//   • POST /api/curriculum/claim
//   • GET  /api/curriculum/claims
//   • POST /api/curriculum/claim/:id/resend
//   • GET  /api/curriculum/referee/:token        (refereeLimiter, public)
//   • POST /api/curriculum/referee/:token        (refereeLimiter, public)
//   • GET  /api/auth/webauthn/challenge          (verifyAuth)
//
// The /api/auth/webauthn/challenge endpoint is mounted via a SEPARATE
// `webauthnChallengeRouter` export so the URL stays under `/api/auth/...`
// rather than `/api/curriculum/auth/webauthn/...`. Keeping it adjacent in
// this file is intentional — see PortableCurriculum cosign flow.

import { Router } from 'express';
import admin from 'firebase-admin';
import { Resend } from 'resend';

import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  refereeLimiter,
  webauthnVerifyLimiter,
  webauthnRegisterLimiter,
} from '../middleware/limiters.js';
import { logger } from '../../utils/logger.js';

import {
  createClaim as curriculumCreateClaim,
  recordRefereeEndorsement as curriculumEndorse,
  getClaimsByWorker as curriculumGetByWorker,
  type ClaimCategory,
  type AuditLogger as CurriculumAuditLogger,
} from '../../services/curriculum/claims.js';
import {
  hashToken as curriculumHashToken,
  generateRefereeToken as curriculumGenToken,
} from '../../services/curriculum/refereeTokens.js';
import {
  generateWebAuthnChallenge,
  storeWebAuthnChallenge,
  consumeWebAuthnChallenge,
  type MinimalChallengesDb as WebAuthnChallengesDb,
} from '../../services/auth/webauthnChallenge.js';
import {
  findByCredentialId,
  registerCredential,
  updateCounter as updateCredentialCounter,
  decodePublicKey,
  type MinimalCredentialsDb,
} from '../../services/auth/webauthnCredentialStore.js';
import {
  verifyAuthenticationResponse,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';

// ───────────────────────────────────────────────────────────────────────────
// Round 20 R6 MEDIUM #2 — expectedOrigin prod fail-fast guard.
//
// In production we MUST know where the WebAuthn ceremony originates so the
// signature-verification step can reject assertions that came from a
// different origin (origin-binding is the entire point of WebAuthn). If
// neither APP_BASE_URL nor APP_URL is set at module-load time, refusing
// to start is safer than silently falling back to `http://localhost:3000`
// — that fallback would make every production verify call fail with
// `signature_invalid` and burn through user trust before anyone notices.
//
// In development the localhost fallback is fine and is preserved.
//
// We run this once at module-load, NOT per-request:
//   • Single source of truth — every /verify and /register handler reads
//     the SAME resolved origin.
//   • Process-level fail-fast — Cloud Run / PM2 / systemd see a hard
//     boot failure and surface the misconfig in the deploy log instead
//     of silently shipping a broken auth surface.
// ───────────────────────────────────────────────────────────────────────────
function resolveExpectedOriginAtBoot(): string {
  if (process.env.NODE_ENV === 'production') {
    const origin = process.env.APP_BASE_URL ?? process.env.APP_URL;
    if (!origin) {
      throw new Error(
        '[boot] FATAL: NODE_ENV=production but APP_BASE_URL/APP_URL unset. ' +
          'WebAuthn cannot determine expectedOrigin. Refusing to load.',
      );
    }
    if (origin.startsWith('http://')) {
      // Boot-time warning rather than a hard failure — some self-hosted
      // deployments terminate TLS at a sidecar and set APP_BASE_URL to
      // the upstream http URL on purpose. The signature verify path
      // still rejects mixed-scheme origins via @simplewebauthn/server.
      // eslint-disable-next-line no-console
      console.warn(
        '[webauthn] WARNING: expectedOrigin is http:// in production — verify TLS terminates upstream',
      );
    }
    return origin;
  }
  // Dev / test: localhost is fine. Tests can still override per-call by
  // mocking process.env.APP_BASE_URL before importing.
  return process.env.APP_BASE_URL ?? process.env.APP_URL ?? 'http://localhost:3000';
}

const EXPECTED_ORIGIN = resolveExpectedOriginAtBoot();
const EXPECTED_RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? 'Praeventio Guard';

// Resend client — lazily reuses RESEND_API_KEY at module-load. The same
// key powers all transactional email surfaces; constructing one client per
// router keeps each module self-contained without re-reading process.env
// on the hot path.
const resend = new Resend(process.env.RESEND_API_KEY);

// In-memory per-token resend rate limit. The global /api/ limiter applies
// too; this is the per-claim cooldown so a worker can't spam-resend a
// magic-link to the same referee. Resets on server restart — fine for
// MVP volumes (high-traffic abuse would still be caught upstream).
const curriculumResendCooldown = new Map<string, number>();
const CURRICULUM_RESEND_COOLDOWN_MS = 30_000;

/**
 * Server-side audit-log writer for curriculum events. Uses the same
 * audit_logs collection as /api/audit-log; differences:
 *   • userId is the server (we stamp 'system' if no caller uid is
 *     available — referee endpoint is unauthed).
 *   • timestamp is server-stamped via FieldValue.serverTimestamp().
 * Failures are logged but never break the main flow.
 */
export function buildCurriculumAuditor(
  callerUid: string | null,
  callerEmail: string | null,
  ipMaybe?: string,
  uaMaybe?: string,
): CurriculumAuditLogger {
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

export function buildClaimEmailHtml({
  workerName,
  refereeName,
  claimText,
  magicLink,
}: {
  workerName: string;
  refereeName: string;
  claimText: string;
  magicLink: string;
}) {
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

/**
 * Adapter that bridges the firebase-admin Firestore handle to our
 * injection-friendly MinimalChallengesDb surface. The `updateIf`
 * primitive is implemented via a transaction with a precondition
 * read-then-write so two concurrent consume() calls cannot both win.
 */
export function buildWebAuthnDb(): WebAuthnChallengesDb {
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
                data: () =>
                  snap.exists ? (snap.data() as Record<string, unknown>) : undefined,
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
                const current = snap.exists
                  ? (snap.data() as Record<string, unknown>)
                  : undefined;
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

/**
 * Round 19: adapter that bridges firebase-admin Firestore to the
 * `MinimalCredentialsDb` surface for the registered-credential store.
 * Mirrors `buildWebAuthnDb` but for the `webauthn_credentials/...`
 * collection used by the @simplewebauthn/server signature-verify path.
 */
export function buildWebAuthnCredentialsDb(): MinimalCredentialsDb {
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
                data: () =>
                  snap.exists ? (snap.data() as Record<string, unknown>) : undefined,
              };
            },
            async set(data: Record<string, unknown>) {
              await ref.set(data);
            },
            async update(patch: Record<string, unknown>) {
              await ref.update(patch);
            },
          };
        },
        where(field: string, op: '==', value: unknown) {
          const q = col.where(field, op, value);
          return {
            async get() {
              const snap = await q.get();
              return {
                empty: snap.empty,
                docs: snap.docs.map((d) => ({
                  id: d.id,
                  data: () => d.data() as Record<string, unknown>,
                })),
              };
            },
          };
        },
      };
    },
  };
}

const router = Router();

// POST /api/curriculum/claim — worker creates a claim (signed) and the
// server fires off the 2 magic-link emails to the referees.
router.post('/claim', verifyAuth, async (req, res) => {
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
    await Promise.all(
      result.refereeTokens.map(async (rawToken, idx) => {
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
          logger.error('curriculum_email_failed', {
            claimId: result.id,
            refereeIndex: idx,
            message: (emailErr as any)?.message,
          });
        }
      }),
    );

    res.json({ success: true, claimId: result.id });
  } catch (error: any) {
    const message = error?.message || 'Internal server error';
    // Validation-style errors thrown by the service map to 400.
    if (/required|invalid|exactly 2|distinct|500/i.test(message)) {
      return res.status(400).json({ error: message });
    }
    logger.error('curriculum_claim_create_failed', { uid: callerUid, message });
    res.status(500).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : message,
    });
  }
});

// GET /api/curriculum/claims — list claims for the authenticated worker.
router.get('/claims', verifyAuth, async (req, res) => {
  const callerUid = (req as any).user.uid;
  try {
    const claims = await curriculumGetByWorker(callerUid, admin.firestore() as any);
    res.json({ success: true, claims });
  } catch (error: any) {
    logger.error('curriculum_claims_list_failed', { uid: callerUid, message: error?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/curriculum/claim/:id/resend — re-email the magic link to one
// of the still-pending referees. Rate-limited per (claimId,refereeIndex).
router.post('/claim/:id/resend', verifyAuth, async (req, res) => {
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
    const updatedReferees = claim.referees.map((r: any, i: number) =>
      i === refereeIndex ? { ...r, tokenHash: newHash } : r,
    );
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
      logger.error('curriculum_resend_email_failed', {
        claimId,
        message: (emailErr as any)?.message,
      });
    }
    res.json({ success: true });
  } catch (error: any) {
    logger.error('curriculum_resend_failed', { uid: callerUid, message: error?.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/curriculum/referee/:token — public preview for the magic-link
// landing page. Returns minimal claim metadata if the token matches.
router.get('/referee/:token', refereeLimiter, async (req, res) => {
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
    const all = await admin
      .firestore()
      .collection('curriculum_claims')
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
    if (
      new Date(matchedClaim.expiresAt).getTime() < Date.now() &&
      matchedClaim.status === 'pending_referees'
    ) {
      // Lazy expire on read.
      await admin
        .firestore()
        .collection('curriculum_claims')
        .doc(matchedClaim.id)
        .update({ status: 'expired' });
      matchedClaim.status = 'expired';
    }
    const slot = matchedClaim.referees[matchedIdx];
    let workerName = matchedClaim.workerEmail || 'Trabajador Praeventio';
    try {
      const wr = await admin.auth().getUser(matchedClaim.workerId);
      workerName = wr.displayName || wr.email || workerName;
    } catch {
      /* worker may have been deleted; fall back to email */
    }
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
router.post('/referee/:token', refereeLimiter, async (req, res) => {
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
    const all = await admin
      .firestore()
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
    if (!claimId) return res.status(404).json({ error: 'token does not match any pending claim' });

    if (action === 'decline') {
      // Decline path: mark slot.declined = true and flip claim to rejected.
      const ref = admin.firestore().collection('curriculum_claims').doc(claimId);
      const snap = await ref.get();
      const data = snap.data() as any;
      const idx = data.referees.findIndex((r: any) => r.tokenHash === tokenHash);
      const updatedReferees = data.referees.map((r: any, i: number) =>
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
      await ref.update({ referees: updatedReferees, status: 'rejected' });
      const audit = buildCurriculumAuditor(
        null,
        null,
        req.ip ?? undefined,
        req.header('user-agent') ?? undefined,
      );
      await audit('curriculum.referee.declined', {
        claimId,
        refereeEmail: data.referees[idx].email,
      });
      return res.json({ success: true, verified: false, declined: true });
    }

    // Cosign path: delegate to the service.
    const audit = buildCurriculumAuditor(
      null,
      null,
      req.ip ?? undefined,
      req.header('user-agent') ?? undefined,
    );
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

export default router;

// ───────────────────────────────────────────────────────────────────────────
// WebAuthn challenge router — separate mount because the URL lives at
// /api/auth/webauthn/challenge (NOT /api/curriculum/...). Co-located here
// because the curriculum cosign flow consumes the same challenge surface
// and shares the buildWebAuthnDb adapter.
// ───────────────────────────────────────────────────────────────────────────
export const webauthnChallengeRouter = Router();

webauthnChallengeRouter.get('/webauthn/challenge', verifyAuth, async (req, res) => {
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
    logger.error('webauthn_challenge_issue_failed', {
      uid: callerUid,
      message: error?.message,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/webauthn/verify — consume the server-issued challenge
// AND verify the WebAuthn assertion's signature against the user's
// registered public key.
//
// History:
//   • R17 R5  — server-issued challenge cache + consume helper.
//   • R18 R6  — the /verify endpoint (consume-only, fail-closed).
//   • R19 A5  — @simplewebauthn/server signature verification +
//               replay-prevention via authenticator counter.
//
// Body shape:
//   • Legacy MVP (R18 backwards-compat):
//       { challengeId, clientDataJSON, authenticatorData, signature }
//     Consume-only path. Kept so already-deployed clients keep working
//     during the rollout window. Will be removed once all clients send
//     the credential id field.
//   • R19 full WebAuthn path:
//       { challengeId, id, rawId?, clientDataJSON, authenticatorData,
//         signature, type? }
//     `id` is the WebAuthn credential id (base64url) the authenticator
//     returned. Triggers full @simplewebauthn/server verification +
//     monotonic-counter replay-prevention.
//
// Replay-prevention layers (defense-in-depth):
//   1. The server-issued challenge is single-use (R17/R18). A captured
//      assertion replays AT MOST ONCE before the challenge cache rejects
//      it.
//   2. The authenticator counter (R19) — every successful assertion
//      includes a monotonic counter. If the new counter is ≤ stored, the
//      assertion is treated as a clone/replay attempt and rejected.
//
// TODO Round 20+: implement POST /api/auth/webauthn/register which
// finalizes a WebAuthn create() ceremony and stores the public key via
// `registerCredential()`. For MVP the credentials are seeded manually
// via the Firebase Admin SDK / a one-shot script. The /verify endpoint
// fails 401 with reason='unknown_credential' until a credential is
// registered for the asserting `id`.
//
// R19 R6 hardening: `webauthnVerifyLimiter` (5/min/uid) is mounted AFTER
// verifyAuth so its keyGenerator can read `req.user.uid`. Caps brute-force
// churn even if a Bearer token is compromised — the single-use challenge
// + counter-replay layers stay the cryptographic line of defense, this is
// just a request-rate ceiling.
webauthnChallengeRouter.post('/webauthn/verify', verifyAuth, webauthnVerifyLimiter, async (req, res) => {
  const callerUid = (req as any).user.uid;
  const {
    challengeId,
    id: credentialId,
    rawId,
    clientDataJSON,
    authenticatorData,
    signature,
    type: assertionType,
  } = req.body ?? {};

  if (typeof challengeId !== 'string' || challengeId.length === 0 || challengeId.length > 256) {
    return res.status(400).json({ error: 'challengeId is required' });
  }
  if (typeof clientDataJSON !== 'string' || clientDataJSON.length === 0) {
    return res.status(400).json({ error: 'clientDataJSON is required' });
  }
  if (typeof authenticatorData !== 'string' || authenticatorData.length === 0) {
    return res.status(400).json({ error: 'authenticatorData is required' });
  }
  if (typeof signature !== 'string' || signature.length === 0) {
    return res.status(400).json({ error: 'signature is required' });
  }

  // Extract the challenge bytes from the WebAuthn clientDataJSON. The
  // browser embeds the original challenge (the one we issued at GET
  // /webauthn/challenge) as a base64url-encoded field inside this JSON
  // blob. We round-trip through base64 → JSON → base64url-decode to
  // recover the raw bytes for the consume helper.
  let providedChallenge: Uint8Array;
  let challengeB64u: string;
  try {
    const cdjStr = Buffer.from(clientDataJSON, 'base64').toString('utf8');
    const cdj = JSON.parse(cdjStr);
    challengeB64u = String(cdj.challenge ?? '');
    const b64 = challengeB64u.replace(/-/g, '+').replace(/_/g, '/');
    providedChallenge = new Uint8Array(Buffer.from(b64, 'base64'));
  } catch {
    return res.status(400).json({ error: 'malformed clientDataJSON' });
  }

  try {
    // Layer 1: atomically consume the server-issued challenge. This
    // alone closes the replay vector even before signature checking,
    // because the challenge cache is single-use.
    const result = await consumeWebAuthnChallenge(
      callerUid,
      challengeId,
      providedChallenge,
      buildWebAuthnDb(),
    );
    if (result.valid === false) {
      return res.status(401).json({ verified: false, reason: result.reason });
    }

    const audit = buildCurriculumAuditor(
      callerUid,
      (req as any).user.email ?? null,
      req.ip ?? undefined,
      req.header('user-agent') ?? undefined,
    );

    // R19 full crypto path: only triggered when the client supplies the
    // credential `id` (base64url). Without it we fall back to R18 R6
    // consume-only for backward compatibility — see body-shape comment.
    if (typeof credentialId === 'string' && credentialId.length > 0) {
      const credsDb = buildWebAuthnCredentialsDb();
      const stored = await findByCredentialId(credentialId, credsDb);
      if (!stored) {
        return res.status(401).json({ verified: false, reason: 'unknown_credential' });
      }
      if (stored.uid !== callerUid) {
        // The credential is registered, but to a different uid. Treat
        // the same as unknown to avoid leaking enumeration data.
        return res.status(401).json({ verified: false, reason: 'unknown_credential' });
      }

      // R20 R6 MEDIUM #2: read the boot-resolved values. Per-request
      // env reads are a footgun — a midnight env rotation could leave
      // partial requests pointing at a stale origin.
      const expectedOrigin = EXPECTED_ORIGIN;
      const expectedRPID = EXPECTED_RP_ID;

      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
      try {
        verification = await verifyAuthenticationResponse({
          response: {
            id: credentialId,
            rawId: typeof rawId === 'string' && rawId.length > 0 ? rawId : credentialId,
            response: {
              clientDataJSON,
              authenticatorData,
              signature,
            },
            clientExtensionResults: {},
            type: (assertionType as 'public-key') ?? 'public-key',
          },
          expectedChallenge: challengeB64u,
          expectedOrigin,
          expectedRPID,
          credential: {
            id: stored.credential.credentialId,
            publicKey: decodePublicKey(stored.credential.publicKey),
            counter: stored.credential.counter,
            transports: stored.credential.transports as
              | ('ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb')[]
              | undefined,
          },
          requireUserVerification: true,
        });
      } catch (verErr: any) {
        logger.warn('webauthn_verify_signature_failed', {
          uid: callerUid,
          credentialId,
          message: verErr?.message,
        });
        return res.status(401).json({ verified: false, reason: 'signature_invalid' });
      }

      if (!verification.verified) {
        return res.status(401).json({ verified: false, reason: 'signature_invalid' });
      }

      const newCounter = verification.authenticationInfo.newCounter;
      // Replay-prevention: the authenticator counter MUST monotonically
      // increase. A non-increase indicates the assertion was cloned,
      // even if the signature checks out. (Counter==0 is allowed for
      // authenticators that don't track it — we only enforce the rule
      // when the stored counter is > 0.)
      if (stored.credential.counter > 0 && newCounter <= stored.credential.counter) {
        return res.status(401).json({ verified: false, reason: 'counter_replay' });
      }
      await updateCredentialCounter(credentialId, newCounter, credsDb);

      // Audit: uid + counter only. Never the assertion bytes —
      // clientDataJSON, authenticatorData, and signature are credentials
      // and must not land in the append-only audit_logs collection.
      await audit('auth.webauthn.verified', {
        uid: callerUid,
        credentialId,
        newCounter,
      });

      return res.json({ verified: true, uid: callerUid, newCounter });
    }

    // Legacy R18 R6 consume-only path. Same audit shape (uid only).
    await audit('auth.webauthn.verified', { uid: callerUid });
    return res.json({ verified: true, uid: callerUid });
  } catch (error: any) {
    logger.error('webauthn_verify_failed', {
      uid: callerUid,
      message: error?.message,
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Round 20 R5 — WebAuthn registration ceremony.
//
// Closes the TODO left in R19 (`webauthnCredentialStore.ts`): until now
// credentials had to be seeded manually via the Firebase Admin SDK. The
// two endpoints below let an authenticated worker enroll a new
// authenticator (Touch ID / Face ID / security key) in-app.
//
//   POST /api/auth/webauthn/register/options
//     verifyAuth + webauthnRegisterLimiter (3/min/uid).
//     Issues a registration challenge via @simplewebauthn/server's
//     `generateRegistrationOptions()` and persists it in the same
//     `webauthn_challenges` cache as the authentication ceremony so the
//     /verify counterpart can atomically consume it.
//
//   POST /api/auth/webauthn/register/verify
//     verifyAuth + webauthnRegisterLimiter (3/min/uid).
//     Validates the attestation via `verifyRegistrationResponse()` and
//     persists the resulting public key + counter via the
//     R19-shipped `registerCredential()` service. Idempotent: a
//     re-registration of the same credentialId replaces the prior row
//     (matches the registerCredential contract).
//
// Audit shape (auth.webauthn.registered): uid + credentialId only. NEVER
// the public-key bytes — they're public, but the audit collection is
// append-only and we keep it minimal as a hygiene baseline.
// ───────────────────────────────────────────────────────────────────────────

webauthnChallengeRouter.post(
  '/webauthn/register/options',
  verifyAuth,
  webauthnRegisterLimiter,
  async (req, res) => {
    const callerUid = (req as any).user.uid;
    const callerEmail: string | null = (req as any).user.email ?? null;
    try {
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: EXPECTED_RP_ID,
        userName: callerEmail ?? callerUid,
        userDisplayName: callerEmail ?? 'Praeventio Worker',
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
      });

      // Persist the challenge so /register/verify can atomically consume it.
      // `options.challenge` is a base64url string. We round-trip through
      // bytes to match the existing storage shape and re-use the
      // base64url challenge as the challengeId so the verify endpoint
      // can recover the bytes without a side table.
      const challengeBytes = new Uint8Array(
        Buffer.from(
          options.challenge.replace(/-/g, '+').replace(/_/g, '/'),
          'base64',
        ),
      );
      const challengeId = options.challenge;
      await storeWebAuthnChallenge(
        callerUid,
        challengeId,
        challengeBytes,
        buildWebAuthnDb(),
      );

      return res.json({ challengeId, options });
    } catch (error: any) {
      logger.error('webauthn_register_options_failed', {
        uid: callerUid,
        message: error?.message,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);

webauthnChallengeRouter.post(
  '/webauthn/register/verify',
  verifyAuth,
  webauthnRegisterLimiter,
  async (req, res) => {
    const callerUid = (req as any).user.uid;
    const { challengeId, attestationResponse } = req.body ?? {};

    if (typeof challengeId !== 'string' || challengeId.length === 0 || challengeId.length > 1024) {
      return res.status(400).json({ error: 'challengeId is required' });
    }
    if (
      !attestationResponse ||
      typeof attestationResponse !== 'object' ||
      typeof (attestationResponse as any).id !== 'string'
    ) {
      return res.status(400).json({ error: 'attestationResponse is required' });
    }

    // Decode the original challenge bytes from the stored challenge id
    // (which IS the base64url challenge string written at /options).
    let providedChallenge: Uint8Array;
    try {
      const b64 = challengeId.replace(/-/g, '+').replace(/_/g, '/');
      providedChallenge = new Uint8Array(Buffer.from(b64, 'base64'));
    } catch {
      return res.status(400).json({ error: 'malformed challengeId' });
    }

    try {
      // Atomically consume the challenge BEFORE running the expensive
      // CBOR-decode. A captured /register/verify body cannot be replayed
      // — the second submission will hit reason='consumed'.
      const consumeResult = await consumeWebAuthnChallenge(
        callerUid,
        challengeId,
        providedChallenge,
        buildWebAuthnDb(),
      );
      if (consumeResult.valid === false) {
        return res
          .status(401)
          .json({ verified: false, reason: consumeResult.reason });
      }

      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
      try {
        verification = await verifyRegistrationResponse({
          response: attestationResponse,
          expectedChallenge: challengeId,
          expectedOrigin: EXPECTED_ORIGIN,
          expectedRPID: EXPECTED_RP_ID,
          requireUserVerification: true,
        });
      } catch (verErr: any) {
        logger.warn('webauthn_register_attestation_failed', {
          uid: callerUid,
          message: verErr?.message,
        });
        return res
          .status(401)
          .json({ verified: false, reason: 'attestation_invalid' });
      }

      if (!verification.verified || !verification.registrationInfo) {
        return res
          .status(401)
          .json({ verified: false, reason: 'attestation_invalid' });
      }

      const { credential, credentialDeviceType, credentialBackedUp } =
        verification.registrationInfo;
      const credentialIdStr = credential.id;
      const publicKeyBytes =
        credential.publicKey instanceof Uint8Array
          ? credential.publicKey
          : new Uint8Array(credential.publicKey as ArrayBuffer);

      await registerCredential(
        callerUid,
        {
          credentialId: credentialIdStr,
          publicKey: publicKeyBytes,
          counter: credential.counter,
          transports: credential.transports as string[] | undefined,
        },
        buildWebAuthnCredentialsDb(),
      );

      const audit = buildCurriculumAuditor(
        callerUid,
        (req as any).user.email ?? null,
        req.ip ?? undefined,
        req.header('user-agent') ?? undefined,
      );
      // Audit: uid + credentialId only. NEVER the public-key bytes.
      await audit('auth.webauthn.registered', {
        uid: callerUid,
        credentialId: credentialIdStr,
      });

      return res.json({
        verified: true,
        credentialId: credentialIdStr,
        // Surface the device-type metadata so the UI can show "this
        // is a passkey synced across your iCloud/Google account" vs
        // "this lives only on this hardware key".
        credentialDeviceType,
        credentialBackedUp,
      });
    } catch (error: any) {
      logger.error('webauthn_register_verify_failed', {
        uid: callerUid,
        message: error?.message,
      });
      return res.status(500).json({ error: 'Internal server error' });
    }
  },
);
