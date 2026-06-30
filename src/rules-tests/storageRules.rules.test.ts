// SPDX-License-Identifier: MIT
//
// Phase 5 · Cloud Storage rules — REAL upload paths (storage.rules rewrite).
//
// Every client uploader was writing to paths that matched NO rule → all
// uploads fell to default-deny (file upload broken app-wide). This suite pins
// the rewritten storage.rules over the REAL paths, gated by the `assignedSiteIds`
// claim (the app's actual, populated membership claim — storage rules cannot
// read Firestore, so tenant-claim gating was not viable; see storage.rules
// header). Runs against the Storage emulator (firebase.json :9199) via
// `npm run test:rules` (which boots `--only firestore,storage`).

import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const PROJECT_ID = 'praeventio-storage-test';
const PID = 'site-1';
const OTHER_PID = 'site-2';
const MEMBER = 'member-uid-1';
const LEGACY = 'legacy-uid-1'; // no assignedSiteIds claim
const OUTSIDER = 'outsider-uid-9';
const OWNER = 'owner-uid-1';

const BYTES = new Uint8Array([1, 2, 3, 4]);

let testEnv: RulesTestEnvironment | null = null;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: { rules: readFileSync(resolve(__dirname, '../../storage.rules'), 'utf8') },
  });
});
afterAll(async () => {
  if (testEnv) await testEnv.cleanup();
});
function requireEnv(): RulesTestEnvironment {
  if (!testEnv) throw new Error('storage testEnv not initialized');
  return testEnv;
}
beforeEach(async () => {
  await requireEnv().clearStorage();
});

// Verified-email token; `assignedSiteIds` mirrors the real membership claim.
function tok(extra: Record<string, unknown> = {}) {
  return { email_verified: true, ...extra };
}
type CtxStorage = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['storage']>;
function storageOf(uid: string, claims: Record<string, unknown> = {}): CtxStorage {
  return requireEnv().authenticatedContext(uid, tok(claims)).storage();
}
function unauth(): CtxStorage {
  return requireEnv().unauthenticatedContext().storage();
}
function r(s: CtxStorage, path: string) {
  return ref(s as unknown as Parameters<typeof ref>[0], path);
}
async function seed(path: string, contentType: string) {
  await requireEnv().withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage() as unknown as Parameters<typeof ref>[0], path), BYTES, { contentType });
  });
}

// A claim-bearing member of PID.
const member = () => storageOf(MEMBER, { assignedSiteIds: [PID] });
// A claim-bearing user assigned ONLY to OTHER_PID.
const outsider = () => storageOf(OUTSIDER, { assignedSiteIds: [OTHER_PID] });
// A legacy user with NO assignedSiteIds claim.
const legacy = () => storageOf(LEGACY);

