# OAuth Consent Screen — GCP Console form content

> **Where in Console:** APIs & Services → OAuth consent screen.
> **Project:** `praeventio-prod` (verify selected before editing).
> **Save & Continue** between each tab — Google does NOT auto-save partial state.
> Text marked `Spanish-CL` is intended for end-user display; the form lets you set localized strings on the listing tab, not here, but the App Name and User Support text **are** rendered to end users in their locale, so we keep the canonical strings short and language-neutral.

---

## Tab 1: OAuth consent screen

### Field 1 — App name
**Paste:** `Guardian Praeventio`

**Why:** Matches the canonical product name used in `marketplace/manifest.json` and in `package.json`. Google requires this string to be **identical** to the Marketplace SDK App Configuration `name` field, otherwise the listing is auto-rejected with code `MISMATCH_APP_NAME`.

**Common mistakes to avoid:**
- Do NOT use "Praeventio Guard" here and "Guardian Praeventio" in the manifest. Pick one and propagate.
- Do NOT include a tagline (e.g. "Guardian Praeventio — IA para SST"). The form rejects punctuation patterns that look like marketing taglines.

---

### Field 2 — User support email
**Paste:** `soporte@praeventio.net`

**Why:** This is the public-facing inbox shown to end users on the Google consent dialog. `README.md` already commits this address. End users WILL email it; route it to a real ticketing system or shared inbox.

**Common mistakes to avoid:**
- Do NOT use a personal address (e.g. `dahosandoval@gmail.com`) — Google flags listings whose support email is not on the verified domain. Personal email goes in **Developer contact** (Field 6), which is private.
- Confirm MX records resolve before submitting. A bounced reviewer email = rejection.

---

### Field 3 — App logo
**Upload:** `public/marketplace/logo-120.png` (after design produces it — see `marketplace/assets-spec.md`).

**Specs Google enforces:**
- 120×120 pixels (exact).
- PNG, transparent background.
- < 1 MB.
- No text inside the logo (Google's brand guidelines reject "wordmark" logos for OAuth consent — the App Name field IS the wordmark).

**Why this logo:** End users see this every time they OAuth-grant our app. It's the trust handshake.

**Common mistakes to avoid:**
- Logo with "Praeventio" written inside → rejection (text-in-logo).
- Low-res raster (e.g. 32×32 upscaled) → rejection (resolution).
- White background → looks broken on dark-mode consent dialog. Use transparency.

---

### Field 4 — App domain → Application home page
**Paste:** `https://praeventio.net`

**Why:** The Spanish-CL marketing site. Reviewers click this; if it 404s or shows "Coming Soon" the listing is rejected with `HOME_PAGE_NOT_LIVE`.

---

### Field 5 — App domain → Application privacy policy link
**Paste:** `https://praeventio.net/privacy`

**Why:** Must serve a real privacy policy that mentions:
- What Google data we access (Calendar events, Drive files we create).
- Data retention period.
- Third-party processors (Firebase, Vertex AI, KMS).
- User rights under Ley 19.628 (Chile) and Ley 21.719 (new data protection law effective 2026).
- A working contact for data deletion requests (privacidad@praeventio.net per README.md).

**Common mistakes to avoid:**
- Hosting the policy on Notion or Google Docs — reviewers reject these as "third-party platforms not on declared domain."
- Policy in English only — must include Spanish-CL since our market is Chile.

---

### Field 6 — App domain → Application terms of service link
**Paste:** `https://praeventio.net/terms`

**Why:** Same domain rule. Must include refund policy (per `PRICING.md` cancellation rules) and SLA per Workspace tier.

---

### Field 7 — Authorized domains
**Add (one per line):**
```
praeventio.net
praeventio.cl
```

**Why:** Every URL declared in this consent screen (privacy, terms, home, redirect URIs) must come from one of these authorized domains. Add `praeventio.cl` if owned (defensive — covers Chilean users typing `.cl` reflexively).

**Common mistakes to avoid:**
- Forgetting `www` is **automatic** in Google's matcher (don't add it explicitly — adding `www.praeventio.net` separately is rejected as duplicate).
- Adding domains we don't actually control. Google verifies domain ownership against Search Console.

