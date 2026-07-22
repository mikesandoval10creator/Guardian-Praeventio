import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import admin from 'firebase-admin';
import { z } from 'zod';

import { verifyAuth } from '../middleware/verifyAuth.js';
import {
  activateGrantSession,
  confirmGrantRecipient,
  createHealthAccessGrant,
  revokeHealthAccessGrant,
  validateGrantClaim,
  VaultShareError,
  type HealthAccessGrantV2,
  type HealthAccessPurpose,
} from '../../services/health/vaultShare.js';
import {
  createVaultAccessSession,
  validateVaultAccessSession,
  VaultAccessSessionError,
  type VaultAccessSession,
} from '../../services/health/vaultAccessSession.js';
import {
  canReceiveHealthGrant,
  type HealthProfessionalIdentity,
} from '../../services/health/professionalIdentity.js';
import {
  getHealthRecordById,
  getHealthRecords,
  getHealthRecordsByIds,
  type HealthRecord,
} from '../../services/health/vaultRecord.js';
import {
  generateWebAuthnChallenge,
  healthProfessionalChallengeMetadata,
  matchesHealthProfessionalChallenge,
  storeWebAuthnChallenge,
} from '../../services/auth/webauthnChallenge.js';
import { verifyWebAuthnAssertion } from '../auth/webauthnAssertion.js';
import { getWebauthnExpectedOrigin, getWebauthnRpId } from '../auth/rpId.js';
import {
  buildWebAuthnCredentialsDb,
  buildWebAuthnDb,
} from './curriculum.js';
import { logger } from '../../utils/logger.js';
import { serverAnalytics, type ServerAnalytics } from '../../services/analytics/serverAdapter.js';
import { bucketHealthAccessDuration } from '../../services/analytics/healthPrivacy.js';

type VerifiedAssertion = { verified: boolean; credentialId?: string; reason?: string };
type FilePayload = { bytes: Buffer; contentType: string };

export interface HealthVaultProfessionalRouterDeps {
  analytics?: Pick<ServerAnalytics, 'track'>;
  createGrant(grant: HealthAccessGrantV2): Promise<unknown>;
  getGrant(id: string): Promise<HealthAccessGrantV2 | null>;
  replaceGrant(
    grant: HealthAccessGrantV2,
    audit: {
      action: 'health_vault.grant.recipient_confirmed' | 'health_vault.grant.revoked';
      actorUid: string;
    },
  ): Promise<unknown>;
  activateSession(grant: HealthAccessGrantV2, session: VaultAccessSession): Promise<unknown>;
  getSession(id: string): Promise<VaultAccessSession | null>;
  getProfessional(uid: string): Promise<HealthProfessionalIdentity | null>;
  getRecordsByIds(uid: string, ids: string[]): Promise<HealthRecord[]>;
  getOwnerRecords(uid: string): Promise<HealthRecord[]>;
  getRecordById(uid: string, id: string): Promise<HealthRecord | null>;
  getOwnerName(uid: string): Promise<string>;
  issueChallenge(uid: string, grantId: string): Promise<{ challengeId: string; challenge: string }>;
  verifyAssertion(uid: string, grantId: string, assertion: unknown): Promise<VerifiedAssertion>;
  auditAccess(event: {
    action: string;
    actorUid: string;
    ownerUid: string;
    grantId: string;
    sessionId?: string;
  }): Promise<void>;
  readFile(fileUri: string): Promise<FilePayload | null>;
}

const grantSchema = z.object({
  version: z.literal(2),
  scope: z.enum(['full', 'recent', 'topic']),
  resourceIds: z.array(z.string().min(1).max(128)).min(1).max(100),
  recipientProfessionalUid: z.string().min(1).max(128).optional(),
  purpose: z.enum([
    'continuity_of_care',
    'second_opinion',
    'diagnostic_review',
    'occupational_health',
  ]),
  ttlHours: z.number().positive().max(168).optional(),
  maxSessions: z.number().int().positive().max(20).optional(),
});

const sessionSchema = z.object({
  secret: z.string().min(20).max(256),
  assertion: z.object({ challengeId: z.string().min(1).max(256) }).passthrough(),
});

const confirmRecipientSchema = z.object({
  professionalUid: z.string().min(1).max(128),
});

const challengeLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const sessionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const PURPOSE_LABELS: Record<HealthAccessPurpose, string> = {
  continuity_of_care: 'continuidad de atención',
  second_opinion: 'segunda opinión',
  diagnostic_review: 'revisión diagnóstica',
  occupational_health: 'salud ocupacional',
};

export function buildHealthGrantConsentText(input: {
  professionalDisplayName?: string;
  professionalStatus?: string;
  purpose: HealthAccessPurpose;
  resourceCount: number;
  ttlHours: number;
}): string {
  const professional = input.professionalDisplayName ?? 'el profesional que yo confirme';
  const verification = input.professionalStatus
    ? ` con estado ${input.professionalStatus}`
    : '';
  return (
    `Autorizo a ${professional}${verification} a consultar exactamente ` +
    `${input.resourceCount} registro(s) de mi Health Vault para ` +
    `${PURPOSE_LABELS[input.purpose]}, durante un máximo de ${input.ttlHours} hora(s). ` +
    'Puedo revocar este acceso en cualquier momento.'
  );
}

function applySecurityHeaders(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
}

function messageForGrantError(error: VaultShareError): { status: number; message: string } {
  switch (error.code) {
    case 'recipient_mismatch':
      return { status: 403, message: 'Este acceso fue autorizado para otro profesional.' };
    case 'professional_not_eligible':
      return {
        status: 403,
        message: 'Tu identidad profesional aún no está habilitada para consultar datos clínicos.',
      };
    case 'recipient_confirmation_required':
      return {
        status: 409,
        message: 'El paciente debe confirmar al profesional antes de liberar información.',
      };
    case 'revoked':
      return { status: 410, message: 'El paciente revocó este acceso.' };
    case 'expired':
      return { status: 410, message: 'Este acceso expiró. El paciente puede emitir uno nuevo.' };
    case 'max_sessions_reached':
      return {
        status: 410,
        message: 'Este acceso alcanzó el límite de sesiones autorizado por el paciente.',
      };
    case 'invalid_token':
      return { status: 401, message: 'El código de acceso no es válido.' };
    case 'owner_required':
      return { status: 403, message: 'Sólo el titular puede cambiar este consentimiento.' };
    default:
      return { status: 400, message: 'No pudimos validar este acceso clínico.' };
  }
}

function grantError(res: Response, error: VaultShareError) {
  const mapped = messageForGrantError(error);
  return res.status(mapped.status).json({ error: error.code, message: mapped.message });
}

function assertRuntimeGrant(
  grant: HealthAccessGrantV2,
  professional: HealthProfessionalIdentity,
  now = Date.now(),
): void {
  if (grant.status === 'revoked' || grant.revokedAt !== null) {
    throw new VaultShareError('Grant revoked', 'revoked');
  }
  if (grant.status === 'expired' || now > grant.expiresAt) {
    throw new VaultShareError('Grant expired', 'expired');
  }
  if (!grant.recipientProfessionalUid) {
    throw new VaultShareError('Recipient confirmation required', 'recipient_confirmation_required');
  }
  if (grant.recipientProfessionalUid !== professional.uid) {
    throw new VaultShareError('Recipient mismatch', 'recipient_mismatch');
  }
  if (!canReceiveHealthGrant(professional)) {
    throw new VaultShareError('Professional not eligible', 'professional_not_eligible');
  }
}

function analyticsVerificationStatus(
  professional: HealthProfessionalIdentity,
): 'provisional' | 'verified' {
  if (professional.status === 'provisional' || professional.status === 'verified') {
    return professional.status;
  }
  throw new VaultShareError('Professional not eligible', 'professional_not_eligible');
}

function sessionHeader(req: Request): { id: string; secret: string } | null {
  const raw = req.header('X-Health-Vault-Session');
  if (!raw || raw.length > 512) return null;
  const separator = raw.indexOf('.');
  if (separator < 1) return null;
  const id = raw.slice(0, separator);
  const secret = raw.slice(separator + 1);
  return id && secret ? { id, secret } : null;
}