describe('projects/{pid}/** — assignedSiteIds-gated', () => {
  const PATH = `projects/${PID}/documents/doc.pdf`;

  it('a claim-bearing member can UPLOAD a PDF', async () => {
    await assertSucceeds(uploadBytes(r(member(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('a claim-bearing member can READ', async () => {
    await seed(PATH, 'application/pdf');
    await assertSucceeds(getBytes(r(member(), PATH)));
  });
  it('a user assigned to ANOTHER site CANNOT upload (isolation)', async () => {
    await assertFails(uploadBytes(r(outsider(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('a user assigned to ANOTHER site CANNOT read', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(getBytes(r(outsider(), PATH)));
  });
  it('a LEGACY user (no assignedSiteIds claim) can still upload (compat fallback)', async () => {
    await assertSucceeds(uploadBytes(r(legacy(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('an UNAUTHENTICATED request cannot upload', async () => {
    await assertFails(uploadBytes(r(unauth(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('a member can upload AUDIO (CrisisChat voice note)', async () => {
    await assertSucceeds(uploadBytes(r(member(), `projects/${PID}/audio/note.webm`), BYTES, { contentType: 'audio/webm' }));
  });
  it('a disallowed content type (executable) is rejected', async () => {
    await assertFails(uploadBytes(r(member(), `projects/${PID}/documents/x.exe`), BYTES, { contentType: 'application/x-msdownload' }));
  });
});

describe('suseso_reports/{pid}/** — PDF-only, immutable', () => {
  const PATH = `suseso_reports/${PID}/diat.pdf`;

  it('a member can upload a SUSESO PDF', async () => {
    await assertSucceeds(uploadBytes(r(member(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('a non-PDF is rejected', async () => {
    await assertFails(uploadBytes(r(member(), `suseso_reports/${PID}/x.png`), BYTES, { contentType: 'image/png' }));
  });
  it('an existing report cannot be overwritten or deleted (immutable)', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(uploadBytes(r(member(), PATH), BYTES, { contentType: 'application/pdf' }));
    await assertFails(deleteObject(r(member(), PATH)));
  });
});

describe('reconstructions/{pid}/** — binary 3D models', () => {
  it('a member can upload an octet-stream GLB', async () => {
    await assertSucceeds(uploadBytes(r(member(), `reconstructions/${PID}/scan.glb`), BYTES, { contentType: 'application/octet-stream' }));
  });
  it('an outsider cannot upload a model', async () => {
    await assertFails(uploadBytes(r(outsider(), `reconstructions/${PID}/scan.glb`), BYTES, { contentType: 'application/octet-stream' }));
  });
  // V4 hardening (2026-06-22): isAllowedUpload() is now required.
  // Verify the 3D content-types that triggered the original skip comment
  // continue to work (isAllowedUpload covers model/* and octet-stream).
  it('V4: member can upload a model/gltf-binary (GLB explicit MIME)', async () => {
    await assertSucceeds(uploadBytes(r(member(), `reconstructions/${PID}/scene.glb`), BYTES, { contentType: 'model/gltf-binary' }));
  });
  it('V4: member can upload a model/vnd.usdz+zip (USDZ explicit MIME)', async () => {
    await assertSucceeds(uploadBytes(r(member(), `reconstructions/${PID}/scene.usdz`), BYTES, { contentType: 'model/vnd.usdz+zip' }));
  });
  it('V4: arbitrary disallowed content-type is now REJECTED (application/x-msdownload)', async () => {
    // Before V4 this would have SUCCEEDED (no isAllowedUpload check). After V4 it must FAIL.
    await assertFails(uploadBytes(r(member(), `reconstructions/${PID}/exploit.exe`), BYTES, { contentType: 'application/x-msdownload' }));
  });
  it('V4: unauthenticated upload is denied', async () => {
    await assertFails(uploadBytes(r(unauth(), `reconstructions/${PID}/scan.glb`), BYTES, { contentType: 'application/octet-stream' }));
  });
});

describe('documents/{workerId}/** — V3 hardening (delete requires admin/supervisor tier)', () => {
  const PATH = 'documents/worker-7/contract.pdf';

  // Upload / read behavior unchanged.
  it('any signed-in user can upload a worker document (unchanged)', async () => {
    await assertSucceeds(uploadBytes(r(member(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('an unauthenticated request cannot upload (unchanged)', async () => {
    await assertFails(uploadBytes(r(unauth(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('a signed-in user can read a worker document (unchanged)', async () => {
    await seed(PATH, 'application/pdf');
    await assertSucceeds(getBytes(r(member(), PATH)));
  });

  // V3: delete is now gated on admin/supervisor tier role claim.
  it('V3: admin-tier user can delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    // admin role in token claim — matches isAdminOrSupervisorTier()
    await assertSucceeds(deleteObject(r(storageOf(MEMBER, { email_verified: true, role: 'admin' }), PATH)));
  });
  it('V3: supervisor-tier user can delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    await assertSucceeds(deleteObject(r(storageOf(MEMBER, { email_verified: true, role: 'supervisor' }), PATH)));
  });
  it('V3: worker-role user CANNOT delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    // worker role — below supervisor tier, denied by isAdminOrSupervisorTier()
    await assertFails(deleteObject(r(storageOf(MEMBER, { email_verified: true, role: 'worker' }), PATH)));
  });
  it('V3: unauthenticated user CANNOT delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(deleteObject(r(unauth(), PATH)));
  });
  it('V3: user with no role claim CANNOT delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    // email_verified but no role claim — isAdminOrSupervisorTier() requires role in list
    await assertFails(deleteObject(r(storageOf(MEMBER, { email_verified: true }), PATH)));
  });
});

describe('workers/{uid}/** — strictly per-uid private', () => {
  it('the owner can upload to their own vault', async () => {
    await assertSucceeds(uploadBytes(r(storageOf(OWNER), `workers/${OWNER}/cert.pdf`), BYTES, { contentType: 'application/pdf' }));
  });
  it('another user cannot read the owner vault', async () => {
    await seed(`workers/${OWNER}/cert.pdf`, 'application/pdf');
    await assertFails(getBytes(r(storageOf(OUTSIDER), `workers/${OWNER}/cert.pdf`)));
  });
});

describe('default-deny — unknown paths', () => {
  it('an unmatched top-level path is denied even for a member', async () => {
    await assertFails(uploadBytes(r(member(), 'random_bucket/x.pdf'), BYTES, { contentType: 'application/pdf' }));
  });
  it('the dead aspirational tenants/ scheme is now denied', async () => {
    await assertFails(uploadBytes(r(member(), `tenants/${PID}/general/x.pdf`), BYTES, { contentType: 'application/pdf' }));
  });
});
