// Praeventio Guard — Sprint 23 Bucket GG + Sprint 34 biometric DTE.
//
// IMPORTANT (regla de producto inviolable):
//   Praeventio NO push a SII. La empresa cliente imprime/firma/envía.
//   Ver memoria producto product_signing_no_blocking_directives_2026-05-06.
//
// Admin DTE endpoints. Wraps the Bsale adapter so an operator can:
//   • POST /api/dte/create  — emit a manual DTE outside the auto-pipeline.
//   • GET  /api/dte/:folio  — fetch the live status from Bsale.
//   • POST /api/dte/:folio/cancel — issue a Nota de Crédito to cancel a folio.
//
// Sprint 34 additions (biometric, no-push):
//   • POST /api/dte/generate — build a SII-canonical DTE XML, sign it with
//     a WebAuthn passkey (FaceID / Android Biometric / Google login
//     fingerprint), render PDF. Returns { xml, pdfBase64, dteId, signedAt }.
//     Does NOT push to SII; caller (frontend) downloads the artefacts and
//     the empresa cliente prints/signs/submits via its own channel.
//
// Auto-emission on `invoice.status === 'paid'` lives in
// `src/services/billing/invoice.ts:tryAutoIssueDte`. This route is the
// admin / fallback surface — never exposed to the SPA without an admin role.
//
// Mounted in server.ts at `/api/dte`. Final paths preserved verbatim.

import { Router, type Request, type Response } from 'express';
import admin from 'firebase-admin';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { getWebauthnRpId } from '../auth/rpId.js';
import { idempotencyKey } from '../middleware/idempotencyKey.js';
import { isAdminRole } from '../../types/roles.js';
import { logger } from '../../utils/logger.js';
import { BsaleAdapter, type DteCreateInput } from '../../services/sii/bsaleAdapter.js';
// Sprint 36 audit P1 §1.4 — DTE generator/signer/PDF renderer are lazy-
// imported so Cloud Run cold-start doesn't pay the xmlbuilder2/pdfkit
// parse cost for every container; only the first POST /generate pays
// the ~50-100ms once-per-process import. The endpoint is admin-only and
// rarely called, so this is a clear win versus eager imports that block
// the entire `/api/*` surface during boot. Resolves the size-limit
// creep companion (server-side counterpart to client lazy-cert-pdf).
type DteGeneratorModule = typeof import('../../services/sii/dteGenerator.js');
type DteSignerModule = typeof import('../../services/sii/dteSigner.js');
type DtePdfRendererModule = typeof import('../../services/sii/dtePdfRenderer.js');
const generateDte = async (
  ...args: Parameters<DteGeneratorModule['generateDte']>
): Promise<ReturnType<DteGeneratorModule['generateDte']>> => {
  const m = await import('../../services/sii/dteGenerator.js');
  return m.generateDte(...args);
};
const verifyAndSignDte = async (
  ...args: Parameters<DteSignerModule['verifyAndSignDte']>
): Promise<Awaited<ReturnType<DteSignerModule['verifyAndSignDte']>>> => {
  const m = await import('../../services/sii/dteSigner.js');
  return m.verifyAndSignDte(...args);
};
const renderDtePdf = async (
  ...args: Parameters<DtePdfRendererModule['renderDtePdf']>
): Promise<Awaited<ReturnType<DtePdfRendererModule['renderDtePdf']>>> => {
  const m = await import('../../services/sii/dtePdfRenderer.js');
  return m.renderDtePdf(...args);
};
import { buildWebAuthnCredentialsDb } from './curriculum.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { getErrorTracker } from '../../services/observability/index.js';
import { tracedAsync } from '../../services/observability/tracing.js';

function dteSentryCapture(
  err: unknown,
  context: { endpoint: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as any,
    );
  } catch (e) {
    console.warn('[observability] dte capture failed', e);
  }
}

export const dteRouter = Router();

/** Small helper: 403 unless caller has admin custom claim. */
async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  const uid = req.user?.uid;
  if (!uid) {
    res.status(401).json({ error: 'no_uid' });
    return false;
  }
  try {
    const callerRecord = await admin.auth().getUser(uid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      res.status(403).json({ error: 'admin_required' });
      return false;
    }
    return true;
  } catch (err) {
    logger.error('dte.requireAdmin getUser failed', err instanceof Error ? err : new Error(String(err)));
    res.status(500).json({ error: 'auth_lookup_failed' });
    return false;
  }
}

