# ADR 0021 — Life-safety features are free across ALL tiers; tier-gating applies only to management/scale

Status: **Accepted** (2026-06-06)

## Context

Praeventio Guard is an **occupational risk-prevention platform whose first
purpose is to save lives** (Ley 16.744, DS 54, DS 44). It digitizes the
prevention workflow so a worker's safety information — and the actions that
protect them in an emergency — are available anywhere, combining field and
office into one correctly-managed source of truth. The commercial model sells
the **level of management** (scale, integrations, analytics, branding), **not
the safety of the person**.

A subscription/tier system exists (`SubscriptionContext` client matrix;
`subscription.planId` on the user doc; `PLAN_RANK` in
`services/pricing/subscriptionPlan.ts`; the server `requireTier` middleware).
Without an explicit rule, it would be possible — accidentally — to put a
life-saving function behind a paywall. For a prevention app that is both
ethically unacceptable and incompatible with the regulatory duty of care: an
SOS, an evacuation headcount, or a hazard report must never depend on what the
employer has contracted.

## Decision

**Any feature whose purpose is to protect a person's life or physical
integrity is FREE and available on EVERY tier, including `free`. Tier-gating
(`requireTier`, the client feature matrix, plan worker/project limits) applies
ONLY to management/scale/convenience capabilities.**

### ALWAYS FREE — never gate (life/integrity 🛟, and access to one's own safety data)
- SOS / panic button, emergency declaration, ManDown / fall detection, lone-worker
  sessions, survival mode.
- Evacuation headcount + routes, emergency brigade coverage, DEA/AED locator,
  first-responder dispatch.
- Incident / hazard / near-miss reporting and the worker reading **their own**
  prevention records and legal documents (the information itself — not the
  external integrations that sync it elsewhere).
- Anything tagged 🛟 in `PHASE5-REMEDIATION.md` and the "basic emergency button"
  already noted as ungated in `SubscriptionContext`.

### MAY be gated by tier — management / scale / convenience
- Worker/project **scale limits** (`PLAN_LIMITS`).
- External **integrations & add-ons**: Google Drive / Workspace, SSO, API access.
- **Executive dashboard**, **advanced analytics**, **custom branding**,
  **Vertex fine-tuning**, **multi-tenant** administration.

The distinction: gating must never reduce a worker's ability to **stay safe or
record what protects them**. It only changes how much the *organization* can
manage, integrate, brand, and analyze.

## Consequences

- `requireTier` (server) and the client feature matrix carry a guardrail
  comment pointing here. **Reviewers MUST reject any PR that mounts
  `requireTier` (or any plan check) on a life-safety route.**
- When a premium server route is introduced, it is gated only if it falls in
  the "may be gated" list above. Example honoring this: `GET /api/drive/auth/url`
  (Google Drive/Workspace integration → `titanio`) — a management integration,
  not safety data.
- The `free` plan is a fully-capable **life-safety** product; the upsell is
  management leverage, not protection.

## References
- CLAUDE.md directive #11 (tier-gating enforced server-side).
- `src/services/pricing/subscriptionPlan.ts` (`PLAN_RANK`, `planMeetsMinimum`).
- `src/server/middleware/requireTier.ts`; `src/contexts/SubscriptionContext.tsx`.
- `docs/audits/file-ledger/PHASE5-REMEDIATION.md` (🛟 = life-safety; "vida y privacidad primero").
