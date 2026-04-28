# Google Workspace Marketplace — submission runbook

> **Audience:** the Praeventio Guard developer-account owner filing the listing in GCP Console.
> **Estimated wall-clock:** 4-6 weeks end-to-end (most of it is Google review, not our work).
> **Prerequisite:** GCP developer account is active and the user has Owner role on the GCP project. As of 2026-04-28 the user is still finalizing the developer account; do not start step 1 until that is confirmed live.

This runbook is **English (developer-facing)** by design. End-user listing copy is Spanish-CL — see `marketplace/listing-copy.md`.

---

## Step 0 — Pre-flight checklist (before opening Console)

- [ ] Domain `praeventio.net` registered AND verified in Google Search Console under the same Google account that will submit the listing.
- [ ] Domain `praeventio.cl` registered (defensive for Chilean users) — nice-to-have.
- [ ] `soporte@praeventio.net` MX records resolve and a real human / shared inbox monitors it.
- [ ] `privacidad@praeventio.net`, `dev@praeventio.net` (or `dahosandoval@gmail.com` as developer contact) reachable.
- [ ] Privacy policy live at `https://praeventio.net/privacy` (returns HTTP 200, includes scope-by-scope disclosure per `marketplace/scope-justifications.md`).
- [ ] Terms of service live at `https://praeventio.net/terms`.
- [ ] Marketing homepage live at `https://praeventio.net` (not a "Coming Soon" page).
- [ ] App live at `https://app.praeventio.net` and signs users in via Workspace OAuth in staging.
- [ ] Marketplace assets produced per `marketplace/assets-spec.md` and uploaded to `public/marketplace/`.

If any item is unchecked, **do not start Step 1** — you will hit a rejection at the verification step and have to restart.

---

## Step 1 — Create / verify GCP project

1. GCP Console → Project selector → **New Project** (or select existing).
2. Project name: `praeventio-prod`.
3. Project ID: `praeventio-prod` (must be globally unique; if taken try `praeventio-prod-cl`).
4. Billing account: link to the active billing account on the developer org.
5. Verify Owner / Editor IAM is set correctly for the user submitting.

**Validation:** `gcloud config get-value project` returns `praeventio-prod` (if using gcloud CLI).

---

## Step 2 — Enable Marketplace SDK

1. GCP Console → APIs & Services → Library.
2. Search "Google Workspace Marketplace SDK".
3. Click → **Enable**.
4. Also enable in the same session (Praeventio uses these scopes):
   - Google Calendar API
   - Google Drive API
   - Identity Toolkit API (Firebase Auth)
   - Cloud KMS API (for token envelope encryption)

Wait ~1-2 minutes for the API enablement to propagate before continuing.

---

## Step 3 — Configure OAuth Consent Screen

1. APIs & Services → **OAuth consent screen**.
2. User type: **External**. Click Create.
3. Fill the form following `marketplace/oauth-consent-screen.md` field-by-field (it documents every paste).
4. **Tab 2 — Scopes:** add only the scopes from `marketplace/manifest.json#oauth.scopes`. Do NOT add Google Fit scopes (deprecated, see `HEALTH_CONNECT_MIGRATION.md`).
5. **Tab 3 — Test users:** add `dahosandoval@gmail.com` plus 2-3 internal teammates while in Testing mode.
6. **Tab 4 — Summary:** review, click **Back to Dashboard**.
7. Status will be **Testing** initially — that's expected. Move to Production in Step 4.

---

## Step 4 — Submit for OAuth verification (sensitive scopes path)

Sensitive scopes (`calendar.events`, plus `drive.file` if Google flags it for our use case) require Trust & Safety review.

1. From the OAuth consent screen Dashboard → click **Publish App**.
2. Status changes to **In production — pending verification**.
3. The form will request:
   - **Justification per scope** — paste from `marketplace/scope-justifications.md`.
   - **Demo video** of the app using each sensitive scope. Record a 60-90 second screencast (Loom or YouTube unlisted) showing:
     - User signs in
     - App requests Calendar permission
     - App creates a Comité Paritario meeting
     - App requests Drive permission
     - App writes an IPER PDF to user's Drive
   - **App home page screenshot** (proves we control praeventio.net).