async function authorizeSession(
  req: Request,
  deps: HealthVaultProfessionalRouterDeps,
): Promise<{
  grant: HealthAccessGrantV2;
  session: VaultAccessSession;
  professional: HealthProfessionalIdentity;
}> {
  const callerUid = req.user?.uid;
  const grantId = req.params.grantId;
  const header = sessionHeader(req);
  if (!callerUid || !header) {
    throw new VaultAccessSessionError('Session missing', 'invalid_session');
  }
  const [grant, session, professional] = await Promise.all([
    deps.getGrant(grantId),
    deps.getSession(header.id),
    deps.getProfessional(callerUid),
  ]);
  if (!grant || !session || !professional) {
    throw new VaultAccessSessionError('Session invalid', 'invalid_session');
  }
  assertRuntimeGrant(grant, professional);
  validateVaultAccessSession(session, header.secret, {
    grantId,
    professionalUid: callerUid,
  });
  return { grant, session, professional };
}

function safeRecord(record: HealthRecord) {
  const { fileUri, ...rest } = record;
  return { ...rest, fileAvailable: typeof fileUri === 'string' && fileUri.length > 0 };
}

export function createHealthVaultProfessionalRouter(
  providedDeps?: HealthVaultProfessionalRouterDeps,
) {
  const router = Router();
  const deps = () => providedDeps ?? defaultDependencies();
  const analytics = providedDeps?.analytics ?? serverAnalytics;

  router.use((_req, res, next) => {
    applySecurityHeaders(res);
    next();
  });

  router.post('/share', verifyAuth, async (req, res, next: NextFunction) => {
    if (req.body?.version !== 2) return next();
    const callerUid = req.user?.uid;
    if (!callerUid) {
      return res.status(401).json({ error: 'authentication_required', message: 'Inicia sesión.' });
    }
    const parsed = grantSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_health_grant',
        message: 'Revisa el profesional, los registros y la duración seleccionados.',
      });
    }
    try {
      const service = deps();
      const records = await service.getRecordsByIds(callerUid, parsed.data.resourceIds);
      const returnedIds = new Set(records.map((record) => record.id));
      if (
        records.length !== new Set(parsed.data.resourceIds).size ||
        records.some((record) => record.workerUid !== callerUid) ||
        parsed.data.resourceIds.some((id) => !returnedIds.has(id))
      ) {
        return res.status(400).json({
          error: 'health_records_not_owned',
          message: 'Uno o más registros seleccionados no pertenecen a tu Health Vault.',
        });
      }
      const professional = parsed.data.recipientProfessionalUid
        ? await service.getProfessional(parsed.data.recipientProfessionalUid)
        : null;
      if (parsed.data.recipientProfessionalUid && (!professional || !canReceiveHealthGrant(professional))) {
        return res.status(400).json({
          error: 'professional_not_eligible',
          message: 'El profesional seleccionado aún no está habilitado para recibir el acceso.',
        });
      }
      const ttlHours = parsed.data.ttlHours ?? 24;
      const consentText = buildHealthGrantConsentText({
        professionalDisplayName: professional?.displayName,
        professionalStatus: professional?.status,
        purpose: parsed.data.purpose,
        resourceCount: parsed.data.resourceIds.length,
        ttlHours,
      });
      const created = createHealthAccessGrant({
        ownerUid: callerUid,
        scope: parsed.data.scope,
        resourceIds: parsed.data.resourceIds,
        recipientProfessionalUid: parsed.data.recipientProfessionalUid,
        purpose: parsed.data.purpose,
        consentTextVersion: 'health-vault-v2-es-CL-1',
        consentText,
        ttlHours,
        maxSessions: parsed.data.maxSessions,
      });
      await service.createGrant(created.record);
      if (professional) {
        try {
          await analytics.track('health.share.recipient_confirmed', {
            country: 'CL',
            verification_status: analyticsVerificationStatus(professional),
            channel: 'directory',
            duration_bucket: bucketHealthAccessDuration(
              created.record.expiresAt - created.record.createdAt,
            ),
            outcome_code: 'success',
          });
        } catch {
          // Consent persistence and audit are critical; product analytics is not.
        }
      }
      return res.status(201).json({
        grantId: created.record.id,
        secret: created.secret,
        qrPayload: created.qrPayload,
        expiresAt: created.record.expiresAt,
        status: created.record.status,
        consentText,
        consentTextVersion: created.record.consentTextVersion,
        consentTextHash: created.record.consentTextHash,
      });
    } catch (error) {
      if (error instanceof VaultShareError) return grantError(res, error);
      logger.error('health_vault_v2_create_failed', error instanceof Error ? error : new Error(String(error)));
      return res.status(503).json({
        error: 'health_vault_temporarily_unavailable',
        message: 'No pudimos crear el acceso seguro. Intenta nuevamente.',
      });
    }
  });

  router.get('/records', verifyAuth, async (req, res) => {
    const callerUid = req.user?.uid;
    if (!callerUid) {
      return res.status(401).json({
        error: 'authentication_required',
        message: 'Inicia sesión para elegir tus registros.',
      });
    }
    try {
      const records = await deps().getOwnerRecords(callerUid);
      return res.json({ records: records.map(safeRecord) });
    } catch {
      return res.status(503).json({
        error: 'health_vault_temporarily_unavailable',
        message: 'No pudimos cargar tus registros médicos. Intenta nuevamente.',
      });
    }
  });

  router.post('/share/:grantId/confirm-recipient', verifyAuth, async (req, res) => {
    const callerUid = req.user?.uid;
    const parsed = confirmRecipientSchema.safeParse(req.body);
    if (!callerUid || !parsed.success) {
      return res.status(callerUid ? 400 : 401).json({
        error: callerUid ? 'invalid_recipient' : 'authentication_required',
        message: callerUid ? 'Selecciona un profesional válido.' : 'Inicia sesión.',
      });
    }
    try {
      const service = deps();
      const [grant, professional] = await Promise.all([
        service.getGrant(req.params.grantId),
        service.getProfessional(parsed.data.professionalUid),
      ]);
      if (!grant) return res.status(404).json({ error: 'grant_not_found', message: 'Acceso no encontrado.' });
      if (!professional || !canReceiveHealthGrant(professional)) {
        return res.status(400).json({ error: 'professional_not_eligible', message: 'El profesional aún no está habilitado.' });
      }
      const updated = confirmGrantRecipient(grant, callerUid, professional.uid);
      await service.replaceGrant(updated, {
        action: 'health_vault.grant.recipient_confirmed',
        actorUid: callerUid,
      });
      try {
        await analytics.track('health.share.recipient_confirmed', {
          country: 'CL',
          verification_status: analyticsVerificationStatus(professional),
          channel: 'qr',
          duration_bucket: bucketHealthAccessDuration(updated.expiresAt - updated.createdAt),
          outcome_code: 'success',
        });
      } catch {
        // Product analytics must never block a consent decision.
      }
      return res.json({ status: updated.status, recipient: professional.uid });
    } catch (error) {
      if (error instanceof VaultShareError) return grantError(res, error);
      return res.status(503).json({ error: 'health_vault_temporarily_unavailable', message: 'No pudimos confirmar al profesional.' });
    }
  });

  router.get('/view/:grantId/challenge', verifyAuth, challengeLimiter, async (req, res) => {
    const callerUid = req.user?.uid;
    if (!callerUid) return res.status(401).json({ error: 'authentication_required', message: 'Inicia sesión.' });
    try {
      const service = deps();
      const [grant, professional] = await Promise.all([
        service.getGrant(req.params.grantId),
        service.getProfessional(callerUid),
      ]);
      if (!grant) return res.status(404).json({ error: 'grant_not_found', message: 'Acceso no encontrado.' });
      if (!professional) throw new VaultShareError('Professional not eligible', 'professional_not_eligible');
      assertRuntimeGrant(grant, professional);
      return res.json(await service.issueChallenge(callerUid, grant.id));
    } catch (error) {
      if (error instanceof VaultShareError) return grantError(res, error);
      return res.status(503).json({ error: 'webauthn_unavailable', message: 'No pudimos iniciar la verificación biométrica.' });
    }
  });

  router.post('/view/:grantId/session', verifyAuth, sessionLimiter, async (req, res) => {
    const callerUid = req.user?.uid;
    const parsed = sessionSchema.safeParse(req.body);
    if (!callerUid || !parsed.success) {
      return res.status(callerUid ? 400 : 401).json({
        error: callerUid ? 'invalid_session_request' : 'authentication_required',
        message: callerUid ? 'No pudimos validar la prueba biométrica.' : 'Inicia sesión.',
      });
    }
    try {
      const service = deps();
      const [grant, professional] = await Promise.all([
        service.getGrant(req.params.grantId),
        service.getProfessional(callerUid),
      ]);
      if (!grant) return res.status(404).json({ error: 'grant_not_found', message: 'Acceso no encontrado.' });
      if (!professional) throw new VaultShareError('Professional not eligible', 'professional_not_eligible');
      validateGrantClaim(grant, parsed.data.secret, professional);
      const verification = await service.verifyAssertion(callerUid, grant.id, parsed.data.assertion);
      if (!verification.verified || !verification.credentialId) {
        return res.status(401).json({
          error: 'webauthn_verification_failed',
          message: 'La huella o llave de seguridad no pudo verificarse. Intenta nuevamente.',
        });
      }
      const credentialIdHash = createHash('sha256')
        .update(verification.credentialId, 'utf8')
        .digest('hex');
      const createdSession = createVaultAccessSession({
        grantId: grant.id,
        professionalUid: callerUid,
      });
      const activatedGrant = activateGrantSession(grant, callerUid, credentialIdHash);
      await service.activateSession(activatedGrant, createdSession.record);
      try {
        await analytics.track('health.share.session_started', {
          country: 'CL',
          verification_status: analyticsVerificationStatus(professional),
          channel: 'qr',
          duration_bucket: bucketHealthAccessDuration(grant.expiresAt - grant.createdAt),
          outcome_code: 'success',
        });
      } catch {
        // The atomic session audit is authoritative; product analytics is optional.
      }
      return res.status(201).json({
        sessionToken: `${createdSession.record.id}.${createdSession.secret}`,
        expiresAt: createdSession.record.expiresAt,
      });
    } catch (error) {
      if (error instanceof VaultShareError) return grantError(res, error);
      return res.status(503).json({ error: 'clinical_session_unavailable', message: 'No pudimos abrir la sesión clínica segura.' });
    }
  });

  router.get('/view/:grantId/records', verifyAuth, async (req, res) => {
    try {
      const service = deps();
      const authorized = await authorizeSession(req, service);
      try {
        await service.auditAccess({
          action: 'health_vault.session.records_accessed',
          actorUid: authorized.professional.uid,
          ownerUid: authorized.grant.ownerUid,
          grantId: authorized.grant.id,
          sessionId: authorized.session.id,
        });
      } catch {
        return res.status(503).json({
          error: 'clinical_audit_unavailable',
          message: 'Por seguridad no podemos mostrar los datos mientras la auditoría no esté disponible.',
        });
      }
      const [records, ownerName] = await Promise.all([
        service.getRecordsByIds(authorized.grant.ownerUid, authorized.grant.resourceIds),
        service.getOwnerName(authorized.grant.ownerUid),
      ]);
      return res.json({
        ownerName,
        records: records
          .filter((record) => authorized.grant.resourceIds.includes(record.id))
          .map(safeRecord),
        expiresAt: authorized.grant.expiresAt,
      });
    } catch (error) {
      if (error instanceof VaultShareError) return grantError(res, error);
      if (error instanceof VaultAccessSessionError) {
        return res.status(401).json({ error: error.code, message: 'La sesión clínica expiró o no es válida.' });
      }
      return res.status(503).json({ error: 'health_vault_temporarily_unavailable', message: 'No pudimos cargar los registros.' });
    }
  });

  router.get('/view/:grantId/file/:recordId', verifyAuth, async (req, res) => {
    try {
      const service = deps();
      const authorized = await authorizeSession(req, service);
      if (!authorized.grant.resourceIds.includes(req.params.recordId)) {
        return res.status(404).json({ error: 'file_not_authorized', message: 'Este archivo no forma parte del consentimiento.' });
      }
      const record = await service.getRecordById(authorized.grant.ownerUid, req.params.recordId);
      if (!record?.fileUri) return res.status(404).json({ error: 'file_unavailable', message: 'El archivo no está disponible.' });
      try {
        await service.auditAccess({
          action: 'health_vault.session.file_accessed',
          actorUid: authorized.professional.uid,
          ownerUid: authorized.grant.ownerUid,
          grantId: authorized.grant.id,
          sessionId: authorized.session.id,
        });
      } catch {
        return res.status(503).json({ error: 'clinical_audit_unavailable', message: 'Por seguridad no podemos abrir el archivo mientras la auditoría no esté disponible.' });
      }
      const file = await service.readFile(record.fileUri);
      if (!file) return res.status(404).json({ error: 'file_unavailable', message: 'El archivo no está disponible.' });
      res.type(file.contentType);
      return res.send(file.bytes);
    } catch (error) {
      if (error instanceof VaultShareError) return grantError(res, error);
      if (error instanceof VaultAccessSessionError) return res.status(401).json({ error: error.code, message: 'La sesión clínica expiró o no es válida.' });
      return res.status(503).json({ error: 'health_vault_temporarily_unavailable', message: 'No pudimos abrir el archivo.' });
    }
  });

  router.post('/share/:grantId/revoke', verifyAuth, async (req, res, next: NextFunction) => {
    const callerUid = req.user?.uid;
    if (!callerUid) return res.status(401).json({ error: 'authentication_required', message: 'Inicia sesión.' });
    try {
      const service = deps();
      const grant = await service.getGrant(req.params.grantId);
      if (!grant) return next();
      const revoked = revokeHealthAccessGrant(grant, callerUid);
      await service.replaceGrant(revoked, {
        action: 'health_vault.grant.revoked',
        actorUid: callerUid,
      });
      return res.json({ ok: true, revokedAt: revoked.revokedAt });
    } catch (error) {
      if (error instanceof VaultShareError) return grantError(res, error);
      return res.status(503).json({ error: 'health_vault_temporarily_unavailable', message: 'No pudimos revocar el acceso.' });
    }
  });

  return router;
}

