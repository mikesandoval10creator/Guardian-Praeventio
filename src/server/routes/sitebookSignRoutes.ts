// SPDX-License-Identifier: MIT
// Praeventio Guard — Plan 2026-05-24 §D.X — Express mounting for
// SiteBook WebAuthn signing.
//
// Esta capa es PURAMENTE adaptación: convierte requests Express en
// llamadas a los handlers DI'd de `sitebookSign.ts` (que viven aislados
// de Express + Firestore + @simplewebauthn). La cobertura unit-test ya
// vive en `sitebookSign.test.ts`; este file solo aplica un wire.
//
// Endpoints:
//   POST /api/sitebook/sign/options   — issues a challenge bound to the entry
//   POST /api/sitebook/sign/verify    — verifies + persists the signature
//
// Ambos endpoints requieren verifyAuth (uid de Firebase) y leen el body
// JSON parseado por la middleware global. La verificación criptográfica
// real se delega a `verifyWebAuthnAssertion` de webauthnAssertion.ts.

import { Router, type Request, type Response, type NextFunction } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  buildWebAuthnDb,
  buildWebAuthnCredentialsDb,
} from './curriculum.js';
import {
  handleSignOptionsRequest,
  handleSignVerifyRequest,
  type SignErrorReason,
  type SignOptionsDeps,
  type SignVerifyDeps,
} from './sitebookSign.js';
import { SITE_BOOK_COLLECTION, type SiteBookEntry } from '../../services/siteBook/siteBookService.js';
import { verifyWebAuthnAssertion } from '../auth/webauthnAssertion.js';
import {
  assertProjectMember,
  ProjectMembershipError,
} from '../../services/auth/projectMembership.js';
import { logger } from '../../utils/logger.js';
import { auditServerEvent } from '../middleware/auditLog.js';

/**
 * P0 security fix: previously this file read `process.env.WEBAUTHN_RPID`
 * (missing underscore) with a hardcoded `'app.praeventio.net'` fallback. The
 * typo silently masked the bug in production — every assertion verified
 * against `app.praeventio.net` regardless of what the env said. The rest of
 * the codebase (curriculum.ts, suseso.ts) reads the correct
 * `WEBAUTHN_RP_ID`. This helper aligns sitebook with that contract.
 *
 * Codex P2 3308579656: the previous "throw in production" version broke
 * worker signing at runtime if ops forgot to set the env (deploy passed
 * validate-env.cjs because the variable isn't in the prod contract yet,
 * then 500'd on first signature attempt). We keep the legitimate
 * production domain `app.praeventio.net` as the safe fallback and log a
 * warning so ops sees the missing env var in observability — signing
 * keeps working with the actual prod RP ID either way.
 */
function getWebAuthnRpId(): string {
  const value = process.env.WEBAUTHN_RP_ID;
  if (value && value.length > 0) return value;
  if (process.env.NODE_ENV === 'production') {
    logger.warn('webauthn_rp_id_using_fallback', {
      fallback: 'app.praeventio.net',
      hint: 'Set WEBAUTHN_RP_ID in Secret Manager + Cloud Run env for explicit config',
    });
    return 'app.praeventio.net';
  }
  return 'localhost';
}

// Status codes — map handler error reasons to HTTP semantics.
const STATUS_FOR_REASON: Record<SignErrorReason, number> = {
  invalid_hash_format: 400,
  malformed_client_data: 400,
  missing_field: 400,
  not_found: 404,
  hash_mismatch: 409, // payload hash drift = potential tamper
  already_signed: 409,
  no_credentials: 412, // precondition (registrar primero)
  challenge_not_found: 401,
  challenge_expired: 401,
  challenge_invalid: 401,
  challenge_mismatch: 401,
  signature_invalid: 401,
  unknown_credential: 401,
  credential_owned_by_other_uid: 403,
  counter_not_monotonic: 401,
};

/**
 * Loader Firestore Admin → SiteBookEntry. El path canónico es
 * `projects/{projectId}/site_book_entries/{entryId}`.
 */
