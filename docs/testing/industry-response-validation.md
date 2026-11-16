# Industry response validation

Notion: `3c3aa66d-73fe-81e5-a3ba-d052f8bd0e93` — jsonResponse castea sin validar: payload deforme llega al render.

## Scope and observed behavior

Based on `main` `8295ff1e` after #1941. Its timeouts/cancellation are preserved.
The real `fetchRequiredEpp` client initially resolved a 200 `{}` as a typed DTO.
The same missing decoder was reproduced for list, select, norms and hazards.
A successful but non-JSON body also exposed a raw JSON parser error.

## Contract

Every successful industry HTTP response is now decoded through an endpoint-specific Zod schema before it reaches callers:

- Catalog entries require nonblank string prefixes/labels.
- EPP, norms and hazards require their declared lists and nonblank string elements.
- Selection validates both nested `IndustryPreset` and `PresetApplication`, including all required list fields, nested risk severity and optional `isFallback` / `severityOverrides`.
- No coercion, inferred requirements, default arrays or severity downgrade is introduced. Explicit valid empty lists remain valid; missing, null or malformed lists are not empty lists.
- Existing known producer fields are preserved; unrecognized fields are stripped. Schemas establish structural validity, not normative correctness or safety certification.
- Invalid successful JSON/body shape produces `IndustryResponseValidationError`, stable code `industry_response_invalid`, the actual HTTP status as diagnostic metadata and a fixed Spanish message with a retry action. Raw payloads and Zod/parser diagnostics are not put in the message.
- Non-2xx behavior is not changed. No status is rewritten to 200 and no server route/data/rule changes are included.

The existing wizard's error handling consumes the controlled error. Preview failure disables progression; final-application failure does not execute `onApplied` or show its applied banner. Valid data passes through unchanged. This does not prove downstream project persistence: the pure select endpoint builds a plan and the caller owns subsequent effects.

## Executed verification

Compatible Node v24.22.1, Vite+ v5.1.0, two workers:

```sh
vp test run --maxWorkers=2 src/hooks/useIndustryRules.validation.test.ts src/components/industry/IndustrySelectorWizard.validation.test.tsx src/components/industry/IndustrySelectorWizard.lifecycle.test.tsx src/hooks/useIndustryRules.test.ts src/hooks/useIndustryRules.lifecycle.test.ts src/pages/ProjectSetup.test.tsx src/__tests__/server/industryRules.test.ts src/server/routes/industryRules.test.ts src/services/industryRules/industryRuleEngine.test.ts
```

**9 files / 134 tests passed**, none skipped. Full TypeScript and changed-file ESLint: exit 0, no warnings.

Behavioral RED: EPP `{}` resolved instead of rejecting; the other four endpoints reproduced the same failure; non-JSON 200 lacked the controlled error. GREEN followed each implementation slice. A later UI test initially used a nonexistent success selector; the actual rendered `industry-wizard.applied-banner` was inspected and all positive/negative assertions corrected. That selector failure is not counted as product RED.

The decoder preserves real engine output for every catalog preset, including declared severity overrides; read endpoints' current response shapes and explicit empty lists also pass. The lifecycle fixture for a successful select was upgraded from an unrelated catalog-shaped body to the actual producer DTO, without weakening its header assertion.

## Evidence limits

The wizard tests exercise the actual component, HTTP client and decoder with transport/Auth fixtures and jsdom; they are not production OAuth, Firestore persistence, physical-device or network evidence. The legacy EPP/norms/hazards exports currently have no direct product caller found in the source search; their boundary tests close a latent contract gap, not a claim that a new EPP screen was wired. Production list/select callers are exercised. No norms, EPP catalogs, preset definitions or server-side severity rules are changed. The cancelled raw-error-text ticket is not reopened or claimed solved.
