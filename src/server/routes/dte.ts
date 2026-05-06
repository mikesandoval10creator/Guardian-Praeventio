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
  const uid = (req as any).user?.uid;
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
  if (!(await requireAdmin(req, res))) return;
  const adapter = resolveBsale(res);
  if (!adapter) return;
  if (!isValidDteCreateInput(req.body)) {
    return res.status(400).json({ error: 'invalid_input' });
  }
  try {
    const result = await adapter.createDte(req.body);
    if (!result.ok) {
      return res.status(422).json({
        error: 'dte_rejected',
        message: result.errorMessage,
      });
    }
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
    return res.status(500).json({ error: 'dte_emission_failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/dte/:folio  — fetch live status from Bsale (admin or owner).
// ---------------------------------------------------------------------------
dteRouter.get('/:folio', verifyAuth, async (req: Request, res: Response) => {
  // Read-only: gated by auth but not admin-only — owners may legitimately
  // fetch their own DTE PDF. Strict ACL (matching invoice ownership) is
  // deferred to a follow-up; for now, any authenticated user can hit this.
  const folio = req.params.folio;
  if (!folio) {
    return res.status(400).json({ error: 'folio_required' });
  }
  const adapter = resolveBsale(res);
  if (!adapter) return;
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
dteRouter.post('/:folio/cancel', verifyAuth, async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
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
  if (!adapter) return;
  try {
    const result = await adapter.cancelDte(folio, reason);
    if (!result.ok) {
      return res.status(422).json({
        error: 'cancel_failed',
        message: result.errorMessage,
      });
    }
    return res.json({ ok: true, trackingId: result.trackingId });
  } catch (err) {
    logger.error('POST /api/dte/:folio/cancel failed', err instanceof Error ? err : new Error(String(err)));
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
//     items: [{ description, quantity (int>0), unitPrice (int>=0), exemptFromIva? }, …],
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
      signature: z.string().min(1),
      authenticatorData: z.string().min(1),
      clientDataJSON: z.string().min(1),
    })
    .optional(),
});

dteRouter.post('/generate', verifyAuth, async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const callerUid = (req as any).user?.uid as string;

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
      void auditServerEvent(req, 'dte.signed', 'dte', {
        dteId: generated.dteId,
        type: body.type,
        folio: body.folio,
        credentialId: body.biometric.credentialId,
      }).catch(() => {});
    } catch (err) {
      logger.warn('dte.sign failed', { message: (err as Error).message });
      dteSentryCapture(err, { endpoint: 'POST /api/dte/generate', tags: { stage: 'sign' } });
      void auditServerEvent(req, 'dte.sign_failed', 'dte', {
        dteId: generated.dteId,
        reason: (err as Error).message,
      }).catch(() => {});
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

  void auditServerEvent(req, 'dte.generated', 'dte', {
    dteId: generated.dteId,
    type: body.type,
    folio: body.folio,
    total: generated.summary.total,
    signed: !!body.biometric,
  }).catch(() => {});

  return res.json({
    xml: xmlOut,
    pdfBase64,
    dteId: generated.dteId,
    signedAt,
    summary: generated.summary,
  });
});

export default dteRouter;
