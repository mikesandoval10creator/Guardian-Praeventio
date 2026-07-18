# Human-Facing Error Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate every known raw machine error from user-visible UI while preserving technical diagnostics and enforcing a zero-leak CI guard.

**Architecture:** Keep API/SDK errors technical inside hooks, services, logs, outboxes, and control flow. Convert them to actionable Spanish-CL only at presentation boundaries through `src/lib/humanError.ts`, then enforce the boundary with a static scanner executed by pre-commit and Vitest CI.

**Tech Stack:** TypeScript, React 19, Vitest 4, Node.js CommonJS guard scripts, existing Husky and npm CI gates, Graphify.

## Global Constraints

- Do not remove, disable, or defer any known user-facing feature or error surface.
- Preserve server error codes and original errors for logs, Sentry, audit, retry queues, and internal branching.
- User-facing copy is Spanish-CL.
- Existing human sentences pass through unchanged.
- The final static-guard baseline is zero unsafe sinks.
- Never stage or modify the unrelated `.claude/settings.json` change in the primary checkout.
- The branch remains stacked on `fix/regulatory-doc-role-gate` until PR #1301 merges.

---

### Task 1: Make the shared humanizer safe for plain strings

**Files:**
- Modify: `src/lib/humanError.ts`
- Test: `src/lib/humanError.test.ts`

**Interfaces:**
- Consumes: `unknown` error values from UI boundaries.
- Produces: `humanErrorMessage(err: unknown): string`, idempotent for both `Error('frase humana')` and direct human strings.

- [ ] **Step 1: Add the failing plain-string contract**

Add to `describe('humanErrorMessage', ...)`:

```ts
it('passes a direct human string through unchanged', () => {
  const message = 'Geolocalización no disponible en este dispositivo.';
  expect(humanErrorMessage(message)).toBe(message);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/lib/humanError.test.ts --reporter=dot`

Expected: FAIL because the current implementation only reads `err.message` and replaces a direct string with the generic fallback.

- [ ] **Step 3: Implement the minimal input normalization**

Replace the raw-message extraction with:

```ts
const raw =
  typeof err === 'string'
    ? err
    : (err as { message?: unknown } | null)?.message;
const text = typeof raw === 'string' ? raw.trim() : '';
```

- [ ] **Step 4: Verify GREEN and compatibility**

Run: `npm run test -- src/lib/humanError.test.ts --reporter=dot`

Expected: all helper tests pass and the new direct-string assertion preserves the original sentence.

- [ ] **Step 5: Commit**

```bash
git add src/lib/humanError.ts src/lib/humanError.test.ts
git commit -m "fix(errors): preserve human strings at the UI boundary"
```

### Task 2: Build a zero-leak static guard with TDD

**Files:**
- Create: `scripts/check-user-facing-errors.cjs`
- Create: `src/__tests__/scripts/userFacingErrorsGuard.test.ts`

**Interfaces:**
- Produces: `scanSource(source: string, fileKey?: string): Violation[]`, `scan(files?: string[]): Violation[]`, and `listUiFiles(): string[]`.
- `Violation` shape: `{ file: string; line: number; kind: 'raw-jsx-error' | 'raw-error-state' | 'visible-machine-status'; excerpt: string }`.

- [ ] **Step 1: Write guard tests before the script exists**

Create a Vitest suite with these contracts:

```ts
expect(scanSource('const x = <p>{error.message}</p>')).toMatchObject([
  { kind: 'raw-jsx-error' },
]);
expect(scanSource('const x = <p>{error}</p>')).toMatchObject([
  { kind: 'raw-jsx-error' },
]);
expect(scanSource("setError(err instanceof Error ? err.message : String(err));"))
  .toMatchObject([{ kind: 'raw-error-state' }]);
expect(scanSource('const x = <p>{humanErrorMessage(error)}</p>')).toEqual([]);
expect(scanSource("logger.error('failed', { error });")).toEqual([]);
expect(scanSource("throw new Error(`http_${res.status}`);")).toEqual([]);
```