async function loadSiteBookEntry(
  projectId: string,
  entryId: string,
): Promise<SiteBookEntry | null> {
  const fs = admin.firestore();
  const ref = fs.collection('projects').doc(projectId).collection(SITE_BOOK_COLLECTION).doc(entryId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data() as SiteBookEntry;
}

async function saveSignedSiteBookEntry(
  projectId: string,
  entry: SiteBookEntry,
): Promise<void> {
  const fs = admin.firestore();
  const ref = fs
    .collection('projects')
    .doc(projectId)
    .collection(SITE_BOOK_COLLECTION)
    .doc(entry.id);
  await ref.set(entry, { merge: true });
}

export const sitebookSignRouter = Router();

sitebookSignRouter.post('/sign/options', verifyAuth, async (req: Request, res: Response, next: NextFunction) => {
  const callerUid = req.user!.uid;
  const { entryId, projectId, payloadHashHex } = req.body ?? {};
  if (typeof entryId !== 'string' || typeof projectId !== 'string' || typeof payloadHashHex !== 'string') {
    return res.status(400).json({ error: 'entryId, projectId, payloadHashHex required' });
  }
  // P0 IDOR fix: projectId/entryId come from the client body. The Admin SDK in
  // loadSiteBookEntry/saveSignedSiteBookEntry BYPASSES Firestore rules, so we
  // MUST re-enforce the tenant boundary here (CLAUDE.md #6) — exactly as the
  // sibling sitebook.ts read/create routes do. Without this, any worker from
  // any tenant could issue a challenge for (and then sign) another tenant's
  // legal site-book entry. Runs before any entry read so a non-member learns
  // nothing about the entry. (decodedToken intentionally omitted: verifyAuth
  // strips assignedSiteIds from req.user, so the Firestore project doc is the
  // authoritative membership source for the signing surface.)
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      // Audit the blocked cross-tenant probe — highest-sensitivity legal
      // endpoint; security needs a forensic trace of denied attempts.
      await auditServerEvent(req, 'sitebookSign.idor_blocked', 'sitebookSign', { projectId, entryId }, { projectId });
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    // Infra failure (e.g. Firestore outage): forward to the terminal error
    // handler. Express 4 does NOT catch a bare `throw` from an async route, so
    // a re-throw would become an unhandled rejection (process crash) — use next().
    return next(err);
  }
  try {
    const deps: SignOptionsDeps = {
      challengesDb: buildWebAuthnDb(),
      credentialsDb: buildWebAuthnCredentialsDb(),
      loadEntry: loadSiteBookEntry,
      rpId: getWebAuthnRpId(),
    };
    const result = await handleSignOptionsRequest(
      { uid: callerUid, entryId, projectId, payloadHashHex },
      deps,
    );
    if (result.kind === 'error') {
      const status = STATUS_FOR_REASON[result.reason] ?? 400;
      return res.status(status).json({ error: result.reason });
    }
    return res.json(result.value);
  } catch (err) {
    logger.error('sitebook_sign_options_failed', { uid: callerUid, err: String(err) });
    return res.status(500).json({ error: 'internal' });
  }
});

sitebookSignRouter.post('/sign/verify', verifyAuth, async (req: Request, res: Response, next: NextFunction) => {
  const callerUid = req.user!.uid;
  const { entryId, projectId, payloadHashHex, challengeId, assertion } = req.body ?? {};
  if (
    typeof entryId !== 'string' ||
    typeof projectId !== 'string' ||
    typeof payloadHashHex !== 'string' ||
    typeof challengeId !== 'string' ||
    typeof assertion !== 'object' ||
    assertion === null
  ) {
    return res.status(400).json({ error: 'malformed_body' });
  }
  // P0 IDOR fix (see /sign/options): re-enforce the project-membership
  // boundary before verifying/persisting — the Admin SDK in
  // loadSiteBookEntry/saveSignedSiteBookEntry bypasses Firestore rules.
  // Without this, a worker from another tenant could apply their own
  // biometric signature to (and lock) this tenant's legal site-book entry.
  try {
    await assertProjectMember(callerUid, projectId, admin.firestore());
  } catch (err) {
    if (err instanceof ProjectMembershipError) {
      await auditServerEvent(req, 'sitebookSign.idor_blocked', 'sitebookSign', { projectId, entryId }, { projectId });
      return res.status(err.httpStatus).json({ error: 'forbidden' });
    }
    return next(err); // infra error → terminal handler (Express 4 won't catch a bare throw)
  }
  try {
    const deps: SignVerifyDeps = {
      challengesDb: buildWebAuthnDb(),
      credentialsDb: buildWebAuthnCredentialsDb(),
      loadEntry: loadSiteBookEntry,
      saveSignedEntry: saveSignedSiteBookEntry,
      verifyAssertion: verifyWebAuthnAssertion,
      expectedOrigin:
        process.env.WEBAUTHN_ORIGIN ?? 'https://app.praeventio.net',
      expectedRpId: getWebAuthnRpId(),
      now: () => new Date(),
    };
    const result = await handleSignVerifyRequest(
      {
        uid: callerUid,
        entryId,
        projectId,
        payloadHashHex,
        challengeId,
        assertion,
      },
      deps,
    );
    if (result.kind === 'error') {
      const status = STATUS_FOR_REASON[result.reason] ?? 400;
      return res.status(status).json({ verified: false, reason: result.reason });
    }
    await auditServerEvent(req, 'sitebookSign.verify', 'sitebookSign', { projectId, entryId }, { projectId });
    return res.json(result.value);
  } catch (err) {
    logger.error('sitebook_sign_verify_failed', { uid: callerUid, err: String(err) });
    return res.status(500).json({ error: 'internal' });
  }
});
