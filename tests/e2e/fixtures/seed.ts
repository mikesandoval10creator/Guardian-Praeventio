// Praeventio Guard — Sprint 19 / F-B03.
//
// Helpers para sembrar datos en el Firestore Emulator antes de un spec E2E.
// Por contrato del proyecto los integration tests usan Firestore REAL (vía
// emulator), no mocks — esto mantiene el ramp-up fiel al runtime.
//
// Pre-requisitos del entorno (típicamente seteados por la fixture de
// playwright o el CI):
//   - `FIRESTORE_EMULATOR_HOST=localhost:8080`  (firebase-admin lo detecta)
//   - `GOOGLE_CLOUD_PROJECT=demo-test`         (cualquier id; emulator no
//                                                valida credenciales)
//   - `FIREBASE_AUTH_EMULATOR_HOST=localhost:9099` (opcional, solo si el
//                                                  spec usa Auth)
//
// Producción jamás usa estos archivos: viven bajo `tests/e2e/`.

import admin from 'firebase-admin';

let initialized = false;

function ensureAdmin(): admin.app.App {
  if (initialized) return admin.app();
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error(
      'seed.ts: FIRESTORE_EMULATOR_HOST is not set. Start the emulator and export it before seeding.',
    );
  }
  // Set a dummy project id if the runner did not — the emulator accepts any
  // value, but firebase-admin still requires the field to be defined.
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    process.env.GOOGLE_CLOUD_PROJECT = 'demo-test';
  }
  admin.initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  initialized = true;
  return admin.app();
}

export interface SeedProjectOptions {
  /** Display name for the project document. Defaults to `E2E Project`. */
  projectName?: string;
  /** Crew name to attach. Defaults to `Cuadrilla Alpha`. */
  crewName?: string;
  /** UID of the supervisor user (must match the E2E test user). */
  supervisorUid?: string;
  /** Tenant id; should match the E2E test user. */
  tenantId?: string;
  /** Optional latitude/longitude to populate `location`. */
  location?: { lat: number; lng: number; altitude?: number };
  /**
   * Seed the project with a DECLARED emergency (`isEmergencyActive: true`).
   * The worker-facing SOSButton (RootLayout, global) renders ONLY when
   * AppMode === 'emergency'; the `/emergency` page mirrors this flag into
   * AppMode via `resolveEmergencyModeTransition`. Without it the SOS button
   * never appears, so the SOS E2E cannot exercise the real long-press path.
   * Defaults to `false` (the historical seed shape).
   */
  emergencyActive?: boolean;
  /**
   * Optional `phone` field on the project doc. The SOSButton's zero-reach
   * fallback (`delivered === false` — the normal case in the E2E harness,
   * which has no registered FCM devices and no email service) dials
   * `tel:${project.phone}`. Seed a number to exercise that real fallback.
   */
  phone?: string;
}

export interface SeededProject {
  /** The Firestore-generated project id. */
  projectId: string;
  /** The Firestore-generated crew id. */
  crewId: string;
  /** Cleanup the docs created by this seed call. */
  cleanup: () => Promise<void>;
}

/**
 * Create a Firestore-emulator project with one crew. Returns the generated
 * ids plus a cleanup callback the spec should call from `afterEach`.
 */
