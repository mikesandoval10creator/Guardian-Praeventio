import { createHash } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import admin from 'firebase-admin';
import { z } from 'zod';

import {
  HealthProfessionalIdentityStoreError,
  createHealthProfessionalIdentityStore,
  type ProfessionalIdentityRepository,
} from '../services/healthProfessionalIdentityStore.js';
import { getKmsAdapter } from '../../services/security/kmsAdapter.js';
import type {
  HealthProfessionalIdentity,
  ProfessionalPublicProfile,
} from '../../services/health/professionalIdentity.js';
import {
  applyProfessionalIdentityTransition,
  ProfessionalIdentityError,
} from '../../services/health/professionalIdentity.js';
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';
import { getCredentialsByUid } from '../../services/auth/webauthnCredentialStore.js';
import { createWebAuthnCredentialsFirestoreDb } from '../auth/webauthnFirestoreDb.js';
import { serverAnalytics, type ServerAnalytics } from '../../services/analytics/serverAdapter.js';
import {
  StubProfessionalRegistryProvider,
  type ProfessionalRegistryVerification,
} from '../../services/health/professionalRegistryProvider.js';

type ProfessionalStore = {
  enroll(input: {
    uid: string;
    displayName: string;
    rut: string;
    registryNumber: string;
  }): Promise<HealthProfessionalIdentity>;
  get(uid: string): Promise<HealthProfessionalIdentity | null>;
  listPublic(query?: string, limit?: number): Promise<ProfessionalPublicProfile[]>;
  approveProvisional(input: {
    targetUid: string;
    reviewerUid: string;
    evidenceReference: string;
  }): Promise<HealthProfessionalIdentity>;
  transitionStatus(input: {
    targetUid: string;
    reviewerUid: string;
    to: 'suspended' | 'revoked';
    evidenceReference: string;
  }): Promise<HealthProfessionalIdentity>;
  revalidate(input: {
    targetUid: string;
    reviewerUid: string;
  }): Promise<{
    identity: HealthProfessionalIdentity;
    verification: ProfessionalRegistryVerification;
  }>;
  reindexLookupKeys(input: {
    actorUid: string;
    afterUid?: string;
    limit?: number;
  }): Promise<{
    processed: number;
    updated: number;
    unchanged: number;
    nextCursor?: string;
    done: boolean;
  }>;
};

const enrollSchema = z.object({
  displayName: z.string().trim().min(3).max(160),
  rut: z.string().trim().min(8).max(20),
  registryNumber: z.string().trim().min(3).max(80),
});

const reviewSchema = z.object({
  evidenceReference: z.string().trim().min(8).max(500),
});

