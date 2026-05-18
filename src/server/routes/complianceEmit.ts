// Praeventio Guard — Sprint 38 (CL adapter consolidation).
//
// Generic emission endpoint per ADR-0017:
//
//   POST /api/compliance/emit/:type
//     body: { country: CountryCode, payload: <adapter-validated> }
//     200:  { json, pdfBase64?, xml?, folio?, signedAt?, country, type, citation }
//     400:  { error: 'no_adapter_for_jurisdiction', suggestedAdapters: [...] }
//     400:  { error: 'invalid_input', issues: ZodIssue[] }
//     401:  { error: 'Unauthorized: ...' }
//     403:  { error: 'forbidden_role', required: [...] }
//
// Reglas durables del usuario reafirmadas en este endpoint:
//   • NO push a SUSESO/MUTUAL/SII — el handler retorna documento al
//     caller, jamás llama submitToOrganism / pushToSII.
//   • Firma biométrica WebAuthn — la firma se aplica fuera de este
//     handler (challenge â†’ cliente firma â†’ re-POST `/sign` legacy). El
//     `/emit` endpoint es generación + validación, sin tocar passkeys.
//   • NO bloquear maquinaria — solo emite documentos.
//
// Mounted in server.ts at `/api/compliance/emit`. Es OPT-IN: las rutas
// legacy (`/api/dte/generate`, `/api/compliance/ds67`, etc.) siguen
// expuestas y siguen funcionando — este router NO las reemplaza.

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { logger } from '../../utils/logger.js';
import { captureRouteError } from '../middleware/captureRouteError.js';
import {
  getAdapter,
  getSuggestedAdapters,
  isCountryCode,
  isEmissionType,
  type CountryCode,
  type EmissionType,
} from '../../services/compliance/registry.js';
import {
  ADMIN_ROLES,
  DOCTOR_ROLES,
  SUPERVISOR_ROLES,
} from '../../types/roles.js';

const router = Router();

// â”€â”€â”€ Role gating per emission type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// admin/gerente baseline; medical types add medico_ocupacional;
// committee/training/inspection allow supervisores.

const ROLE_ALLOWLIST: Record<EmissionType, readonly string[]> = {
  occupational_injury: [...ADMIN_ROLES, ...SUPERVISOR_ROLES, ...DOCTOR_ROLES],
  aptitude_cert: [...ADMIN_ROLES, ...DOCTOR_ROLES],
  tax_invoice: [...ADMIN_ROLES],
  committee_minutes: [...ADMIN_ROLES, ...SUPERVISOR_ROLES],
  training_record: [...ADMIN_ROLES, ...SUPERVISOR_ROLES],
  safety_inspection: [...ADMIN_ROLES, ...SUPERVISOR_ROLES],
};

function getReqRole(req: Request): string | null {
  const user = req.user as { role?: string; roles?: string[] } | undefined;
  if (!user) return null;
  if (typeof user.role === 'string') return user.role;
  if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles[0] ?? null;
  return null;
}

const bodySchema = z.object({
  country: z.string().min(2),
  payload: z.unknown(),
});

router.post('/:type', verifyAuth, async (req: Request, res: Response) => {
  const rawType = req.params.type;
  if (!isEmissionType(rawType)) {
    return res.status(400).json({
      error: 'invalid_emission_type',
      received: rawType,
      supported: [
        'occupational_injury',
        'aptitude_cert',
        'tax_invoice',
        'committee_minutes',
        'training_record',
        'safety_inspection',
      ],
    });
  }
  const type: EmissionType = rawType;

  // Body shape gate.
  const bodyParse = bodySchema.safeParse(req.body);
  if (!bodyParse.success) {
    return res.status(400).json({ error: 'invalid_input', issues: bodyParse.error.issues });
  }
  const { country: rawCountry, payload } = bodyParse.data;
  if (!isCountryCode(rawCountry)) {
    return res.status(400).json({
      error: 'invalid_country',
      received: rawCountry,
      supported: ['CL', 'US', 'UK', 'EU', 'MX', 'BR', 'AU', 'CN', 'TW', 'RU'],
    });
  }
  const country: CountryCode = rawCountry;

  // Role gate per type.
  const role = getReqRole(req);
  const allowed = ROLE_ALLOWLIST[type];
  if (!role || !allowed.includes(role)) {
    return res.status(403).json({
      error: 'forbidden_role',
      required: allowed,
      received: role,
    });
  }

  // Adapter resolution. ADR-0017: null â†’ 400 with suggestedAdapters.
  const adapter = getAdapter(country, type);
  if (!adapter) {
    const suggestedAdapters = getSuggestedAdapters(type);
    await auditServerEvent(req, `compliance.emit.${country}.${type}`, 'compliance', {
      result: 'no_adapter',
      suggestedAdapters,
    });
    return res.status(400).json({
      error: 'no_adapter_for_jurisdiction',
      country,
      type,
      message: `Country '${country}' has no adapter yet for type '${type}'. ADR-0017 country-by-country roll-out (Sprint 38 = CL).`,
      suggestedAdapters,
    });
  }

  // Payload validation via adapter.validate.
  const valid = adapter.validate.safeParse(payload);
  if (!valid.success) {
    return res.status(400).json({
      error: 'invalid_input',
      country,
      type,
      issues: valid.success === false ? valid.error.issues : [],
    });
  }

  // Generation. Adapters NEVER push externally (regla del usuario).
  try {
    const result = await adapter.generate(valid.data);
    await auditServerEvent(req, `compliance.emit.${country}.${type}`, 'compliance', {
      result: 'generated',
      folio: result.folio ?? null,
      citation: adapter.legalCitation,
    });
    return res.status(200).json({
      country,
      type,
      citation: adapter.legalCitation,
      formats: adapter.suggestedFormats,
      ...result,
    });
  } catch (err) {
    logger.error('[complianceEmit] generate failed', { err, country, type });
    captureRouteError(err, 'complianceEmit.generate', { country, type });
    await auditServerEvent(req, `compliance.emit.${country}.${type}`, 'compliance', {
      result: 'error',
      message: err instanceof Error ? err.message : 'unknown',
    });
    return res.status(500).json({
      error: 'generation_failed',
      message: err instanceof Error ? err.message : 'unknown',
    });
  }
});

export default router;
