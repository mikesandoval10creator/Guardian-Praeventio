// Praeventio Guard — Bloque E3 (server-side writes + audit).
//
// Normatives seeding moved from the client to an audited server endpoint,
// mirroring E1 (workers archive, PR #1212). The Normatives page used to
// `addDoc` the baseline legal-library metadata straight from the browser: the
// write was permitted by firestore.rules (`allow write: if isAdmin()`, an
// unforgeable claim check) but NO `audit_logs` row was ever written — a
// violation of the audit-log invariant (CLAUDE.md #3). Every state-changing
// operation must leave an audit trail; a legal-corpus mutation is exactly the
// kind of change auditors ask about.
//
// This endpoint is the audited path the UI now calls:
//   • POST /api/normatives/seed   (verifyAuth + admin role)
//
// Authorization: the caller must carry an admin/gerente custom claim, mirroring
// firestore.rules' `isAdmin()` write gate for `normatives/{id}`. The identity is
// read from the VERIFIED token (`req.user` / Admin Auth), never from the body.
//
// The seed is IDEMPOTENT: an existing normative (matched by `code`) is left
// untouched, so re-running is safe. Only newly-created codes are written and
// counted. The normative payload is PUBLIC Chilean/international regulation
// (Ley 16.744, DS 594, DS 44/2024, …) — no PII, nothing sent to an external
// API from here.

import { Router } from 'express';
import admin from 'firebase-admin';

import { verifyAuth } from '../middleware/verifyAuth.js';
import { auditServerEvent } from '../middleware/auditLog.js';
import { isAdminRole } from '../../types/roles.js';
import { logger } from '../../utils/logger.js';
import { getErrorTracker } from '../../services/observability/index.js';

function sentryCapture(
  err: unknown,
  context: { endpoint?: string; trigger?: string; tags?: Record<string, string | number | boolean | null | undefined> },
): void {
  try {
    getErrorTracker().captureException(
      err instanceof Error ? err : new Error(String(err)),
      context as never,
    );
  } catch (e) {
    logger.warn?.('observability_capture_failed', { message: (e as Error)?.message });
  }
}

/**
 * Baseline legal-library metadata for the Normatives UI listing. This is the
 * same public corpus the client previously seeded inline — moved server-side so
 * the write is audited and the identity is server-stamped. `lastReview` is
 * stamped server-side at write time (ISO string).
 */
interface SeedNormative {
  title: string;
  code: string;
  category: string;
  description: string;
}

const BASELINE_NORMATIVES: readonly SeedNormative[] = [
  {
    title: 'Ley 16.744: Seguro Social contra Riesgos de Accidentes del Trabajo y Enfermedades Profesionales',
    code: 'Ley 16.744',
    category: 'Seguridad Social',
    description:
      'Establece normas sobre accidentes del trabajo y enfermedades profesionales. Es la piedra angular de la seguridad laboral en Chile.',
  },
  {
    title: 'Decreto Supremo 594: Reglamento sobre Condiciones Sanitarias y Ambientales Básicas en los Lugares de Trabajo',
    code: 'DS 594',
    category: 'Higiene y Salud',
    description:
      'Establece las condiciones sanitarias y ambientales básicas que debe cumplir todo lugar de trabajo.',
  },
  {
    title: 'Decreto Supremo 44/2024: Reglamento sobre Prevención de Riesgos Profesionales (reemplaza al DS 40/1969, derogado 01-02-2025)',
    code: 'DS 44/2024',
    category: 'Prevención',
    description:
      'Establece normas sobre la organización y funcionamiento de los Departamentos de Prevención de Riesgos. Reemplaza al DS 40/1969 (derogado).',
  },
  {
    title: 'Decreto Supremo 44/2024: Constitución y Funcionamiento de los Comités Paritarios de Higiene y Seguridad (ex DS 54/1969, derogado 01-02-2025)',
    code: 'DS 44/2024',
    category: 'Comités Paritarios',
    description:
      'Regula la formación y funciones de los Comités Paritarios en empresas con más de 25 trabajadores. Materia antes regida por el DS 54/1969, derogado por el DS 44/2024.',
  },
  {
    title: 'Decreto Supremo 18: Certificación de Calidad de Elementos de Protección Personal contra Riesgos Ocupacionales',
    code: 'DS 18',
    category: 'EPP',
    description:
      'Establece normas sobre la certificación de calidad de los EPP comercializados en el país.',
  },
  {
    title: 'Ley 21.096: Consagra el Derecho a la Protección de Datos Personales',
    code: 'Ley 21.096',
    category: 'Privacidad',
    description:
      'Regula el tratamiento de datos personales y crea la Agencia de Protección de Datos.',
  },
  {
    title: 'Ley 20.123: Regula Trabajo en Régimen de Subcontratación',
    code: 'Ley 20.123',
    category: 'Subcontratación',
    description:
      'Establece las responsabilidades de la empresa principal en materia de seguridad y salud para trabajadores subcontratados.',
  },
] as const;

const normativesRouter = Router();

// POST /api/normatives/seed — audited, idempotent baseline seed.
normativesRouter.post('/seed', verifyAuth, async (req, res) => {
  const callerUid = req.user!.uid;

  try {
    // Mirror firestore.rules `isAdmin()` write gate — the role comes from the
    // verified token's custom claims, never the request body.
    const callerRecord = await admin.auth().getUser(callerUid);
    if (!isAdminRole(callerRecord.customClaims?.role)) {
      return res
        .status(403)
        .json({ error: 'Forbidden: Requires admin role to seed normatives' });
    }

    const db = admin.firestore();
    const nowIso = new Date().toISOString();
    const createdCodes: string[] = [];

    // Idempotent write: skip any code that already exists.
    for (const norm of BASELINE_NORMATIVES) {
      const existing = await db
        .collection('normatives')
        .where('code', '==', norm.code)
        .limit(1)
        .get();
      if (!existing.empty) continue;

      await db.collection('normatives').add({
        title: norm.title,
        code: norm.code,
        category: norm.category,
        description: norm.description,
        status: 'active',
        lastReview: nowIso,
        // Provenance — server-stamped from the verified token.
        seededBy: callerUid,
        seededAt: nowIso,
      });
      createdCodes.push(norm.code);
    }

    // CLAUDE.md #3/#14 — audit the state change. A failure here is severe but
    // must never convert a successful seed into a 5xx.
    try {
      await auditServerEvent(req, 'normatives.seed', 'normatives', {
        createdCount: createdCodes.length,
        createdCodes,
        totalBaseline: BASELINE_NORMATIVES.length,
      });
    } catch (auditErr) {
      logger.error('audit_event_failed', {
        action: 'normatives.seed',
        uid: callerUid,
        err: auditErr instanceof Error ? auditErr.message : String(auditErr),
      });
      sentryCapture(auditErr, {
        endpoint: 'POST /api/normatives/seed',
        trigger: 'audit',
        tags: { uid: callerUid },
      });
    }

    return res.json({
      success: true,
      created: createdCodes.length,
      createdCodes,
    });
  } catch (error: any) {
    logger.error('normatives_seed_failed', { uid: callerUid, err: error?.message });
    sentryCapture(error, { endpoint: 'POST /api/normatives/seed', tags: { uid: callerUid } });
    return res.status(500).json({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error?.message,
    });
  }
});

export default normativesRouter;
export { BASELINE_NORMATIVES };
