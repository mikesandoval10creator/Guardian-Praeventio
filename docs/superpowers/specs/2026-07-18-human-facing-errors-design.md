# Human-Facing Error Boundary Design

## Context

The client currently lets machine-facing failures cross into presentation state. Server responses correctly expose stable codes such as `forbidden_role`, `http_403`, or `invalid_payload`, and SDKs correctly expose technical messages such as `Missing or insufficient permissions.`. The defect appears when a component treats those values as user copy through `setError(err.message)`, raw JSX such as `{error}` or `{error.message}`, or a fallback such as ``Error ${response.status}``.

The audit found 214 machine-string producers across 160 client files and a broad upper bound of 126 raw error renders across 105 files. Those numbers are not equivalent to defects: internal logs, retry queues, and control-flow errors must retain technical detail. Graphify confirms the systemic path is producer hook/service -> caught error or error state -> JSX surface. The correction must therefore enforce a boundary at presentation without weakening diagnostics.

The task already has explicit user approval to repair every confirmed user-visible surface now, independent of role or work context. No feature may be removed and no known user-facing leak may be deferred to a later phase.

## Goals

- No visible UI message may expose a bare HTTP status, a machine code, or known technical SDK text.
- Every failure shown to a person must explain what happened and what they can do next in Spanish-CL.
- Existing human-written sentences must pass through unchanged.
- Technical codes and original errors must remain available to logs, Sentry, retry queues, and internal control flow.
- CI and pre-commit must reject new raw user-facing error sinks.

## Non-goals

- Do not change server error contracts or replace stable machine codes in API responses.
- Do not humanize logger, Sentry, audit, retry, outbox, or telemetry payloads.
- Do not remove features or replace specific domain guidance with a generic message when the current copy is already actionable.
- Do not refactor every fetch hook into a new transport layer in this task.

## Considered approaches

### 1. Humanize every producer

Replacing all 214 technical producers would make downstream rendering safer, but it would also change hook/service contracts, could break branches that inspect stable codes, and would reduce diagnostic fidelity. Internal producers are not defects by themselves. Rejected.

### 2. Rely on the global ErrorBoundary

A global boundary can hide uncaught render crashes, but most cases are handled failures stored in local state and rendered inline. It cannot cover forms, banners, toasts, or hook result objects. Rejected as incomplete.

### 3. Enforce a presentation boundary (selected)

Keep technical errors intact until they cross into visible state or JSX. Route every visible error through the shared `humanErrorMessage`, `humanErrorFromBody`, or `humanErrorFromResponse` helpers. Add a static guard that rejects direct raw error rendering and raw caught-message assignment in client UI code.

This addresses the real trust failure, preserves observability, and is compatible with existing hooks and services.

## Architecture

### Shared humanization module

`src/lib/humanError.ts` remains the single source of truth. It must:

- accept `Error`, Firebase-style errors, plain strings, nullish values, and parsed response bodies;
- map known machine codes and HTTP statuses to actionable Spanish-CL sentences;
- recognize known technical English SDK/network messages;
- preserve an existing human sentence exactly, including when passed as a plain string;
- never throw while translating an error;
- keep its functions pure and free of data access.

The module does not mutate or replace the original exception. Callers log the original value and use the returned string only for presentation.

### Presentation sinks

The complete client sweep covers `src/pages`, `src/components`, `src/contexts`, and UI-facing hooks. A sink is user-visible when it:

- writes a caught `.message`, `String(error)`, response code, or machine fallback into state later rendered by UI;
- renders an `error`, `errorMessage`, `errorMsg`, `feedback`, `notice`, or similar failure value directly in JSX;
- interpolates an error message into visible copy;
- passes an unhumanized error to a shared visual error component;
- exposes technical details from an ErrorBoundary in production UI.

Already-human success/feedback strings remain unchanged because `humanErrorMessage` is idempotent for human sentences. Shared components such as data-load banners and error boundaries humanize centrally so their consumers cannot regress independently.

### Internal technical errors

Machine codes remain valid in:

- `logger`, `console`, Sentry, audit and telemetry calls;
- outbox/retry records and result objects that are not rendered;
- tests asserting server contracts;
- server-side responses and internal exceptions used for branching.

The audit records these as reviewed internal producers rather than rewriting them merely to reduce a grep count.

### Zero-leak guard

Add `scripts/check-user-facing-errors.cjs`, exported for unit testing and executable from the command line. It scans production TypeScript/TSX in UI directories and reports high-signal unsafe patterns:

- raw error-like JSX expressions or `.message` members;
- state/toast/notification calls fed directly from caught `.message` or `String(error)`;
- visible HTTP-status or machine-code templates;
- direct technical details inside shared error surfaces.

Calls already wrapped by the humanization helpers and diagnostic sinks such as logger/Sentry are excluded. The target baseline is zero, not a list of postponed violations. The guard is wired into `package.json`, Husky pre-commit, and a Vitest gate so CI cannot silently reintroduce the pattern.

## Data flow

1. A server, Firebase SDK, device API, or local service produces a technical error.
2. The hook/service preserves that original error for control flow and diagnostics.
3. The UI catch logs or forwards the original error where appropriate.
4. Immediately before visible state or JSX, the value passes through `humanErrorMessage`, `humanErrorFromBody`, or `humanErrorFromResponse`.
5. The person sees an actionable Spanish-CL explanation without codes or technical English.
6. The static guard prevents new raw sinks while leaving internal machine errors untouched.

## Error handling

- Unknown HTTP 4xx/5xx responses fall back by status family without showing the number.
- Unknown machine tokens fall back to a generic actionable sentence.
- Known permission, authentication, offline, timeout, conflict, quota, and rate-limit failures use specific guidance.
- A plain human sentence is preserved exactly.
- Empty, non-Error, and malformed inputs degrade safely to the generic sentence.
- Error logging receives the original error, not the humanized string, unless the existing call already logs only a string.

## Testing

- TDD the plain-string idempotence bug in `humanErrorMessage`.
- Extend helper tests for representative HTTP, Firebase, network, and technical-English inputs.
- Unit-test the guard with unsafe and safe code snippets, including logger exclusions.
- Run the guard against the complete repository and require zero violations.
- Add or update representative behavioral tests for the process modal, incident report, shared data-load banner, and ErrorBoundary.
- Run all affected component/hook suites, full typecheck, ESLint, production build, and Graphify refresh.

## Delivery and dependency

The existing `fix/human-errors-app-wide` branch is stacked on PR #1301 because that PR introduces the shared helper and the six compliance call sites. This task will be published as its own PR with base `fix/regulatory-doc-role-gate` while #1301 remains open. After #1301 merges, the PR can be retargeted to `main` without duplicating its compliance/security diff.

The unrelated local change in `.claude/settings.json` is explicitly excluded from every task commit and from the PR.

## Acceptance criteria

- The repository-wide user-facing guard reports zero unsafe sinks.
- The six confirmed process/project/worker sites and all audited pages/components no longer expose raw codes.
- The incident report permission failure displays actionable Spanish-CL copy.
- Existing human messages, including DEA geolocation guidance, pass through unchanged.
- Logs and internal machine-code contracts retain technical detail.
- CI and pre-commit execute the new guard.
- No application feature is removed or disabled.
