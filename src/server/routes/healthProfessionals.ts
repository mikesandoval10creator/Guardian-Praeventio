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
import { verifyAuth } from '../middleware/verifyAuth.js';
import { logger } from '../../utils/logger.js';

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
  logger.error('health_professional_route_failed', error instanceof Error ? error : new Error(String(error)));
  return res.status(503).json({
    error: 'professional_service_unavailable',
    message: 'No pudimos completar la verificación profesional. Intenta nuevamente más tarde.',
  });
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
    async createUnique(identity) {
      return db.runTransaction(async (transaction) => {
        const identityRef = identities.doc(identity.uid);
        const indexRef = indexes.doc(identity.rutLookupHmac);
        const [identitySnapshot, indexSnapshot] = await Promise.all([
          transaction.get(identityRef),
          transaction.get(indexRef),
        ]);
        if (identitySnapshot.exists) return 'uid_conflict' as const;
        if (indexSnapshot.exists) return 'rut_conflict' as const;
        transaction.set(identityRef, identity);
        transaction.set(indexRef, { uid: identity.uid, createdAt: identity.createdAt });
        return 'created' as const;
      });
    },
    async replaceWithAudit(identity, auditEntry) {
      await db.runTransaction(async (transaction) => {
        transaction.set(identities.doc(identity.uid), identity);
        transaction.set(audits.doc(), auditEntry);
      });
    },
    async listEligible(limit) {
      const snapshot = await identities
        .where('status', 'in', ['provisional', 'verified'])
        .limit(limit)
        .get();
      return snapshot.docs.map((doc) => doc.data() as HealthProfessionalIdentity);
    },
  };
}

function defaultStore(): ProfessionalStore {
  return createHealthProfessionalIdentityStore({
    repository: createFirestoreProfessionalIdentityRepository(admin.firestore()),
    kmsAdapter: getKmsAdapter(),
    lookupKey: process.env.HEALTH_PROFESSIONAL_LOOKUP_KEY,
  });
}

export function createHealthProfessionalsRouter(deps?: { store: ProfessionalStore }) {
  const router = Router();
  const getStore = () => deps?.store ?? defaultStore();

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
      const identity = await getStore().approveProvisional({
        targetUid: req.params.uid,
        reviewerUid,
        evidenceReference: parsed.data.evidenceReference,
      });
      return res.json({
        identity: selfDto(identity),
        message: 'La identidad quedó aprobada de forma provisional y auditada.',
      });
    } catch (error) {
      return humanError(res, error);
    }
  });

  return router;
}

export default createHealthProfessionalsRouter();
