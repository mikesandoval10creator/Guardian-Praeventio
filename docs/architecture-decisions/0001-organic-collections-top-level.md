# ADR 0001 — Organic collections live at the Firestore root

* **Status:** Accepted (Sprint 15)
* **Date:** 2026-04-28
* **Deciders:** Sprint 15 organic-structure working group
* **Re-affirmed:** Sprint 16 (this document)

## Context

Sprint 15 introduced an organic planning model: every Project hosts one
or more Crews; every Crew runs zero or more Processes; every Process
contains zero or more Tasks. We had to pick a placement for these new
collections in Firestore.

The two candidate shapes were:

1. **Top-level**, mirroring the existing `projects/{projectId}` shape:

   ```
   crews/{crewId}        (carries projectId)
   processes/{processId} (carries projectId, crewId)
   tasks/{taskId}        (carries projectId, crewId, processId)
   ```

2. **Tenant-nested** under a new `tenants/{tenantId}` root:

   ```
   tenants/{tid}/crews/{crewId}
   tenants/{tid}/processes/{processId}
   tenants/{tid}/tasks/{taskId}
   ```

## Decision

Adopt option **(1) top-level**. Each document carries an explicit
`projectId` field; security rules use
`isProjectMember(resource.data.projectId)` to gate reads. Writes for
`crews` and `processes` are **server-only** (Admin SDK via
`/api/crews`, `/api/processes`, `/api/processes/:id/close`,
`/api/processes/:id/status`) so the positive-only XP economy is
unforgeable. `tasks` allow project-member writes constrained by a
closed key set + a 3-step status pipeline.

## Rationale

* **Convention preserved.** `projects/{id}` already lives at the root.
  Top-level placement matches the existing shape and avoids a
  duplicate concept of "tenant" that would confuse rule helpers
  (`isProjectMember`, `isAdmin`).
* **Simpler queries.** A worker's "all my active processes across
  projects" view is one `where('crewId','in',...)` query at the root,
  not N nested reads.
* **Rules already there.** `firestore.rules` ships
  `match /crews/{crewId}` / `match /processes/{processId}` /
  `match /tasks/{taskId}` blocks. Migrating to a nested shape would
  require regenerating every existing client subscription path + a
  one-off Firestore migration, neither of which buys correctness.
* **Server is single writer for crews/processes.** Because the only
  legitimate writer is the Admin SDK (which bypasses rules), the
  flat-vs-nested choice is a read-side decision. Reads are gated by
  the same `projectId` field either way.

## Consequences

* **Cross-project listings need composite indexes** on `projectId` for
  hot queries. We accept that cost — Firestore creates these on first
  query and caches indefinitely.
* **No tenant root, ever.** If multi-tenancy lands later it must be
  modeled at the project level (e.g. `projects.tenantId`), not by
  re-rooting the organic tree.
* **`isProjectMember(resource.data.projectId)` is load-bearing.** The
  `projectId` field cannot be missing from any document; rules tests
  in `src/rules-tests/firestore.rules.test.ts` pin this contract for
  crews / processes / tasks (Sprint 16 R6 block).

## Alternatives considered

* **Tenant-nested.** Rejected — see Rationale.
* **Sub-collections under projects** (`projects/{p}/crews/{c}/...`).
  Rejected because Firestore sub-collections require a separate
  indexing pass for each `projects/*` parent and break our existing
  flat `useFirestoreCollection('crews', ...)` hook contract used by
  `GanttProjectView`.

## References

* `firestore.rules` lines 699–730 (crews/processes/tasks blocks).
* `src/services/organic/{crewService,processService,taskService}.ts`.
* `src/server/routes/organic.ts` (write-side endpoints).
