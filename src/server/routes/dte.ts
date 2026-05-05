// Praeventio Guard — Sprint 23 Bucket GG.
//
// Admin DTE endpoints. Wraps the Bsale adapter so an operator can:
//   • POST /api/dte/create  — emit a manual DTE outside the auto-pipeline.
//   • GET  /api/dte/:folio  — fetch the live status from Bsale.
//   • POST /api/dte/:folio/cancel — issue a Nota de Crédito to cancel a folio.
//
// Auto-emission on `invoice.status === 'paid'` lives in
// `src/services/billing/invoice.ts:tryAutoIssueDte`. This route is the
// admin / fallback surface — never exposed to the SPA without an admin role.
//
// Mounted in server.ts at `/api/dte`. Final paths preserved verbatim.

import { Router, type Request, type Response } from 'express';
import admin from 'firebase-admin';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { isAdminRole } from '../../types/roles.js';
import { logger } from '../../utils/logger.js';
import { BsaleAdapter, type DteCreateInput } from '../../services/sii/bsaleAdapter.js';

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
dteRouter.post('/create', verifyAuth, async (req: Request, res: Response) => {
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

export default dteRouter;
