# Subscription entitlement lifecycle design

## Context

Guardian currently grants paid capabilities by comparing only
`users/{uid}.subscription.planId`. Billing rails already persist lifecycle data
such as `status`, `expiryDate`, `provider`, `paymentMethod`, and provider-specific
identifiers, but neither the server tier middleware nor the client subscription
context uses those fields. A revoked or expired subscription can therefore retain
paid access.

## Decision

Introduce one client-safe, pure entitlement evaluator in the shared pricing
domain. Both server enforcement and client UX derive the effective plan from its
result. The server remains authoritative.

There are no production customers requiring legacy compatibility, so paid
entitlements fail closed:

- `planId` must normalize to a known paid plan.
- `status` must be `active`, or `grace_period` with an unexpired
  `gracePeriodEnd`.
- `expired`, `revoked`, `cancelled`, unknown, and missing statuses deny access.
- A present `expiryDate` must be valid and strictly in the future.
- App Store and Google Play subscriptions must have a valid future
  `expiryDate`; provider identity can be explicit or inferred from their
  provider-specific transaction fields.
- Explicit unknown or contradictory provider metadata denies access.
- Every activation rail persists a canonical provider (`app-store`,
  `google-play`, `webpay`, `mercadopago`, `khipu`, or `manual`) so switching
  payment methods cannot leave stale provider metadata authoritative.
- Invoice-backed providers may be active without `expiryDate` because the
  current web payment rails do not yet persist a period end.
- Free remains the safe effective plan for every invalid entitlement.

The evaluator returns an explicit reason as well as the effective plan. This
supports deterministic tests and server telemetry without leaking provider
details to clients.

## Data flow

1. Billing provider writes subscription lifecycle fields to the user document.
2. Shared evaluator validates the complete subscription object at a supplied
   clock time.
3. `requireTier` compares the evaluator's effective plan with the route minimum.
4. `SubscriptionContext` exposes the same effective plan for UX feature flags.

## Error handling

Malformed, incomplete, expired, revoked, or contradictory paid subscription
records resolve to `free`. Firestore read failures retain the middleware's
existing fail-closed `403 tier_check_failed` behavior. Valid but insufficient or
invalid entitlements use the existing `402 upgrade_required` response. Route
tier rollout may remain report-only, but invalid paid lifecycle records are
always blocked; report-only never revives an expired or revoked subscription.

## Testing

Pure evaluator tests cover active web and mobile subscriptions, missing status,
revocation, expiration, malformed dates, valid and elapsed grace periods,
unknown providers, inferred mobile providers, and free plans. Middleware tests
prove server denial. Client-domain tests prove the same evaluator supplies the
effective plan used by feature gates.