---

### Field 8 — Developer contact information
**Paste:** `dahosandoval@gmail.com`

**Why:** This inbox is **private to Google** — only Trust & Safety reviewers email it, never end users. The personal Gmail is correct here until `dev@praeventio.net` is set up. Google requires it to be reachable for security/policy notifications (deprecation announcements, suspension notices).

**Common mistakes to avoid:**
- Using the same address as User Support (Field 2). Google warns if both match — they want a separate developer contact.

---

## Tab 2: Scopes

Add each scope from `marketplace/manifest.json#oauth.scopes`. For each non-trivial scope, the form requires a justification — paste from `marketplace/scope-justifications.md`.

**Sensitive scopes (yellow warning in Console):**
- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/drive.file` (technically restricted-by-default but documented as non-sensitive when limited to per-file access)

**Non-sensitive:**
- `openid`
- `userinfo.email`
- `userinfo.profile`

**DO NOT add Google Fit scopes** — sunset 2026-12-31, replaced by Health Connect / HealthKit on-device.

---

## Tab 3: Test users (only relevant during "Testing" status)

**Add:** `dahosandoval@gmail.com` plus 2-3 internal teammates.
Once status flips to **In production**, this list is ignored.

---

## Tab 4: Summary / Publishing status

### App type
**Select:** `External`

**Why:** Public Marketplace = External. Internal would limit to a single Workspace org.

### User type
**Select:** `External`

### Publishing status
**Final state:** `In production`

**Critical:** the app must be in `In production` AT submission time. A Marketplace listing cannot reference a consent screen still in `Testing`. Click **Publish App** and complete the verification flow before opening the Marketplace SDK form.

---

## Common rejection reasons (mitigations)

| # | Reason | Mitigation |
|---|--------|------------|
| 1 | Logo too low-res or contains text | Use 120×120 PNG transparent, icon-only mark; see assets-spec.md |
| 2 | Privacy policy URL returns 404 / 5xx | Curl the URL pre-submit; ensure it lives on praeventio.net (not Notion) |
| 3 | Authorized domains mismatch (e.g. policy on `docs.praeventio.net` not in list) | Enumerate every subdomain you reference; add ALL to authorized list |
| 4 | Scope justification too technical / no user benefit | Re-write in plain Spanish-CL, lead with "el trabajador necesita…"; see scope-justifications.md |
| 5 | App still in "Testing" status at submission time | Click Publish App + finish OAuth verification BEFORE filing Marketplace listing |
| 6 | App name mismatch between OAuth screen and Marketplace SDK | Pick one canonical name (Guardian Praeventio); propagate to manifest, package.json, listing |
| 7 | Reviewer cannot reproduce a sensitive scope use case | Submit a screencast (Loom/YouTube unlisted) showing exactly when we call Calendar/Drive |
| 8 | Sensitive scope used without disclosed in-app context | Add a clear pre-OAuth screen in the app explaining "We will create calendar events for…" |
| 9 | Privacy policy doesn't enumerate Google scopes by name | Update privacy policy to list every scope and what we do with it |
| 10 | Developer contact bounces | Verify mailbox active before submit; check spam folder during the 5-15 day review |

---

## Submission timing

- **OAuth verification (sensitive scopes path):** 5-15 business days. Plan for 4 weeks calendar end-to-end.
- **Hard date risk:** the Google Fit deprecation announcement (sunset 2026-12-31) means our Fit scopes would block verification. We removed them from the manifest; double-check before clicking Submit.
- **Reviewer questions arrive at User Support email (Field 2)**, NOT Developer contact. Monitor `soporte@praeventio.net` daily during review.
