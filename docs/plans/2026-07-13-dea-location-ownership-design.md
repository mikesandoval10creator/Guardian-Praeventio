# Public DEA Location Ownership Hardening

## Context

`dea_locations/{id}` is the public, sanitized registry consumed by the
anonymous DEA finder. A person responding to a cardiorespiratory arrest must
be able to discover the nearest DEA without signing in and regardless of which
project published it. That universal read path is a life-safety invariant.

The current write rule authorizes updates using only the incoming
`projectId`. A member of project B who knows the document id of a DEA owned by
project A can submit a replacement whose `projectId` is B. The rule then checks
membership in B and accepts the write, transferring control of the public
record. Deletion is also allowed to any member that passes the broad
`isProjectMember(existing().projectId)` helper.

The existing emulator suite proves anonymous read, member create, schema
validation, and member delete, but it does not exercise cross-project update,
owner immutability, management roles, or the global-role membership shortcut.

## Goals

- Preserve anonymous read access to every public DEA location.
- Preserve publication by a person directly associated with the owning
  project.
- Make `projectId` immutable after creation.
- Authorize update and delete only when the caller is directly associated with
  the existing owner project and has an approved management role.
- Express the authorization matrix as executable Firestore Emulator tests and
  security documentation.
- Keep this change limited to the existing collection, schema, and client flow.

## Non-goals

- Do not require login, subscription, project membership, or a paid tier to
  read or use the DEA finder.
- Do not move the existing registration flow to a new server route.
- Do not add personal identity fields to the public document.
- Do not change the sanitized public schema or the project-scoped DEA master
  record.
- Do not remove update or delete capability.

## Authorization model

### Public read

`allow read: if true` remains unchanged. This includes unauthenticated users,
members of unrelated projects, and people with no Guardian account.

### Direct project association

Add a narrowly named helper for public resources whose ownership is a project:

- the caller is email-verified; and
- the caller UID is present in `projects/{projectId}.members`, or the caller UID
  equals `projects/{projectId}.createdBy`.

This helper deliberately excludes the global admin/supervisor shortcut embedded
in `isProjectMember`. A global role alone must not imply association with every
project in the database.

### Create

A directly associated project member or project creator may publish a valid
sanitized DEA location for that project. This preserves the current
life-safety registration capability while preventing a globally privileged but
unassociated account from publishing on behalf of another project.

### Update

An update is accepted only when all of the following are true:

1. the caller is directly associated with `existing().projectId`;
2. the caller has one of `admin`, `gerente`, `supervisor`, `prevencionista`,
   `director_obra`, or `medico_ocupacional` through the existing trusted role
   helpers;
3. `incoming().projectId == existing().projectId`;
4. the complete incoming document passes `isValidDeaLocation`.

Authorization is evaluated from the existing owner before considering incoming
data, so a payload cannot choose the project whose membership is checked.

### Delete

Deletion requires the same direct association and management role, evaluated
against `existing().projectId`. A regular worker can publish a DEA but cannot
remove a public emergency resource.

## Data flow and failure behavior

The current registration flow continues to write the project DEA master first
and then best-effort mirrors its sanitized fields to `dea_locations`. No new
network hop, endpoint, collection, or offline dependency is introduced.

Denied update/delete attempts fail at Firestore Rules before data changes. The
anonymous finder remains read-only and cannot observe authorization details.
Because this PR adds no legitimate state-changing application operation, it
does not introduce a new `audit_logs` writer; the authorization decision is
instead made reviewable through rule comments, emulator tests, and
`security_spec.md`. If a management UI for public DEA edits is added later, it
must use an audited server route rather than adding another unaudited client
mutation.

## Test design

Extend `src/rules-tests/deaLocations.rules.test.ts` using two projects and
distinct worker/supervisor identities. The real Firestore Emulator must prove:

- anonymous users still read the public map;
- a directly associated worker can create a valid location;
- an unrelated worker cannot publish for another project;
- a project-B worker cannot update an A-owned location by changing ownership
  to B;
- a project-B supervisor cannot update or delete A's location solely because
  of a privileged global role;
- an A worker cannot update or delete A's public location;
- an A supervisor can update valid public fields while retaining project A;
- an A supervisor cannot change `projectId` to B;
- an A supervisor can delete A's public location;
- malformed and PII-bearing documents remain rejected.

The new takeover and role tests must be observed failing against the current
rules before production rules change, then passing after the minimum rule
hardening.

## Documentation and audit evidence

- Update the `dea_locations` rule comment with the universal-read and
  existing-owner authorization invariants.
- Extend the public DEA section of `security_spec.md` with project takeover,
  global-role shortcut, worker deletion, and owner-mutation rejected payloads.
- Update `TODO.md` only if it already tracks this exact finding; otherwise the
  Notion task and versioned design/plan remain the task record.
- Record exact emulator, lint, typecheck, and build commands in the PR and
  Notion task.

## Acceptance criteria

- A person without an account can still read every `dea_locations` document.
- A member of project B cannot update or delete a location owned by project A,
  including when the payload changes `projectId` to B.
- A globally privileged user without direct association to project A cannot
  update or delete A's location.
- A directly associated approved manager can update/delete the location but
  cannot change its owner project.
- Existing schema and PII-smuggling guards remain active.
- The focused Firestore Rules Emulator suite, rule lint, typecheck, and
  production build pass before publication.
