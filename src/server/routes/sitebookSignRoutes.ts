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

import { Router, type Request, type Response } from 'express';
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
import type { SiteBookEntry } from '../../services/siteBook/siteBookService.js';
import { verifyWebAuthnAssertion } from '../auth/webauthnAssertion.js';
import { logger } from '../../utils/logger.js';

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
  const ref = fs.collection('projects').doc(projectId).collection('site_book_entries').doc(entryId);
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
    .collection('site_book_entries')
    .doc(entry.id);
  await ref.set(entry, { merge: true });
}

export const sitebookSignRouter = Router();

sitebookSignRouter.post('/sign/options', verifyAuth, async (req: Request, res: Response) => {
  const callerUid = req.user!.uid;
  const { entryId, projectId, payloadHashHex } = req.body ?? {};
  if (typeof entryId !== 'string' || typeof projectId !== 'string' || typeof payloadHashHex !== 'string') {
    return res.status(400).json({ error: 'entryId, projectId, payloadHashHex required' });
  }
  try {
    const deps: SignOptionsDeps = {
      challengesDb: buildWebAuthnDb(),
      credentialsDb: buildWebAuthnCredentialsDb(),
      loadEntry: loadSiteBookEntry,
      rpId: process.env.WEBAUTHN_RPID ?? 'app.praeventio.net',
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

sitebookSignRouter.post('/sign/verify', verifyAuth, async (req: Request, res: Response) => {
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
  try {
    const deps: SignVerifyDeps = {
      challengesDb: buildWebAuthnDb(),
      credentialsDb: buildWebAuthnCredentialsDb(),
      loadEntry: loadSiteBookEntry,
      saveSignedEntry: saveSignedSiteBookEntry,
      verifyAssertion: verifyWebAuthnAssertion,
      expectedOrigin:
        process.env.WEBAUTHN_ORIGIN ?? 'https://app.praeventio.net',
      expectedRpId: process.env.WEBAUTHN_RPID ?? 'app.praeventio.net',
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
    return res.json(result.value);
  } catch (err) {
    logger.error('sitebook_sign_verify_failed', { uid: callerUid, err: String(err) });
    return res.status(500).json({ error: 'internal' });
  }
});
