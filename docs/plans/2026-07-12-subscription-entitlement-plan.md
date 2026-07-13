# Subscription entitlement lifecycle implementation plan

**Goal:** Prevent expired, revoked, incomplete, or unverifiable subscriptions
from retaining paid access while keeping one shared policy for server and client.

**Architecture:** Add a pure evaluator under `src/services/pricing`, then make
`requireTier` and `SubscriptionContext` consume its effective plan. Provider
webhooks remain lifecycle-data producers and are not duplicated in the gate.

**Tech stack:** TypeScript, React context, Express middleware, Firestore, Vitest,
Supertest.

## Task 1: Lock the shared entitlement contract with failing tests

**Files:**

- Create: `src/services/pricing/subscriptionEntitlement.test.ts`
- Create: `src/services/pricing/subscriptionEntitlement.ts`

Write tests for free, active web, active App Store/Google Play, missing status,
revoked, expired, past/invalid expiry, valid/elapsed grace, unknown provider, and
provider inference. Run the test and confirm RED because the evaluator is absent.

## Task 2: Implement the pure evaluator

Implement normalized status, provider, date, and grace validation. Return a
discriminated result containing `entitled`, `effectivePlan`, `reason`, and
normalized provider. Run the focused domain test to GREEN.

## Task 3: Enforce the evaluator on the server

**Files:**

- Modify: `src/server/middleware/requireTier.ts`
- Modify: `src/__tests__/server/requireTier.test.ts`

Change the Firestore reader to return the complete subscription record, add
middleware tests for active, expired, revoked, past-expiry, and incomplete paid
records, then make the gate compare the effective plan. Preserve report-only
behavior and Firestore failure handling.

## Task 4: Use the same policy in the client

**Files:**

- Modify: `src/contexts/SubscriptionContext.tsx`
- Modify: `src/contexts/SubscriptionContext.test.ts`

Add a small exported resolver used by the provider's Firestore fetch, prove it
returns free for invalid paid lifecycle states, and keep the existing feature
matrix based on the resulting effective plan.

## Task 5: Normalize lifecycle producers

**Files:**

- Modify: App Store and Google Play lifecycle handlers
- Modify: Webpay, Mercado Pago, Khipu, manual invoice, and upgrade activations

Persist a canonical provider on every activation. Decode App Store billing grace
expiry and write `grace_period` plus `gracePeriodEnd` only while it is valid.

## Task 6: Verify and publish

Run focused tests, typecheck, lint on changed files if supported, and the relevant
billing/subscription regression tests. Review the final diff, commit once with a
focused message, push `codex/p0-subscription-entitlement`, open a draft PR, and
set the Notion task to Review with its PR URL.
