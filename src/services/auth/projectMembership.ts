// Praeventio Guard — server-side project membership enforcement.
//
// Round 14 (A5 audit) — Several Express routes accepted a `projectId` from
// req.body and mutated /projects/{id}/... without verifying the caller was
// a member of that project. firestore.rules enforced this for client-side
// reads, but server endpoints use the Admin SDK which BYPASSES rules. This
// helper restores parity: routes that take a projectId must call
// `assertProjectMember(uid, projectId)` before touching the project's data.
//
// Design:
//
//   • Pure dependency injection: takes a `MinimalProjectsDb` rather than
//     reaching for `admin.firestore()` itself. Keeps the helper unit-testable
//     without needing a global firebase-admin mock and lets server.ts pass
//     `admin.firestore()` at the call site.
//
//   • Throws a domain-specific `ProjectMembershipError` with `httpStatus =
//     403`. Routes can `instanceof`-check and return the exact status,
//     while a Firestore outage will surface as a different (5xx-mapped)
//     thrown error — we do NOT catch-and-deny on infra failures because
//     that would mask alerts.
//
//   • A user qualifies as a "member" if their uid appears in `members[]`
//     OR matches `createdBy`. The latter handles freshly-created projects
//     where the creator hasn't been written into members[] yet (server
//     code initializes `members` lazily in some flows — A5 documented this).

/**
 * The minimal Firestore-shaped read API we need. `admin.firestore()` is
 * structurally compatible; tests inject an in-memory fake.
 */
export interface MinimalProjectsDb {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{
        exists: boolean;
        data(): any;
      }>;
    };
  };
}

/**
 * Thrown when the caller is not a member of the requested project. Routes
 * should `if (err instanceof ProjectMembershipError)` and respond with
 * `err.httpStatus` (always 403).
 */
export class ProjectMembershipError extends Error {
  readonly httpStatus = 403 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ProjectMembershipError';
  }
}

/**
 * Throws `ProjectMembershipError` if the project doc doesn't exist, or if
 * `callerUid` is neither in `members[]` nor matches `createdBy`. Resolves
 * with `void` on success.
 *
 * Firestore errors (network, permissions) are NOT swallowed — they
 * propagate out so the caller's error handler can map them to 5xx.
 */
export async function assertProjectMember(
  callerUid: string,
  projectId: string,
  db: MinimalProjectsDb,
): Promise<void> {
  const snap = await db.collection('projects').doc(projectId).get();
  if (!snap.exists) {
    throw new ProjectMembershipError(
      `Project ${projectId} not found or caller is not a member`,
    );
  }
  const data = snap.data() ?? {};
  const members: unknown = data.members;
  const createdBy: unknown = data.createdBy;

  const inMembers = Array.isArray(members) && members.includes(callerUid);
  const isCreator = typeof createdBy === 'string' && createdBy === callerUid;
  if (!inMembers && !isCreator) {
    throw new ProjectMembershipError(
      `Caller ${callerUid} is not a member of project ${projectId}`,
    );
  }
}