let cachedDefaultDependencies: HealthVaultProfessionalRouterDeps | undefined;

function defaultDependencies(): HealthVaultProfessionalRouterDeps {
  if (cachedDefaultDependencies) return cachedDefaultDependencies;
  const db = admin.firestore();
  const grants = db.collectionGroup('health_vault_shares');
  const sessions = db.collection('health_vault_access_sessions');
  const professionals = db.collection('health_professional_identities');

  const locateGrant = async (id: string): Promise<HealthAccessGrantV2 | null> => {
    const snapshot = await grants.where('id', '==', id).limit(1).get();
    if (snapshot.empty) return null;
    const data = snapshot.docs[0].data();
    return data.version === 2 ? (data as HealthAccessGrantV2) : null;
  };

  cachedDefaultDependencies = {
    async createGrant(grant) {
      const grantRef = db
        .collection('users')
        .doc(grant.ownerUid)
        .collection('health_vault_shares')
        .doc(grant.id);
      await db.runTransaction(async (transaction) => {
        transaction.create(grantRef, grant);
        transaction.create(db.collection('audit_logs').doc(), {
          action: 'health_vault.grant.created',
          actorUid: grant.ownerUid,
          ownerUid: grant.ownerUid,
          grantId: grant.id,
          resourceType: 'health_vault',
          resourceCount: grant.resourceIds.length,
          timestamp: grant.createdAt,
        });
      });
    },
    getGrant: locateGrant,
    async replaceGrant(grant, audit) {
      const grantRef = db
        .collection('users')
        .doc(grant.ownerUid)
        .collection('health_vault_shares')
        .doc(grant.id);
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(grantRef);
        const current = snapshot.data() as HealthAccessGrantV2 | undefined;
        if (!snapshot.exists || !current || current.version !== 2) {
          throw new Error('grant_replace_conflict');
        }
        if (audit.actorUid !== current.ownerUid || grant.ownerUid !== current.ownerUid) {
          throw new Error('grant_owner_conflict');
        }
        const validTransition =
          (audit.action === 'health_vault.grant.recipient_confirmed' &&
            current.status === 'pending' &&
            grant.status === 'active') ||
          (audit.action === 'health_vault.grant.revoked' &&
            current.status !== 'revoked' &&
            grant.status === 'revoked');
        if (!validTransition) throw new Error('grant_state_conflict');

        transaction.set(grantRef, grant);
        transaction.create(db.collection('audit_logs').doc(), {
          action: audit.action,
          actorUid: audit.actorUid,
          ownerUid: current.ownerUid,
          grantId: current.id,
          resourceType: 'health_vault',
          timestamp: Date.now(),
        });
      });
    },
    async activateSession(grant, session) {
      const grantRef = db
        .collection('users')
        .doc(grant.ownerUid)
        .collection('health_vault_shares')
        .doc(grant.id);
      await db.runTransaction(async (transaction) => {
        const fresh = await transaction.get(grantRef);
        const current = fresh.data() as HealthAccessGrantV2 | undefined;
        if (!fresh.exists || !current || current.sessionCount + 1 !== grant.sessionCount) {
          throw new Error('grant_session_conflict');
        }
        transaction.set(grantRef, grant);
        transaction.create(sessions.doc(session.id), session);
        transaction.create(db.collection('audit_logs').doc(), {
          action: 'health_vault.session.started',
          actorUid: session.professionalUid,
          ownerUid: grant.ownerUid,
          grantId: grant.id,
          sessionId: session.id,
          resourceType: 'health_vault',
          timestamp: session.createdAt,
        });
      });
    },
    async getSession(id) {
      const snapshot = await sessions.doc(id).get();
      return snapshot.exists ? (snapshot.data() as VaultAccessSession) : null;
    },
    async getProfessional(uid) {
      const snapshot = await professionals.doc(uid).get();
      return snapshot.exists ? (snapshot.data() as HealthProfessionalIdentity) : null;
    },
    getRecordsByIds: getHealthRecordsByIds,
    getOwnerRecords: getHealthRecords,
    getRecordById: getHealthRecordById,
    async getOwnerName(uid) {
      const snapshot = await db.collection('users').doc(uid).get();
      const displayName = snapshot.data()?.displayName;
      return typeof displayName === 'string' && displayName ? displayName : 'Paciente';
    },
    async issueChallenge(uid, grantId) {
      const generated = generateWebAuthnChallenge();
      await storeWebAuthnChallenge(uid, generated.challengeId, generated.challenge, buildWebAuthnDb(), {
        metadata: healthProfessionalChallengeMetadata(grantId),
      });
      return {
        challengeId: generated.challengeId,
        challenge: Buffer.from(generated.challenge).toString('base64'),
      };
    },
    async verifyAssertion(uid, grantId, rawAssertion) {
      const assertion = rawAssertion as Record<string, unknown>;
      const result = await verifyWebAuthnAssertion({
        uid,
        credentialId: String(assertion.id ?? ''),
        rawId: String(assertion.rawId ?? ''),
        clientDataJSON: String(assertion.clientDataJSON ?? ''),
        authenticatorData: String(assertion.authenticatorData ?? ''),
        signature: String(assertion.signature ?? ''),
        clientExtensionResults:
          assertion.clientExtensionResults && typeof assertion.clientExtensionResults === 'object'
            ? (assertion.clientExtensionResults as Record<string, unknown>)
            : {},
        type: String(assertion.type ?? ''),
        challengeId: String(assertion.challengeId ?? ''),
        expectedOrigin: getWebauthnExpectedOrigin(),
        expectedRpId: getWebauthnRpId(),
        challengesDb: buildWebAuthnDb(),
        credentialsDb: buildWebAuthnCredentialsDb(),
        challengeMetadataValidator: (metadata) =>
          matchesHealthProfessionalChallenge(metadata, grantId),
      });
      return {
        verified: result.verified,
        credentialId: result.verifiedCredentialId,
        reason: result.reason,
      };
    },
    async auditAccess(event) {
      await db.collection('audit_logs').add({
        ...event,
        resourceType: 'health_vault',
        timestamp: Date.now(),
      });
    },
    async readFile(fileUri) {
      const objectPath = fileUri.replace(/^gs:\/\/[^/]+\//, '');
      const file = admin.storage().bucket().file(objectPath);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [[bytes], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
      return { bytes, contentType: metadata.contentType ?? 'application/octet-stream' };
    },
  };
  return cachedDefaultDependencies;
}

export default createHealthVaultProfessionalRouter();