4. Submit.
5. **Wait 5-15 business days.** Reviewer questions arrive at `soporte@praeventio.net` (the User Support email).

**While waiting:** do NOT change scopes or OAuth client config — every change resets the queue position.

---

## Step 5 — Create Marketplace SDK App Configuration

> Only proceed after Step 4 verification is **approved**. Marketplace listings cannot reference unverified consent screens.

1. APIs & Services → **Marketplace SDK** → **App Configuration**.
2. Fill each field by copying from `marketplace/manifest.json` (the `_form_section_*` keys document exactly which form section each value goes to).
3. Configure **Universal Navigation URL**: `https://app.praeventio.net`.
4. Set **Visibility** = Public.
5. Set **Install settings**: Individual install ON, Domain-wide install ON.
6. **Save** (without publishing yet — listing is in Step 7).

---

## Step 6 — Upload assets

1. Marketplace SDK → **Store Listing** → Branding section.
2. Upload per `marketplace/assets-spec.md`:
   - App icon 128×128 → `public/marketplace/icon-128.png`
   - Application card banner 220×140 → `public/marketplace/banner-220x140.png`
   - Screenshots (1-5) at 1280×800 → `public/marketplace/screenshot-{1..5}.png`
   - Promo video YouTube URL (optional)
3. Each asset upload is checked synchronously by Google — if size/format is wrong, the form errors immediately. Re-export from design and retry.

---

## Step 7 — Paste listing copy

1. Marketplace SDK → Store Listing → Description section.
2. **Short description (200 char max):** copy from `marketplace/listing-copy.md` § SHORT DESCRIPTION (es-CL).
3. **Detailed description (16,000 char max):** copy the entire Spanish-CL detailed description block. Renders as markdown.
4. **Categories:** select up to 3 from Google's enum. Closest matches: Productivity, Business, Industry-specific.
5. **Languages supported:** add `es-CL`, `es-419`, `en`.
6. **Regions:** Chile + LATAM countries we serve + Global.
7. **Replace placeholder testimonials in `listing-copy.md` with real customer quotes** before pasting — flagged with `_PLACEHOLDER_` markers.

---

## Step 8 — Paste scope justifications

1. The OAuth Consent Screen Scopes tab already has the justifications (from Step 3-4). The Marketplace SDK form may ask again — paste from `marketplace/scope-justifications.md`.
2. Confirm consistency: the same Spanish-CL justification text should appear on both surfaces.

---

## Step 9 — Submit for Marketplace review

1. Marketplace SDK → **Submit for Review**.
2. Acknowledge the developer agreement.
3. Confirm the listing is intended for Public Marketplace.
4. Submit.

**Confirmation:** you'll receive a ticket number at the developer contact email (`dahosandoval@gmail.com`).

---

## Step 10 — Review & feedback loop

- **Review SLA:** 5-15 business days, often longer for first-time developers.
- **Reviewer feedback:** arrives at User Support email (`soporte@praeventio.net`). Common asks:
  - "Demonstrate scope X" — re-record demo video with a clearer flow.
  - "Privacy policy section Y is missing" — update praeventio.net/privacy, re-submit.
  - "App icon contains text" — re-export icon without wordmark, re-upload.
- **Iteration cost:** each rejection adds 5-10 business days. Address every item in a single re-submission, not sequentially.
- **Status check:** Marketplace SDK → Store Listing → Status field.

---

## Step 11 — Post-approval operations

Once approved and live:

- **Monitor:** Marketplace SDK → Analytics tab. Track installs, uninstalls, active users.
- **Respond to reviews:** within 48 hours. Use the same `soporte@praeventio.net` voice as the listing copy (Spanish-CL primary).
- **Update cadence:** any change to scopes, privacy policy, or core functionality triggers a re-review (5-15 business days). Plan changes in batches.
- **Sunset Fit scopes** before 2026-12-31 — already removed from manifest, but server-side `/api/fitness/sync` still emits Sunset header per RFC 8594. Confirm zero callers in logs by Q4 2026.
- **Featured listing request:** after first 100 installs, request featuring via Marketplace partner manager (email follow-up).