/**
 * [Hy3-audit] Admin-only check that does NOT write to `res`. Callers
 * decide the response shape — anti-enumeration wants a 404, not 403.
 * Returns false on lookup failure so the caller never reveals that the
 * underlying admin lookup is the reason for the rejection.
 */
async function isCallerDteAdmin(req: Request): Promise<boolean> {
  const uid = req.user?.uid;
  if (!uid) return false;
  try {
    const callerRecord = await admin.auth().getUser(uid);
    return isAdminRole(callerRecord.customClaims?.role);
  } catch (err) {
    logger.error('dte.isCallerDteAdmin getUser failed', err instanceof Error ? err : new Error(String(err)));
    return false;
  }
}

/** Resolve the Bsale adapter, returning null + 503 when env isn't configured. */
function resolveBsale(res: Response): BsaleAdapter | null {
  const adapter = BsaleAdapter.fromEnv();
  if (!adapter) {
    res.status(503).json({
      error: 'dte_not_configured',
      message: 'Set BSALE_ACCESS_TOKEN and BSALE_OFFICE_ID to enable DTE emission.',
    });
    return null;
  }
  return adapter;
}

const VALID_DTE_TYPES = [
  'factura_electronica',
  'boleta_electronica',
  'boleta_exenta',
  'nota_credito',
  'nota_debito',
] as const;