export async function seedProject(
  options: SeedProjectOptions = {},
): Promise<SeededProject> {
  ensureAdmin();
  const db = admin.firestore();

  // §2.19 fix (2026-05-21) — `members: [supervisorUid]` requerido por
  // `ProjectContext.tsx:247` que filtra `where('members','array-contains',
  // user.uid)` para non-admin users. Sin esto, `selectedProject` queda
  // null en E2E aunque el doc se haya seedeado, y la UI rendera estado
  // "sin proyecto" en lugar del flujo testeado.
  const supervisorUid = options.supervisorUid ?? 'e2e-user-001';
  const projectRef = db.collection('projects').doc();
  await projectRef.set({
    name: options.projectName ?? 'E2E Project',
    tenantId: options.tenantId ?? 'e2e-tenant',
    supervisorUid,
    // Mirror the real create path (`POST /api/projects` stamps
    // `createdBy: callerUid`): without it, `callerCanManageProject`
    // (projects.ts) 403s the seeded supervisor on management routes such as
    // worker archive, even though they own the project.
    createdBy: supervisorUid,
    members: [supervisorUid],
    location: options.location ?? null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    isEmergencyActive: options.emergencyActive ?? false,
    ...(options.phone !== undefined ? { phone: options.phone } : {}),
  });

  // CuadrillasDashboard reads the TOP-LEVEL `crews` collection filtered by
  // `projectId` (firestore.rules: `allow read: if isProjectMember(resource.data
  // .projectId)`; server-only writes). The seed crew must live there — NOT the
  // project subcollection — with the same shape the server writes (organic.ts):
  // projectId + memberUids + xp + gamification counters, so the dashboard renders
  // it (memberUids.length, xp, daysWithoutIncident…) and auto-selects it, exposing
  // the "Iniciar proceso" button the process-lifecycle spec drives.
  const crewRef = db.collection('crews').doc();
  await crewRef.set({
    projectId: projectRef.id,
    name: options.crewName ?? 'Cuadrilla Alpha',
    supervisorUid,
    memberUids: [supervisorUid],
    xp: 0,
    daysWithoutIncident: 0,
    totalProcessesCompleted: 0,
    workerCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const cleanup = async (): Promise<void> => {
    await crewRef.delete();
    await projectRef.delete();
  };

  return { projectId: projectRef.id, crewId: crewRef.id, cleanup };
}

/**
 * Tear down ALL projects created by the emulator session — used in
 * `globalTeardown` for a fresh slate. Skips silently if no docs.
 */
export async function clearAllProjects(): Promise<void> {
  ensureAdmin();
  const db = admin.firestore();
  const snap = await db.collection('projects').get();
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}

export interface SeededZone {
  /** The restricted-zone id (also the Firestore doc id). */
  zoneId: string;
  /** Cleanup the zone doc created by this seed call. */
  cleanup: () => Promise<void>;
}

/**
 * Seed a `restricted_zones` doc under the SAME tenant/project path the audited
 * `/api/zones/by-site` + `/api/zones/entry-event` routes read/write
 * (`tenants/{tenantId}/projects/{projectId}/restricted_zones/{zoneId}` — see
 * `src/server/routes/restrictedZones.ts` zonesCollection). Defaults describe a
 * HOT-WORK zone whose EPP/training requirements a worker won't meet, so the
 * informed-entry engine returns `allowed: false` — which lets the E2E prove the
 * founder no-blocking invariant: the entry is NEVER blocked but ALWAYS recorded.
 */
export async function seedRestrictedZone(
  projectId: string,
  options: {
    tenantId?: string;
    zoneId?: string;
    name?: string;
    kind?: string;
    requiredEpp?: string[];
    requiredTrainings?: string[];
    responsibleUid?: string;
  } = {},
): Promise<SeededZone> {
  ensureAdmin();
  const db = admin.firestore();
  const tenantId = options.tenantId ?? 'e2e-tenant';
  const zoneId = options.zoneId ?? 'e2e-hot-zone';
  const zoneRef = db
    .collection('tenants')
    .doc(tenantId)
    .collection('projects')
    .doc(projectId)
    .collection('restricted_zones')
    .doc(zoneId);
  await zoneRef.set({
    id: zoneId,
    kind: options.kind ?? 'hot',
    name: options.name ?? 'Zona Caliente E2E',
    // No `perimeter`: it's optional in the zone schema, the informed-entry flow
    // doesn't use it (only the map overlay does), and Firestore forbids the
    // nested-array shape `[[lng,lat], ...]` the polygon would need.
    rules: {
      requiredEpp: options.requiredEpp ?? ['Casco de seguridad'],
      requiredTrainings: options.requiredTrainings ?? ['Trabajo en Caliente'],
      responsibleUid: options.responsibleUid ?? 'e2e-user-001',
    },
    activeFrom: '2020-01-01T00:00:00.000Z',
  });

  return {
    zoneId,
    cleanup: async (): Promise<void> => {
      await zoneRef.delete();
    },
  };
}