---

## Risks & mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| OAuth verification rejection (logo or scope) | High (first-time submitter) | Pre-validate against `marketplace/oauth-consent-screen.md` § "Common rejection reasons"; iterate on logo before submit |
| Privacy policy doesn't enumerate scopes | Medium | Update praeventio.net/privacy to list every scope by name and what we do with it |
| Domain not verified in Search Console | High if forgotten | Verify before Step 1 |
| Reviewer can't reproduce a use case | Medium | Pre-record demo video for every sensitive scope; attach to submission |
| Fit deprecation flagged | Low (we removed) | Double-check `marketplace/manifest.json#oauth.scopes` does not contain fitness.* before submitting |
| Marketplace SDK form changes between drafting and submission | Medium | Treat `marketplace/manifest.json` as a checklist, not a literal copy-paste — verify against current form fields the day of submission |

---

## Sibling agent coordination

This runbook is filed by Agent B1 (marketplace docs). Sibling work that affects submission:

- **B2 — iOS HealthKit native config:** must complete `Info.plist` `NSHealthShareUsageDescription` so iOS users can grant the app health access without OAuth (Google won't see this; relevant for App Store, not Marketplace).
- **B3 — Security disclosure / SECURITY.md:** the privacy policy at praeventio.net/privacy should link to SECURITY.md once B3 lands.
- **B4 — Observability:** Sentry DSN + uptime SLA inform what we can claim in the listing's Support & SLA section.
- **B5 — Backup / DR:** disaster recovery posture supports the "data residency Chile" claim in `listing-copy.md`.

Do not block on sibling agents for the docs — the Marketplace submission can proceed once OAuth verification clears (Step 4), and listing copy can be revised post-publication (Step 11) as siblings land their pieces.

---

## Operational TODOs the user must complete (cannot be done from code)

1. **Verify domain `praeventio.net` and `praeventio.cl` in Google Search Console** under the submitter's Google account.
2. **Stand up `soporte@`, `privacidad@`, `ventas@` mailboxes on `praeventio.net`** (Google Workspace mail or external IMAP). Set up forwarding rules so reviewer emails reach the human responsible.
3. **Publish privacy policy and terms of service pages** at `praeventio.net/privacy` and `/terms`. Include scope-by-scope disclosure per `marketplace/scope-justifications.md`.
4. **Produce all assets per `marketplace/assets-spec.md`.** Design work, out of code scope.
5. **Record sensitive-scope demo videos** (Loom or YouTube unlisted) for OAuth verification.
6. **Replace `_PLACEHOLDER_` testimonials in `marketplace/listing-copy.md`** with real customer quotes before pasting into the listing form.
7. **Time the OAuth Consent Screen "Publish App" click** — the app must be in `In production` status before opening the Marketplace SDK form, but it should not sit in production with sensitive scopes pending verification longer than necessary (Google flags long-pending verifications).
8. **Decide promo video v0 vs v1.1** (skip is fine for v1).
9. **Once approved:** subscribe at least one human to Marketplace email notifications for the listing (`dahosandoval@gmail.com` already covered as developer contact, but add `soporte@` for review traffic).

---

## Files referenced

- `marketplace/manifest.json` — App Configuration form values.
- `marketplace/oauth-consent-screen.md` — OAuth Consent Screen form values, field-by-field.
- `marketplace/scope-justifications.md` — per-scope justifications for verification.
- `marketplace/listing-copy.md` — Marketplace listing detailed description (Spanish-CL).
- `marketplace/assets-spec.md` — image specs for design team.
- `HEALTH_CONNECT_MIGRATION.md` — context for why Fit scopes are out.
- `KMS_ROTATION.md` — context for OAuth token security claim in privacy policy.
- `VERTEX_MIGRATION.md` — context for data residency Santiago claim.
- `PRICING.md` — source of pricing copy in listing.
- `IMPACTO.md` — source of compliance & security claims in listing.
