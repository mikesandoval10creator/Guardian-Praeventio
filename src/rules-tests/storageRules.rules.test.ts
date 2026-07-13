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
  it('M-1 Fase 4: a user with NO assignedSiteIds claim is DENIED upload (fail-closed — no legacy escape hatch)', async () => {
    await assertFails(uploadBytes(r(legacy(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('M-1 Fase 4: a user with NO assignedSiteIds claim is DENIED read (was the cross-tenant leak)', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(getBytes(r(legacy(), PATH)));
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
  it('F7: a member CANNOT delete a project file (evidence lock)', async () => {
    await seed(`projects/${PID}/documents/pts.pdf`, 'application/pdf');
    await assertFails(deleteObject(r(member(), `projects/${PID}/documents/pts.pdf`)));
  });
  it('F7: even an admin-tier claim CANNOT delete a project file client-side', async () => {
    await seed(`projects/${PID}/documents/pts2.pdf`, 'application/pdf');
    await assertFails(deleteObject(r(storageOf(MEMBER, { assignedSiteIds: [PID], role: 'admin' }), `projects/${PID}/documents/pts2.pdf`)));
  });
});

describe('blueprints/{pid}/** — F7 evidence lock (no client deletes)', () => {
  it('a member can still upload a blueprint snapshot', async () => {
    await assertSucceeds(uploadBytes(r(member(), `blueprints/${PID}/plan.png`), BYTES, { contentType: 'image/png' }));
  });
  it('F7: a member CANNOT delete a blueprint snapshot', async () => {
    await seed(`blueprints/${PID}/plan2.png`, 'image/png');
    await assertFails(deleteObject(r(member(), `blueprints/${PID}/plan2.png`)));
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
  it('reconstructions delete stays member-allowed (working 3D assets, NOT F7 evidence scope — deliberate)', async () => {
    await seed(`reconstructions/${PID}/scan-old.glb`, 'model/gltf-binary');
    await assertSucceeds(deleteObject(r(member(), `reconstructions/${PID}/scan-old.glb`)));
  });
});

describe('documents/{workerId}/** — F7 evidence lock + V5 tier-gated writes', () => {
  const PATH = 'documents/worker-7/contract.pdf';

  // V5 (audit §3.2): create/update demand admin/supervisor tier — before, ANY
  // signed-in user could write into another worker's namespace. Depends on the
  // role-claims sync trigger being live (claims minted).
  it('V5: an admin-tier user can upload a worker document', async () => {
    await assertSucceeds(uploadBytes(r(storageOf(MEMBER, { role: 'admin' }), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('V5: a supervisor-tier user (prevencionista) can upload a worker document', async () => {
    await assertSucceeds(uploadBytes(r(storageOf(MEMBER, { role: 'prevencionista' }), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('V5: a worker-role user CANNOT upload (was open to any signed-in user)', async () => {
    await assertFails(uploadBytes(r(storageOf(MEMBER, { role: 'worker' }), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('V5: a signed-in user with NO role claim CANNOT upload (presence-guarded, silent deny)', async () => {
    await assertFails(uploadBytes(r(member(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('V5: an unauthenticated request cannot upload (unchanged)', async () => {
    await assertFails(uploadBytes(r(unauth(), PATH), BYTES, { contentType: 'application/pdf' }));
  });
  it('a signed-in user can read a worker document (unchanged)', async () => {
    await seed(PATH, 'application/pdf');
    await assertSucceeds(getBytes(r(member(), PATH)));
  });

  // F7 (founder decision 2026-07-02): worker documents are legal evidence —
  // client-side delete is an evidence-destruction primitive. NOBODY deletes
  // from the client, not even admin tier. (Supersedes V3's tier-gated
  // delete, which was also functionally dead: no flow mints role claims.)
  it('F7: an admin-tier claim CANNOT delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(deleteObject(r(storageOf(MEMBER, { email_verified: true, role: 'admin' }), PATH)));
  });
  it('F7: a supervisor-tier claim CANNOT delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(deleteObject(r(storageOf(MEMBER, { email_verified: true, role: 'supervisor' }), PATH)));
  });
  it('F7: a worker-role user CANNOT delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(deleteObject(r(storageOf(MEMBER, { email_verified: true, role: 'worker' }), PATH)));
  });
  it('F7: a user with no role claim CANNOT delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(deleteObject(r(storageOf(MEMBER, { email_verified: true }), PATH)));
  });
  it('F7: an unauthenticated user CANNOT delete a worker document', async () => {
    await seed(PATH, 'application/pdf');
    await assertFails(deleteObject(r(unauth(), PATH)));
  });
});

describe('workers/{uid}/** — strictly per-uid private', () => {
  it('the owner can upload to their own vault', async () => {
    await assertSucceeds(uploadBytes(r(storageOf(OWNER), `workers/${OWNER}/cert.pdf`), BYTES, { contentType: 'application/pdf' }));
  });
  // GPT audit 2026-07-12: the combined `read, write` rule gated on
  // isUnder(), which reads request.resource.size — null on a GET → the
  // owner could NOT read their own files. Read must not depend on the
  // incoming (write-only) resource.
  it('the owner can READ their own vault file', async () => {
    await seed(`workers/${OWNER}/cert.pdf`, 'application/pdf');
    await assertSucceeds(getBytes(r(storageOf(OWNER), `workers/${OWNER}/cert.pdf`)));
  });
  it('the owner can DELETE their own vault file (write split preserves delete)', async () => {
    await seed(`workers/${OWNER}/old.pdf`, 'application/pdf');
    await assertSucceeds(deleteObject(r(storageOf(OWNER), `workers/${OWNER}/old.pdf`)));
  });
  it('another user cannot read the owner vault', async () => {
    await seed(`workers/${OWNER}/cert.pdf`, 'application/pdf');
    await assertFails(getBytes(r(storageOf(OUTSIDER), `workers/${OWNER}/cert.pdf`)));
  });
  it('another user cannot upload into the owner vault', async () => {
    await assertFails(uploadBytes(r(storageOf(OUTSIDER), `workers/${OWNER}/hack.pdf`), BYTES, { contentType: 'application/pdf' }));
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