function isValidDteCreateInput(body: unknown): body is DteCreateInput {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (!VALID_DTE_TYPES.includes(b.type as (typeof VALID_DTE_TYPES)[number])) return false;
  if (!b.customer || typeof b.customer !== 'object') return false;
  const c = b.customer as Record<string, unknown>;
  if (typeof c.rut !== 'string' || c.rut.length === 0) return false;
  if (typeof c.razonSocial !== 'string' || c.razonSocial.length === 0) return false;
  if (typeof c.direccion !== 'string') return false;
  if (typeof c.comuna !== 'string') return false;
  if (typeof c.ciudad !== 'string') return false;
  if (!Array.isArray(b.items) || b.items.length === 0) return false;
  for (const it of b.items as unknown[]) {
    if (!it || typeof it !== 'object') return false;
    const i = it as Record<string, unknown>;
    if (typeof i.description !== 'string' || i.description.length === 0) return false;
    if (typeof i.quantity !== 'number' || i.quantity <= 0) return false;
    if (typeof i.unitPriceClp !== 'number' || i.unitPriceClp < 0) return false;
    if (typeof i.taxable !== 'boolean') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// POST /api/dte/create  — admin-only manual DTE emission.
// ---------------------------------------------------------------------------
dteRouter.post('/create', verifyAuth, idempotencyKey(), async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return undefined;
  const adapter = resolveBsale(res);
  if (!adapter) return undefined;
  if (!isValidDteCreateInput(req.body)) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  try {
    const uid = req.user?.uid;
    const result = await tracedAsync(
      'dte.create.handler',
      { 'praeventio.uid': uid, docType: (req.body as any)?.tipoDocumento ?? null },
      () => adapter.createDte(req.body),
    );
    if (!result.ok) {
      // [Hy3-audit] Audit the REJECTED attempt. Resolves [Audit-2026-08-31]
      // DTE manual create/cancel — cambios tributarios no escriben
      // auditServerEvent. A regulator must see WHO tried to issue what,
      // even when Bsale refused.
      await auditServerEvent(req, 'dte.manual_create_rejected', 'dte', {
        tipoDocumento: (req.body as any)?.tipoDocumento ?? null,
        motivo: result.errorMessage ?? 'unknown',
      });
      return res.status(422).json({
        error: 'dte_rejected',
        message: result.errorMessage,
      });
    }
    // [Hy3-audit] Audit the SUCCESS path: actor + folio + tipodoc + tracking
    // id so a SII/Hacienda audit can reconstruct the operator, the moment,
    // and the Bsale receipt for any DTE that hit the books.
    await auditServerEvent(req, 'dte.manual_create', 'dte', {
      folio: result.folio,
      tipoDocumento: (req.body as any)?.tipoDocumento ?? null,
      trackingId: result.trackingId,
      totalClp: result.totalClp,
      ivaClp: result.ivaClp,
    });
    return res.json({
      ok: true,
      folio: result.folio,
      pdfUrl: result.pdfUrl,
      xmlUrl: result.xmlUrl,
      trackingId: result.trackingId,
      totalClp: result.totalClp,
      ivaClp: result.ivaClp,
    });
  } catch (err) {
    logger.error('POST /api/dte/create failed', err instanceof Error ? err : new Error(String(err)));
    // [Hy3-audit] Audit even unexpected exceptions: failure paths must
    // leave a paper trail too.
    await auditServerEvent(req, 'dte.manual_create_failed', 'dte', {
      tipoDocumento: (req.body as any)?.tipoDocumento ?? null,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'dte_emission_failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dte/sign-challenge  — F4 (Sprint 5): issue a single-use WebAuthn
// challenge so an admin can biometrically sign a DTE. The client runs
// navigator.credentials.get() with this challenge, then POSTs /generate with
// the assertion + challengeId. Admin-only (signing is an admin/fallback
// surface). Mirrors suseso.ts GET /form/:id/sign-challenge.
//
// MUST be declared BEFORE `GET /:folio` — otherwise Express routes
// `/sign-challenge` into the `:folio` param handler (folio === 'sign-challenge').
// ---------------------------------------------------------------------------
dteRouter.get('/sign-challenge', verifyAuth, async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return undefined;
  const callerUid = req.user?.uid as string;
  // [Audit-2026-08-31] The WebAuthn challenge MUST be bound to the dteHash
  // the caller is about to sign. Without this binding, an admin could call
  // GET /sign-challenge (any challenge), then POST /generate presenting a
  // different DTE — the verifier would accept because the challenge is
  // dteHash-blind. The binding is the only thing that ties the WebAuthn
  // attestation to the specific XML that ends up signed.
  const dteHash =
    typeof req.query.dteHash === 'string' && /^[0-9a-f]{64}$/.test(req.query.dteHash)
      ? req.query.dteHash
      : null;
  if (!dteHash) {
    return res.status(400).json({
      error: 'dteHash_required',
      reason: 'dteHash must be a 64-char hex string (sha256 of the XML to sign).',
    });
  }
  try {
    const { buildSignChallenge } = await import('../../services/sii/dteSigner.js');
    const { storeWebAuthnChallenge } = await import(
      '../../services/auth/webauthnChallenge.js'
    );
    const { buildWebAuthnDb } = await import('./curriculum.js');
    // buildSignChallenge derives challenge bytes from dteHash so the
    // signature the authenticator produces is bound to that exact XML.
    const { challenge, challengeB64u } = buildSignChallenge(dteHash);
    // Synthesize a challengeId so the existing single-use store keeps
    // working unchanged — bind the dteHash into the metadata so the
    // verifier can compare it on submit.
    const challengeId = `dte_${callerUid}_${dteHash.slice(0, 16)}_${Date.now().toString(36)}`;
    // Stash the dteHash alongside the challenge so the verifier can reject
    // any submission whose generated XML hashes to a different value.
    await storeWebAuthnChallenge(
      callerUid,
      challengeId,
      challenge,
      buildWebAuthnDb(),
      { metadata: { dteHash } },
    );
    return res.json({
      challengeId,
      challenge: challengeB64u,
      challengeB64u,
      dteHash,
      rpId: getWebauthnRpId(),
      ttlSeconds: 300,
    });
  } catch (err) {
    logger.error(
      'dte.sign_challenge failed',
      err instanceof Error ? err : new Error(String(err)),
    );
    dteSentryCapture(err, {
      endpoint: 'GET /api/dte/sign-challenge',
      tags: { stage: 'challenge' },
    });
    return res.status(500).json({ error: 'dte_sign_challenge_failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dte/:folio  — fetch live status from Bsale (admin or supervisor).
// ------------------------------------------------------------------
// [Hy3-audit] DTE folio GET was reachable by any authenticated user.
// The folio is a Bsale tax-document identifier carrying pdfUrl / xmlUrl /
// trackingId — leaking it lets any logged-in worker pull another tenant's
// PDF/XML URL and tracking id. Bsale's URLs themselves are bearer URLs
// shared via headers, so exposure is a real privacy / compliance breach
// (Ley 21.719 — PII; SII — tax-document confidentiality).
//
// Fix: gate behind admin (or supervisor pending a folio→tenant lookup).
// The full owner-tenant filter requires a `folio → tenantId` index that
// the current data model does not store; documented in the ticket as a
// follow-up. Anti-enumeration: respond 404 (not 403) on reject so the
// caller cannot probe for valid folio numbers.
dteRouter.get('/:folio', verifyAuth, async (req: Request, res: Response) => {
  // [Hy3-audit] Anti-enumeration 404. We do NOT distinguish "no such folio"
  // from "you are not allowed to see this folio" \u2014 both return 404 so a
  // logged-in worker cannot probe Bsale folio numbers tenant-by-tenant.
  if (!(await isCallerDteAdmin(req))) {
    return res.status(404).json({ error: 'dte_not_found' });
  }
  const folio = req.params.folio;
  if (!folio) {
    return res.status(400).json({ error: 'folio_required' });
  }
  const adapter = resolveBsale(res);
  if (!adapter) return undefined;
  try {
    const result = await adapter.getDte(folio);
    if (!result.ok) {
      return res.status(404).json({
        error: 'dte_not_found',
        message: result.errorMessage,
      });
    }
    return res.json({
      ok: true,
      folio: result.folio,
      pdfUrl: result.pdfUrl,
      xmlUrl: result.xmlUrl,
      trackingId: result.trackingId,
    });
  } catch (err) {
    logger.error('GET /api/dte/:folio failed', err instanceof Error ? err : new Error(String(err)));
    return res.status(500).json({ error: 'dte_lookup_failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/dte/:folio/cancel  — admin-only cancellation (issues NC).
// ---------------------------------------------------------------------------
// Sprint E backend debt 2026-05-16: idempotencyKey() added. Without it,
// a flaky-network double-tap from admin could file two NC (notas de
// crédito) for the same folio — Bsale would either reject the second
// or, worse, accept it and the empresa ends up with duplicate NC.
dteRouter.post('/:folio/cancel', verifyAuth, idempotencyKey(), async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return undefined;
  const folioRaw = req.params.folio;
  const folio = Number.parseInt(folioRaw ?? '', 10);
  if (!Number.isFinite(folio) || folio <= 0) {
    return res.status(400).json({ error: 'invalid_folio' });
  }
  const reason = (req.body?.reason ?? '').toString().trim();
  if (!reason) {
    return res.status(400).json({ error: 'reason_required' });
  }
  const adapter = resolveBsale(res);
  if (!adapter) return undefined;
  try {
    const result = await adapter.cancelDte(folio, reason);
    if (!result.ok) {
      // [Hy3-audit] Audit the REJECTED cancellation attempt. Resolves
      // [Audit-2026-08-31] DTE manual create/cancel — cambios tributarios
      // no escriben auditServerEvent.
      await auditServerEvent(req, 'dte.manual_cancel_rejected', 'dte', {
        folio,
        reason,
        motivo: result.errorMessage ?? 'unknown',
      });
      return res.status(422).json({
        error: 'cancel_failed',
        message: result.errorMessage,
      });
    }
    // [Hy3-audit] Audit the SUCCESS cancellation (Nota de Crédito emitted).
    await auditServerEvent(req, 'dte.manual_cancel', 'dte', {
      folio,
      reason,
      trackingId: result.trackingId,
    });
    return res.json({ ok: true, trackingId: result.trackingId });
  } catch (err) {
    logger.error('POST /api/dte/:folio/cancel failed', err instanceof Error ? err : new Error(String(err)));
    // [Hy3-audit] Audit even unexpected exceptions.
    await auditServerEvent(req, 'dte.manual_cancel_failed', 'dte', {
      folio,
      error: err instanceof Error ? err.message : String(err),
    });
    return res.status(500).json({ error: 'dte_cancel_failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/dte/generate  — Sprint 34 biometric DTE generator (NO push to SII).
// ---------------------------------------------------------------------------
//
// Body shape (Zod-validated):
//   {
//     type: 33 | 39,
//     receptorRut: string,
//     receptorRazonSocial: string,
//     fecha: string (YYYY-MM-DD),
//     folio: positive int (CAF de la empresa cliente),
//     items: [{ description, quantity (int>0), unitPrice (int>=0), exemptFromIva? }, â€¦],
//     biometric?: {
//       credentialId: string,
//       signature: string (b64),
//       authenticatorData: string (b64),
//       clientDataJSON: string (b64),
//     }
//   }
//
// If `biometric` is omitted, we return the unsigned XML + PDF (caller can
// later POST again with the WebAuthn assertion to attach the signature).
// If present, we verify the assertion against the registered passkey and
// embed the XMLDSIG-shaped signature block.
//
// Response: { xml, pdfBase64, dteId, signedAt? }
// Audit: action 'dte.generated' (always), 'dte.signed' (when biometric).
const generateDteSchema = z.object({
  type: z.union([z.literal(33), z.literal(39)]),
  receptorRut: z.string().min(1).max(32),
  receptorRazonSocial: z.string().min(1).max(256),
  receptorDireccion: z.string().max(256).optional(),
  receptorComuna: z.string().max(128).optional(),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  folio: z.number().int().positive(),
  items: z
    .array(
      z.object({
        description: z.string().min(1).max(512),
        quantity: z.number().int().positive(),
        unitPrice: z.number().int().nonnegative(),
        exemptFromIva: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
  biometric: z
    .object({
      credentialId: z.string().min(1).max(512),
      // rawId is usually identical to credentialId but the WebAuthn spec
      // sends it separately; verifyAuthenticationResponse needs both.
      rawId: z.string().min(1).max(512),
      signature: z.string().min(1),
      authenticatorData: z.string().min(1),
      clientDataJSON: z.string().min(1),
      // challengeId returned by GET /api/dte/sign-challenge — binds this
      // assertion to a single-use server-issued challenge (replay defense).
      challengeId: z.string().min(1).max(256),
      type: z.literal('public-key'),
      clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
    })
    .optional(),
});

// Sprint E backend debt 2026-05-16: idempotencyKey() added. Without it,
// retrying a generate request (same folio + caller) would consume
// another CAF folio on the second attempt and we'd burn folios on the
// empresa cliente. With the key, the second request replays the first
// response and no new generation happens.
dteRouter.post('/generate', verifyAuth, idempotencyKey(), async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return undefined;
  const callerUid = req.user?.uid as string;

  const parsed = generateDteSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', details: parsed.error.flatten() });
  }
  const body = parsed.data;

  let generated;
  try {
    // Sprint 36 audit P1 §1.4 — `generateDte` is now lazy-imported so the
    // call site must `await` it; the underlying function is still sync.
    generated = await generateDte({
      type: body.type,
      receptorRut: body.receptorRut,
      receptorRazonSocial: body.receptorRazonSocial,
      receptorDireccion: body.receptorDireccion,
      receptorComuna: body.receptorComuna,
      fecha: body.fecha,
      folio: body.folio,
      items: body.items,
    });
  } catch (err) {
    logger.error('dte.generate failed', err instanceof Error ? err : new Error(String(err)));
    dteSentryCapture(err, { endpoint: 'POST /api/dte/generate', tags: { stage: 'generate' } });
    return res.status(422).json({ error: 'dte_generation_failed', message: (err as Error).message });
  }

  let xmlOut = generated.xml;
  let signedAt: string | null = null;
  if (body.biometric) {
    try {
      // F4 (Sprint 5) — CRYPTOGRAPHIC verification of the WebAuthn assertion
      // MUST run BEFORE we embed any signature. verifyAndSignDte only checks
      // credential ownership + hash binding; the actual COSE-pubkey signature
      // check, origin/RPID binding, single-use challenge consume, and
      // counter-monotonicity all live in the canonical verifier (the same one
      // SUSESO / SiteBook / DS76 signing use). Reject 401 on any failure
      // BEFORE verifyAndSignDte runs. Lazily imported to match the existing
      // lazy DTE service pattern and the sibling suseso.ts sign path.
      const { verifyWebAuthnAssertion } = await import('../auth/webauthnAssertion.js');
      const { buildWebAuthnDb } = await import('./curriculum.js');
      const verdict = await verifyWebAuthnAssertion({
        uid: callerUid,
        credentialId: body.biometric.credentialId,
        rawId: body.biometric.rawId,
        clientDataJSON: body.biometric.clientDataJSON,
        authenticatorData: body.biometric.authenticatorData,
        signature: body.biometric.signature,
        clientExtensionResults: body.biometric.clientExtensionResults,
        type: body.biometric.type,
        challengeId: body.biometric.challengeId,
        expectedOrigin: process.env.APP_BASE_URL ?? 'http://localhost:5173',
        expectedRpId: getWebauthnRpId(),
        challengesDb: buildWebAuthnDb(),
        credentialsDb: buildWebAuthnCredentialsDb(),
        // [Audit-2026-08-31] Reject any challenge whose stored dteHash does
        // NOT match the hash of the XML we just generated. This is the
        // server-side complement of buildSignChallenge on the issuance
        // path: the bytes the authenticator signed were bound to that
        // exact XML, and we refuse to embed a signature whose scope the
        // route never confirmed.
        challengeMetadataValidator: (metadata: unknown) => {
          if (!metadata || typeof metadata !== 'object') return false;
          const stored = (metadata as Record<string, unknown>).dteHash;
          return stored === generated.hash;
        },
      });
      if (!verdict.verified) {
        logger.warn('dte.sign webauthn verification failed', {
          uid: callerUid,
          dteId: generated.dteId,
          reason: verdict.reason,
        });
        // Audit-log the rejected forgery attempt (Regla #14: awaited, never
        // throws — branch on the boolean return). details carry only the
        // public credentialId + typed reason, NEVER the assertion bytes.
        const auditOk = await auditServerEvent(req, 'dte.sign_failed', 'dte', {
          dteId: generated.dteId,
          credentialId: body.biometric.credentialId,
          reason: verdict.reason ?? 'signature_invalid',
        });
        if (!auditOk) {
          dteSentryCapture(new Error('audit_write_failed'), {
            endpoint: 'POST /api/dte/generate',
            tags: { audit_event: 'dte.sign_failed', stage: 'audit' },
          });
        }
        return res
          .status(401)
          .json({ error: 'dte_sign_failed', reason: verdict.reason ?? 'signature_invalid' });
      }
      // Crypto verified — now embed the signature into the XML envelope.
      const signed = await verifyAndSignDte(
        {
          xml: generated.xml,
          dteHash: generated.hash,
          credentialId: body.biometric.credentialId,
          uid: callerUid,
          signature: body.biometric.signature,
          authenticatorData: body.biometric.authenticatorData,
          clientDataJSON: body.biometric.clientDataJSON,
        },
        buildWebAuthnCredentialsDb(),
      );
      xmlOut = signed.signedXml;
      signedAt = signed.signedAt;
      // The DTE is already signed; we AWAIT the compliance audit write before
      // responding (CLAUDE.md #14 — fire-and-forget audit is banned: on Cloud
      // Run the instance can be CPU-throttled / scaled-to-zero before add()
      // flushes, silently dropping the row for a signed tax document).
      // auditServerEvent returns boolean (never throws); branch on .then(ok).
      await auditServerEvent(req, 'dte.signed', 'dte', {
        dteId: generated.dteId,
        type: body.type,
        folio: body.folio,
        credentialId: body.biometric.credentialId,
      }).then((ok: boolean) => {
        if (!ok) {
          dteSentryCapture(new Error('audit_write_failed'), {
            endpoint: 'POST /api/dte/generate',
            tags: { audit_event: 'dte.signed', stage: 'audit' },
          });
        }
      });
    } catch (err) {
      logger.warn('dte.sign failed', { message: (err as Error).message });
      dteSentryCapture(err, { endpoint: 'POST /api/dte/generate', tags: { stage: 'sign' } });
      // Awaited so the 401 below ships only after the audit settles
      // (CLAUDE.md #14); helper logs internally and never throws.
      await auditServerEvent(req, 'dte.sign_failed', 'dte', {
        dteId: generated.dteId,
        reason: (err as Error).message,
      }).then((ok: boolean) => {
        if (!ok) {
          dteSentryCapture(new Error('audit_write_failed'), {
            endpoint: 'POST /api/dte/generate',
            tags: { audit_event: 'dte.sign_failed', stage: 'audit' },
          });
        }
      });
      return res.status(401).json({ error: 'dte_sign_failed', message: (err as Error).message });
    }
  }

  let pdfBase64: string;
  try {
    const buf = await renderDtePdf({
      dte: generated,
      signedAt,
      items: body.items,
      receptorRazonSocial: body.receptorRazonSocial,
    });
    pdfBase64 = buf.toString('base64');
  } catch (err) {
    logger.error('dte.pdf render failed', err instanceof Error ? err : new Error(String(err)));
    dteSentryCapture(err, { endpoint: 'POST /api/dte/generate', tags: { stage: 'pdf' } });
    return res.status(500).json({ error: 'dte_pdf_failed' });
  }

  // Awaited so the success response ships only after the audit settles
  // (CLAUDE.md #14); helper logs internally and never throws.
  await auditServerEvent(req, 'dte.generated', 'dte', {
    dteId: generated.dteId,
    type: body.type,
    folio: body.folio,
    total: generated.summary.total,
    signed: !!body.biometric,
  }).then((ok: boolean) => {
    if (!ok) {
      dteSentryCapture(new Error('audit_write_failed'), {
        endpoint: 'POST /api/dte/generate',
        tags: { audit_event: 'dte.generated', stage: 'audit' },
      });
    }
  });

  return res.json({
    xml: xmlOut,
    pdfBase64,
    dteId: generated.dteId,
    signedAt,
    summary: generated.summary,
  });
});

export default dteRouter;
