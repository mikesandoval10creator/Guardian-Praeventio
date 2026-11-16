# Industry-rule HTTP request lifetime

Notion ticket: `3c3aa66d-73fe-8128-b314-f7729e5ca6cb` — Los 5 fetch de industryRules no tienen timeout ni cancelación.

## Contract

All five exports in `src/hooks/useIndustryRules.ts` accept an optional caller `AbortSignal` while keeping existing positional arguments compatible. `selectIndustryRemote` retains its third-position idempotency key; its signal is fourth.

The shared authenticated operation has a **15-second total deadline**, including auth-header acquisition, HTTP fetch and response JSON consumption. The caller's signal does not replace this deadline. Timers and caller listeners are removed on success, error or cancellation. Explicit AbortController/timer composition avoids requiring newer `AbortSignal.any`/`timeout` implementations in embedded WebViews.

A timeout rejects with a controlled `TimeoutError`; a caller cancellation rejects with `AbortError`. An Auth provider's own work cannot be cancelled by this API, but the returned operation is bounded and a late Auth completion cannot begin a fetch. Late transport/body completion cannot resolve an already cancelled operation. Authentication, URL encoding, content-type, POST payload and idempotency headers are unchanged.

## Wizard ownership

- Catalog, preview and submission own cancellation controllers.
- Catalog and preview abort on effect cleanup; submission aborts on session unmount.
- The project ID keys the session: a different project starts with no previous selection/draft/result.
- Cleanup suppresses late state writes and late `onApplied`, even for an injected implementation that ignores the signal.
- Catalog/preview retries are explicit UI actions. No automatic POST retry is introduced.
- A submit timeout means **unknown outcome**, not rollback or a successful application. The user is told to inspect project state before retrying. Aborting a browser request cannot undo server work already accepted.

## Evidence and limits

RED was observed for the original missing fetch signal and the original wizard's unmount/back/project-change ownership and timeout/retry behavior. GREEN was exercised with the canonical Vite+ runner, compatible Node v24.22.1 and two workers:

```sh
vp test run --maxWorkers=2 src/components/industry/IndustrySelectorWizard.lifecycle.test.tsx src/hooks/useIndustryRules.test.ts src/hooks/useIndustryRules.lifecycle.test.ts src/pages/ProjectSetup.test.tsx src/__tests__/server/industryRules.test.ts src/server/routes/industryRules.test.ts src/services/industryRules/industryRuleEngine.test.ts
```

Result: **7 files / 95 tests passed**, no skipped tests. Full TypeScript typecheck and changed-file ESLint passed without errors or warnings.

Unit tests use controlled transport/Auth fixtures and fake time for deadline assertions; wizard tests use jsdom. They cover all five exports with hanging network/caller cancellation/pre-cancelled signals; hung auth/body consumption; timer/listener cleanup; unchanged auth/idempotency semantics; wizard lifecycle, manual catalog retry and no false application callback after timeout. These are not real-device, physical slow-network, production endpoint, accessibility, throughput or deployment claims.

No norm, EPP, hazard or industry preset data is modified. `jsonResponse` DTO runtime validation remains separate debt; this change does not claim to solve it.