The last assertion pins the architecture: technical producers are legal until they cross into presentation.

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/__tests__/scripts/userFacingErrorsGuard.test.ts --reporter=dot`

Expected: FAIL because `scripts/check-user-facing-errors.cjs` does not exist.

- [ ] **Step 3: Implement the scanner**

The CommonJS script must:

- recurse only `src/pages`, `src/components`, `src/contexts`, and `src/hooks`;
- skip tests, specs, stories, and `__tests__`;
- inspect TypeScript/TSX source with high-signal expressions for raw JSX error identifiers/members, raw caught-message state setters, and visible status templates;
- ignore expressions already inside `humanErrorMessage`, `humanErrorFromBody`, or `humanErrorFromResponse`;
- ignore logger, console, Sentry, outbox, and thrown internal errors;
- print `file:line kind excerpt` and exit 1 when violations exist;
- export pure scanning functions and run `main()` only under `require.main === module`.

The CLI success line is:

```text
[user-facing-errors] PASS — 0 raw user-visible error sink(s).
```

- [ ] **Step 4: Verify scanner unit GREEN**

Run: `npm run test -- src/__tests__/scripts/userFacingErrorsGuard.test.ts --reporter=dot`

Expected: all fixture tests pass.

- [ ] **Step 5: Run the scanner against the repository to establish the migration inventory**

Run: `node scripts/check-user-facing-errors.cjs`

Expected: FAIL with the complete current list. Save no baseline; this failure is the RED signal for Task 3.

- [ ] **Step 6: Commit the failing repository gate separately**

```bash
git add scripts/check-user-facing-errors.cjs src/__tests__/scripts/userFacingErrorsGuard.test.ts
git commit -m "test(errors): detect raw user-facing error sinks"
```

The unit tests are green; the repository-wide CLI remains intentionally red until Task 3 removes every reported sink.

### Task 3: Migrate every reported presentation sink to the shared boundary

**Files:**
- Modify: every production file reported by `node scripts/check-user-facing-errors.cjs` under `src/pages`, `src/components`, `src/contexts`, and `src/hooks`.
- Review and reproduce when valid: the 13 uncommitted task files preserved in the primary checkout.
- Test: representative existing suites plus new focused UI tests where no behavioral suite exists.

**Interfaces:**
- Consumes: `humanErrorMessage`, `humanErrorFromBody`, and `humanErrorFromResponse`.
- Produces: zero unsafe sinks while preserving the original error for diagnostics.

- [ ] **Step 1: Apply only these explicit transformations**

For a caught error assigned to visible state:

```ts
logger.error('domain.action.failed', err);
setError(humanErrorMessage(err));
```

For direct JSX:

```tsx
<p role="alert">{humanErrorMessage(error)}</p>
```

For visible prefixed copy:

```tsx
<p>No se pudo completar la acción: {humanErrorMessage(error)}</p>
```

For an already-consumed response body:

```ts
setError(humanErrorFromBody(body, response.status));
```

Add the shortest correct relative import. Do not touch technical logger/Sentry/outbox values.

- [ ] **Step 2: Review the preserved agent edits individually**

Compare the primary checkout diff for:

```text
src/components/eppFlow/EppInspectionForm.tsx
src/components/eppFlow/PendingPurchaseOrdersPanel.tsx
src/components/incidentFlow/AssignedMicrotrainingCard.tsx
src/components/incidentFlow/IncidentReportForm.tsx
src/components/incidentFlow/InvestigationPanel.tsx
src/components/incidentFlow/LessonPublishForm.tsx
src/components/incidentFlow/PDCAClosePanel.tsx
src/pages/AnnualReview.tsx
src/pages/ConfidentialReports.tsx
src/pages/DocumentReadConfirm.tsx
src/pages/FirstResponderMap.tsx
src/pages/FocusAgenda.tsx
src/pages/LegalCalendar.tsx
```

Reapply only edits that remove a reported sink. Do not copy unused imports from `ConfidentialReports.tsx` or `FocusAgenda.tsx` unless those files contain a real sink after the complete scan.

- [ ] **Step 3: Re-run the repository gate until GREEN**

Run: `node scripts/check-user-facing-errors.cjs`

Expected: `[user-facing-errors] PASS — 0 raw user-visible error sink(s).`

- [ ] **Step 4: Prove representative behavior**

Add tests that feed `Missing or insufficient permissions.` or `http_403` through the incident-report/process/shared-banner UI boundary and assert the rendered text:

```ts
expect(screen.queryByText(/403|http_403|permissions/i)).not.toBeInTheDocument();
expect(screen.getByRole('alert')).toHaveTextContent(/no tienes permiso|vuelve a iniciar sesión|inténtalo/i);
```

- [ ] **Step 5: Run focused suites and static checks**

Run:

```text
npm run test -- src/lib/humanError.test.ts src/__tests__/scripts/userFacingErrorsGuard.test.ts src/components/processes/StartProcessModal.test.tsx src/components/processes/CloseProcessModal.test.tsx src/contexts/ProjectContext.test.tsx --reporter=dot
npm run typecheck
npx eslint src/pages src/components src/contexts src/hooks src/lib/humanError.ts scripts/check-user-facing-errors.cjs
```

Expected: all commands exit 0. The three pre-existing `ProjectContext` async leaks may remain baseline-only.

- [ ] **Step 6: Commit the complete migration**

Stage only the scanner-reported UI files and their focused tests, then commit:

```bash
git commit -m "fix(errors): humanize every user-visible failure"
```

### Task 4: Wire the zero-leak guard into developer and CI workflows

**Files:**
- Modify: `package.json`
- Modify: `.husky/pre-commit`
- Modify: `src/__tests__/scripts/userFacingErrorsGuard.test.ts`

**Interfaces:**
- Produces: `npm run lint:user-errors`, a pre-commit gate, and a default Vitest repository gate.

- [ ] **Step 1: Add a failing integration assertion**

Extend the guard suite:

```ts
it('the production UI has zero raw error sinks', () => {
  expect(scan()).toEqual([]);
});
```

Run the test before wiring. It must pass only because Task 3 already reduced live violations to zero.

- [ ] **Step 2: Add workflow commands**

Add to `package.json` scripts:

```json
"lint:user-errors": "node scripts/check-user-facing-errors.cjs"
```

Add to `.husky/pre-commit`:

```sh
node scripts/check-user-facing-errors.cjs
```

- [ ] **Step 3: Verify the three entry points**

Run:

```text
npm run lint:user-errors
npm run test -- src/__tests__/scripts/userFacingErrorsGuard.test.ts --reporter=dot
sh .husky/pre-commit
```

Expected: all exit 0 and report zero raw sinks.

- [ ] **Step 4: Commit workflow wiring**

```bash
git add package.json .husky/pre-commit src/__tests__/scripts/userFacingErrorsGuard.test.ts
git commit -m "ci(errors): reject raw user-facing failures"
```

### Task 5: Full verification, Graphify, stacked PR, and Notion

**Files:**
- Verify: all changed files and task documentation.
- Track: Notion page `3a1aa66d-73fe-8101-b5ad-da45fa36b143`.

**Interfaces:**
- Produces: reproducible evidence, a draft stacked PR, and Notion `Review` status.

- [ ] **Step 1: Run full relevant verification**

Run:

```text
npm run lint:user-errors
npm run typecheck
npm run test -- src/lib/humanError.test.ts src/__tests__/scripts/userFacingErrorsGuard.test.ts src/components/processes/StartProcessModal.test.tsx src/components/processes/CloseProcessModal.test.tsx src/contexts/ProjectContext.test.tsx --reporter=dot
npm run build
```

Run ESLint over every touched source/script file. Expected: exit 0 for every command.

- [ ] **Step 2: Refresh Graphify and review the final diff**

Run: `graphify update .`

Expected: Graphify succeeds; inspect producer -> hook -> presentation paths and confirm UI sinks point through the humanization boundary. Remove only ignored generated Graphify output if the worktree reports it as untracked.

Run: `git diff fix/regulatory-doc-role-gate...HEAD --check` and inspect the complete diff. Expected: no whitespace errors, no `.claude/settings.json`, no unrelated feature changes.

- [ ] **Step 3: Publish the stacked PR**

Push `codex/human-errors-complete` and open a draft PR with base `fix/regulatory-doc-role-gate`. Explain that PR #1301 must merge first, then retarget to `main`. Include counts from the final scanner and all verification commands.

- [ ] **Step 4: Update and verify Notion**

Set task `3a1aa66d-73fe-8101-b5ad-da45fa36b143` to `Review`, add the PR URL and exact verification commands, then fetch the page again to verify persistence.