const searchSchema = z.object({
  q: z.string().trim().max(120).optional().default(''),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

function selfDto(identity: HealthProfessionalIdentity) {
  return {
    uid: identity.uid,
    displayName: identity.displayName,
    profession: identity.profession,
    country: identity.country,
    registryAuthority: identity.registryAuthority,
    registryNumber: identity.registryNumber,
    status: identity.status,
    webauthnRequired: identity.webauthnRequired,
    registryStatus: identity.registryAssurance.status,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  };
}

function humanError(
  res: { status(code: number): { json(body: unknown): unknown } },
  error: unknown,
) {
  if (error instanceof HealthProfessionalIdentityStoreError) {
    const status = error.code === 'professional_identity_not_found' ? 404 : 400;
    return res.status(status).json({ error: error.code, message: error.message });
  }
  if (error instanceof ProfessionalIdentityError) {
    return res.status(409).json({
      error: 'professional_state_conflict',
      message: 'La identidad profesional cambió de estado. Actualiza y revisa la decisión antes de reintentar.',
    });
  }
  logger.error('health_professional_route_failed', error instanceof Error ? error : new Error(String(error)));
  return res.status(503).json({
    error: 'professional_service_unavailable',
    message: 'No pudimos completar la verificación profesional. Intenta nuevamente más tarde.',
  });
}

export function parseProfessionalLookupKeys(
  raw: string | undefined,
  legacy: string | undefined,
): Array<{ version: string; key: string }> {
  if (!raw) return legacy ? [{ version: 'v1', key: legacy }] : [];
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return [];
    return Object.entries(parsed)
      .filter((entry): entry is [string, string] =>
        Boolean(entry[0].trim()) && typeof entry[1] === 'string' && entry[1].length >= 32,
      )
      .map(([version, key]) => ({ version, key }));
  } catch {
    return [];
  }
}

export function createFirestoreProfessionalIdentityRepository(
  db: FirebaseFirestore.Firestore,
): ProfessionalIdentityRepository {
  const identities = db.collection('health_professional_identities');
  const indexes = db.collection('health_professional_identity_indexes');
  const audits = db.collection('audit_logs');
  return {
    async get(uid) {
      const snapshot = await identities.doc(uid).get();
      return snapshot.exists ? (snapshot.data() as HealthProfessionalIdentity) : null;
    },
    async findByRutLookupHmac(rutLookupHmac) {
      const snapshot = await indexes.doc(rutLookupHmac).get();
      if (!snapshot.exists) return null;
      const uid = snapshot.data()?.uid;
      if (typeof uid !== 'string') return null;
      const identity = await identities.doc(uid).get();
      return identity.exists ? (identity.data() as HealthProfessionalIdentity) : null;
    },
    async createUnique(identity, rutLookupHmacs, auditEntry) {
      return db.runTransaction(async (transaction) => {
        const identityRef = identities.doc(identity.uid);
        const indexRefs = rutLookupHmacs.map((hmac) => indexes.doc(hmac));
        const [identitySnapshot, ...indexSnapshots] = await Promise.all([
          transaction.get(identityRef),
          ...indexRefs.map((indexRef) => transaction.get(indexRef)),
        ]);
        if (identitySnapshot.exists) return 'uid_conflict' as const;
        if (indexSnapshots.some((snapshot) => snapshot.exists)) return 'rut_conflict' as const;
        transaction.set(identityRef, identity);
        indexRefs.forEach((indexRef) => {
          transaction.set(indexRef, { uid: identity.uid, createdAt: identity.createdAt });
        });
        transaction.create(audits.doc(), auditEntry);
        return 'created' as const;
      });
    },
    async transitionWithAudit(uid, transition, auditEntry) {
      return db.runTransaction(async (transaction) => {
        const identityRef = identities.doc(uid);
        const snapshot = await transaction.get(identityRef);
        if (!snapshot.exists) return null;
        const current = snapshot.data() as HealthProfessionalIdentity;
        const updated = applyProfessionalIdentityTransition(current, transition);
        transaction.set(identityRef, updated);
        transaction.create(audits.doc(), auditEntry);
        return updated;
      });
    },
    async searchEligible(query, limit) {
      let search = identities.where('status', 'in', ['provisional', 'verified']);
      if (query) search = search.where('searchPrefixes', 'array-contains', query);
      const snapshot = await search.orderBy('displayNameSearch').limit(limit).get();
      return snapshot.docs.map((doc) => doc.data() as HealthProfessionalIdentity);
    },
    async recordRegistryCheckWithAudit(uid, verification, actorUid, at) {
      return db.runTransaction(async (transaction) => {
        const identityRef = identities.doc(uid);
        const snapshot = await transaction.get(identityRef);
        if (!snapshot.exists) return null;
        const current = snapshot.data() as HealthProfessionalIdentity;
        let updated: HealthProfessionalIdentity = {
          ...current,
          registryAssurance: {
            provider: verification.provider,
            status: verification.status,
            checkedAt: at,
          },
          updatedAt: at,
        };
        if (verification.status === 'verified' && current.status !== 'verified') {
          const evidenceReferenceHash = `sha256:${createHash('sha256')
            .update(`${verification.provider}:${verification.verifiedRegistryNumber}:${verification.verifiedDisplayName}`)
            .digest('hex')}`;
          updated = applyProfessionalIdentityTransition(updated, {
            to: 'verified',
            actorUid,
            method: 'official_registry_api',
            evidenceReferenceHash,
            at,
          });
        }
        transaction.set(identityRef, updated);
        transaction.create(audits.doc(), {
          action: 'health.professional.registry_revalidated',
          actorUid,
          targetUid: uid,
          resourceType: 'health_professional_identity',
          provider: verification.provider,
          result: verification.status,
          timestamp: at,
        });
        return updated;
      });
    },
    async listForLookupReindex(afterUid, limit) {
      let query: FirebaseFirestore.Query = identities.orderBy(
        admin.firestore.FieldPath.documentId(),
      );
      if (afterUid) query = query.startAfter(afterUid);
      const snapshot = await query.limit(limit).get();
      return snapshot.docs.map((doc) => doc.data() as HealthProfessionalIdentity);
    },
    async reindexLookupHmacs(input) {
      return db.runTransaction(async (transaction) => {
        const identityRef = identities.doc(input.uid);
        const identitySnapshot = await transaction.get(identityRef);
        if (!identitySnapshot.exists) return 'not_found' as const;
        const current = identitySnapshot.data() as HealthProfessionalIdentity;
        if (current.rutLookupHmac !== input.expectedCurrentHmac) {
          return 'conflict' as const;
        }

        const indexRefs = input.lookupHmacs.map((hmac) => indexes.doc(hmac));
        const indexSnapshots = await Promise.all(
          indexRefs.map((indexRef) => transaction.get(indexRef)),
        );
        if (
          indexSnapshots.some(
            (snapshot) => snapshot.exists && snapshot.data()?.uid !== input.uid,
          )
        ) {
          return 'conflict' as const;
        }
        const indexesComplete = indexSnapshots.every(
          (snapshot) => snapshot.exists && snapshot.data()?.uid === input.uid,
        );
        if (
          indexesComplete &&
          current.rutLookupHmac === input.primaryHmac &&
          current.rutLookupHmacVersion === input.primaryVersion
        ) {
          return 'unchanged' as const;
        }

        indexRefs.forEach((indexRef) => {
          transaction.set(indexRef, { uid: input.uid, rotatedAt: input.at }, { merge: true });
        });
        transaction.update(identityRef, {
          rutLookupHmac: input.primaryHmac,
          rutLookupHmacVersion: input.primaryVersion,
          updatedAt: input.at,
        });
        transaction.create(audits.doc(), input.auditEntry);
        return 'updated' as const;
      });
    },
  };
}

function defaultStore(): ProfessionalStore {
  return createHealthProfessionalIdentityStore({
    repository: createFirestoreProfessionalIdentityRepository(admin.firestore()),
    kmsAdapter: getKmsAdapter(),
    lookupKeys: parseProfessionalLookupKeys(
      process.env.HEALTH_PROFESSIONAL_LOOKUP_KEYS,
      process.env.HEALTH_PROFESSIONAL_LOOKUP_KEY,
    ),
    registryProvider: new StubProfessionalRegistryProvider(
      process.env.SUPERSALUD_STUB_STATE === 'unavailable' ? 'unavailable' : 'not_configured',
    ),
  });
}

export function createHealthProfessionalsRouter(deps?: {
  store: ProfessionalStore;
  hasWebAuthnCredential?: (uid: string) => Promise<boolean>;
  analytics?: Pick<ServerAnalytics, 'track'>;
}) {
  const router = Router();
  const getStore = () => deps?.store ?? defaultStore();
  const hasWebAuthnCredential =
    deps?.hasWebAuthnCredential ??
    (async (uid: string) =>
      (await getCredentialsByUid(uid, createWebAuthnCredentialsFirestoreDb())).length > 0);
  const analytics = deps?.analytics ?? serverAnalytics;

  router.post('/enroll', verifyAuth, limiter, async (req, res) => {
    const callerUid = req.user?.uid;
    if (!callerUid) {
      return res.status(401).json({
        error: 'authentication_required',
        message: 'Inicia sesión para registrar tu identidad profesional.',
      });
    }
    const parsed = enrollSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_professional_identity',
        message: 'Revisa el nombre, RUT y número de registro profesional.',
      });
    }
    try {
      const identity = await getStore().enroll({ uid: callerUid, ...parsed.data });
      try {
        await analytics.track('health.professional.onboarding_completed', {
          country: 'CL',
          outcome_code: 'success',
        });
        await analytics.track('health.professional.verification_pending', {
          country: 'CL',
          verification_status: 'pending',
          outcome_code: 'success',
        });
      } catch {
        // Product analytics is deliberately non-critical for identity enrollment.
      }
      return res.status(201).json({
        identity: selfDto(identity),
        message: 'Tu identidad profesional quedó pendiente de revisión.',
      });
    } catch (error) {
      return humanError(res, error);
    }
  });

  router.get('/me', verifyAuth, limiter, async (req, res) => {
    const callerUid = req.user?.uid;
    if (!callerUid) {
      return res.status(401).json({
        error: 'authentication_required',
        message: 'Inicia sesión para consultar tu identidad profesional.',
      });
    }
    try {
      const identity = await getStore().get(callerUid);
      if (!identity) {
        return res.status(404).json({
          error: 'professional_identity_not_found',
          message: 'Aún no tienes una identidad profesional registrada.',
        });
      }
      return res.json({ identity: selfDto(identity) });
    } catch (error) {
      return humanError(res, error);
    }
  });

  router.get('/search', verifyAuth, limiter, async (req, res) => {
    if (!req.user?.uid) {
      return res.status(401).json({
        error: 'authentication_required',
        message: 'Inicia sesión para buscar un profesional.',
      });
    }
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_professional_search',
        message: 'La búsqueda profesional no es válida.',
      });
    }
    try {
      const professionals = await getStore().listPublic(parsed.data.q, parsed.data.limit);
      return res.json({ professionals });
    } catch (error) {
      return humanError(res, error);
    }
  });

  router.post('/review/:uid', verifyAuth, limiter, async (req, res) => {
    const reviewerUid = req.user?.uid;
    if (!reviewerUid) {
      return res.status(401).json({
        error: 'authentication_required',
        message: 'Inicia sesión para revisar una identidad profesional.',
      });
    }
    if (req.user?.admin !== true) {
      return res.status(403).json({
        error: 'professional_review_not_authorized',
        message: 'No tienes autorización para revisar identidades profesionales.',
      });
    }
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_professional_review',
        message: 'La referencia de revisión no es válida.',
      });
    }
    try {
      if (!(await hasWebAuthnCredential(req.params.uid))) {
        return res.status(409).json({
          error: 'professional_webauthn_required',
          message: 'El profesional debe registrar una huella o llave de seguridad antes de ser habilitado.',
        });
      }
      const identity = await getStore().approveProvisional({
        targetUid: req.params.uid,
        reviewerUid,
        evidenceReference: parsed.data.evidenceReference,
      });
      try {
        await analytics.track('health.professional.provisional_approved', {
          country: 'CL',
          verification_status: 'provisional',
          outcome_code: 'success',
        });
      } catch {
        // Audit is persisted by the store; product analytics must not block review.
      }
      return res.json({
        identity: selfDto(identity),
        message: 'La identidad quedó aprobada de forma provisional y auditada.',
      });
    } catch (error) {
      return humanError(res, error);
    }
  });

  const manageStatus = (to: 'suspended' | 'revoked') =>
    async (req: Parameters<typeof verifyAuth>[0], res: Parameters<typeof verifyAuth>[1]) => {
      const reviewerUid = req.user?.uid;
      if (!reviewerUid) {
        return res.status(401).json({
          error: 'authentication_required',
          message: 'Inicia sesiÃ³n para gestionar la identidad profesional.',
        });
      }
      if (req.user?.admin !== true) {
        return res.status(403).json({
          error: 'professional_review_not_authorized',
          message: 'No tienes autorizaciÃ³n para gestionar identidades profesionales.',
        });
      }
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: 'invalid_professional_review',
          message: 'La referencia de la decisiÃ³n no es vÃ¡lida.',
        });
      }
      try {
        const identity = await getStore().transitionStatus({
          targetUid: req.params.uid,
          reviewerUid,
          to,
          evidenceReference: parsed.data.evidenceReference,
        });
        return res.json({
          identity: selfDto(identity),
          message: to === 'suspended'
            ? 'La identidad profesional quedÃ³ suspendida y el acceso clÃ­nico fue bloqueado.'
            : 'La identidad profesional quedÃ³ revocada de forma permanente.',
        });
      } catch (error) {
        return humanError(res, error);
      }
    };

  router.post('/suspend/:uid', verifyAuth, limiter, manageStatus('suspended'));
  router.post('/revoke/:uid', verifyAuth, limiter, manageStatus('revoked'));

  router.post('/revalidate/:uid', verifyAuth, limiter, async (req, res) => {
    const reviewerUid = req.user?.uid;
    if (!reviewerUid) {
      return res.status(401).json({ error: 'authentication_required', message: 'Inicia sesiÃ³n.' });
    }
    if (req.user?.admin !== true) {
      return res.status(403).json({
        error: 'professional_review_not_authorized',
        message: 'No tienes autorizaciÃ³n para revalidar identidades profesionales.',
      });
    }
    try {
      const result = await getStore().revalidate({ targetUid: req.params.uid, reviewerUid });
      if (result.verification.status === 'not_configured' || result.verification.status === 'unavailable') {
        return res.status(503).json({
          error: result.verification.status === 'not_configured'
            ? 'official_registry_not_configured'
            : 'official_registry_unavailable',
          message: result.verification.status === 'not_configured'
            ? 'La conexión oficial con la Superintendencia de Salud aún no está habilitada. La identidad conserva su estado actual.'
            : 'La Superintendencia de Salud no está disponible. La identidad conserva su estado actual.',
        });
      }
      return res.json({
        identity: selfDto(result.identity),
        registryResult: result.verification.status,
        message: result.verification.status === 'verified'
          ? 'La identidad fue verificada mediante el registro oficial.'
          : 'El registro oficial no confirmó los antecedentes. Revisa la evidencia antes de decidir.',
      });
    } catch (error) {
      return humanError(res, error);
    }
  });

  return router;
}

export default createHealthProfessionalsRouter();
