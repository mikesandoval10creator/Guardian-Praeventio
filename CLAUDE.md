# CLAUDE.md

Guidance for AI coding assistants working in this repository. Keep this file
short and high-signal: it points at the canonical docs rather than duplicating
them.

## What this project is

**Praeventio Guard** — occupational risk-prevention PWA for critical industries
in Latin America (mining, construction, remote operations). Compliance target:
Chile (Ley 16.744, DS 44/2024 [vigente 01-02-2025, deroga DS 40 y el ex DS 54], DS 594); extensible to other LATAM regimes.

- Frontend: React 19 + Vite + TypeScript + Tailwind 4, React Router 7, 219
  lazy-loaded pages under `src/pages/`.
- Backend: a single Express process (`server.ts` + `src/server/`) booted with
  `tsx`. Vite runs in `middlewareMode` inside the same process — **do not
  start Vite separately**.
- Persistence: Firestore (server via Firebase Admin SDK) + IndexedDB/SQLite
  offline on device.
- AI: `@google/genai` (Gemini); proxied server-side via whitelisted action
  names.
- Mobile: Capacitor 8 wraps the SPA for Android/iOS.
- Node 20 LTS, `npm` 10+ (no pnpm/yarn — lockfile is npm).

The repo includes `.npmrc` with `legacy-peer-deps=true`; use `npm install` /
`npm ci` as-is.

## Canonical docs — read these before larger changes

| File | When to read |
|---|---|
| `README.md` | Project overview, stack, deploy summary. |
| `CONTRIBUTING.md` | TDD flow, route/Gemini/calc-engine patterns, PR checklist. |
| `ARCHITECTURE.md` | Module map, data flows (Webpay, REBA, curriculum claims), `server.ts` / `geminiBackend.ts` split plans, Firestore inventory, tier-gating. |
| `RUNBOOK.md` + `docs/runbooks/` | Operational procedures (emulator, Cloud Run, KMS, backups, incident response). |
| `DR_RUNBOOK.md` | Production emergencies. |
| `SECURITY.md` + `security_spec.md` | Threat model, "Dirty Dozen" rejected payloads. |
| `docs/api-routes.md` | Catalogue of HTTP endpoints (auth, body, errors, audit log, tenant isolation). |
| `BILLING.md`, `KMS_ROTATION.md` | Required before touching payments or KMS. |
| `TODO.md` | Single source of truth for functional state. Rule #1: nothing marked ✅ without a `file:line` reference. |
| `docs/architecture-decisions/` | ADRs. ADR 0012 (no medical diagnosis) is enforced by a pre-commit hook — see below. |

If a doc and the code disagree, **the code is the source of truth** — open a
PR to fix the doc.

## Repository layout (essentials)

```
server.ts                       # Express entry point (~1.4k LOC, mid-split)
src/
├── pages/                      # Top-level features (lazy-routed)
├── components/                 # Shared UI (modals, wizards, charts)
├── routes/                     # React Router 7 route groups (lazy chunks)
├── contexts/                   # Global providers (Firebase, Project, Subscription, Emergency, …)
├── hooks/                      # 176 custom hooks (data fetching, sensors, AI)
├── store/                      # Zustand stores (migrating via createProjectScopedStore factory)
├── services/                   # Domain services + clients
│   ├── geminiBackend.ts        # Server-side Gemini actions (split in progress → src/services/gemini/*)
│   ├── geminiService.ts        # Client HTTP wrapper for /api/gemini
│   ├── ergonomics/             # Pure calc engines (REBA, RULA) — mutation-tested
│   ├── protocols/              # IPER, PREXOR, TMERT — mutation-tested
│   └── safety/                 # ergonomicAssessments, iperAssessments — mutation-tested
├── server/                     # Server-side modules being extracted from server.ts
│   ├── routes/                 # One file per domain (admin, billing, gemini, curriculum, …)
│   ├── middleware/             # verifyAuth, validate, limiters, securityHeaders, …
│   ├── triggers/               # Firestore listeners, system engine
│   ├── jobs/                   # Cron-ish jobs (expiry sweeps, digests, reminders)
│   └── services/               # userLifecycle, etc.
├── data/normativa/             # BCN + ISO + NCh corpus (RAG source)
├── i18n/locales/               # es-CL default + es-AR/MX/PE, en, pt-BR, fr, de, it, ja, ko, zh-CN/TW, hi, ar, ru
├── rules-tests/                # Firestore rules tests (vitest.rules.config.ts)
└── __tests__/                  # Vitest suites incl. server/ (supertest), scripts/, contracts/
packages/capacitor-mesh/        # Local workspace package (mesh information relay)
firestore.rules                 # 1k+ LOC default-deny with per-collection RBAC
public/                         # PWA assets + .well-known (PGP, AASA, assetlinks)
scripts/                        # CJS/MJS utilities (codemods, downloads, guards)
docs/                           # Runbooks, ADRs, audits, sprints, plans
```

## Day-to-day commands

```bash
npm run dev               # Express + Vite middleware on http://localhost:3000
npm run typecheck         # tsc --noEmit (must be 0 errors before PR)
npm run test              # vitest run (default suite, excludes firestore + rules)
npm run test:rules        # vitest against Firestore emulator (requires firebase-tools + Java 21)
npm run smoke             # quick pre-merge smoke
npm run lint              # eslint src/**/*.{ts,tsx} + server.ts + firestore.rules
npm run lint:rules        # only firestore.rules (Firebase security plugin)
npm run build             # vite build → dist/ (prebuild downloads mediapipe + renders .well-known)
npm run validate:env      # rejects placeholders / short secrets; run before boot
npm run mutation          # Stryker over safety calc engines (5–30 min)
npm run test:e2e          # Playwright (chromium). :e2e:full spins up the Firestore emulator.
npm run cap:android       # build + cap sync + open Android Studio
```

Skip flaky/expensive paths only when you know why: `test:rules` needs the
emulator running, `mutation` needs ≥10 min of CPU. CI runs typecheck, tests,
validate-env, rules-tests, mobile-signing, lint, e2e, perf, codeql, ossar.

## Hard conventions (don't violate without explicit user approval)

1. **TDD strict** (RED → GREEN → REFACTOR). UI cosmetic / copy / one-shot
   codemod changes are documented exceptions. Tests live next to source as
   `*.test.ts(x)` or under `src/__tests__/<area>/`.
2. **Spanish-CL for user-facing copy** (UI strings, emails, PDFs); **English
   for code, comments, logs, commits**. RUTs `12.345.678-K`, CLP
   `$1.234.567`, dates `DD-MM-YYYY`.
3. **Audit-log invariant**: every state-changing operation MUST write to
   `audit_logs`. Server stamps `userId` / `userEmail` from the verified
   token — never trust client-supplied identity. `audit_logs` is append-only
   by Firestore rules (`create:true, update:false, delete:false`).
4. **Firestore default-deny.** A new collection requires (a) explicit rules
   in `firestore.rules`, (b) ≥5 rules tests covering owner-allow, non-member-deny,
   schema-violation-deny, post-sign update-deny, server-field-spoof-deny, and
   (c) an entry in `security_spec.md` (Dirty Dozen). PII/medical collections
   also need a KMS rotation entry.
5. **/api/gemini whitelist.** New Gemini actions MUST be added to
   `ALLOWED_GEMINI_ACTIONS` (around `src/server/routes/gemini.ts` — verify
   line before editing) AND exported from `geminiBackend.ts` (or
   `src/services/gemini/*` post-split). Wrap `JSON.parse(response.text)` in
   try/catch with a typed fallback or 502.
6. **No new server route without `verifyAuth`** unless deliberately public
   (health, signed webhooks, magic-link tokens) — and even then, document why
   inline. Routes accepting `projectId` MUST call
   `assertProjectMember(uid, projectId, db)` before any write.
7. **Server.ts split is in progress.** Prefer adding new domain routes under
   `src/server/routes/<domain>.ts` mounted via `app.use(router)` rather than
   growing `server.ts`. Check the existing routes directory before editing the
   monolith.
8. **5xx error bodies never leak internals.** Use
   `process.env.NODE_ENV === 'production' ? "Internal server error" : err.message`.
9. **Safety calc engines are pure functions** under `src/services/{ergonomics,
   protocols,safety}/*`. No side effects, no Firestore reads, deterministic.
   They are mutation-tested — keep mutation score ≥ baseline (see
   `docs/testing/MUTATION_BASELINE.md`).
10. **No diagnosis (ADR 0012).** Code under `src/services/health/`,
    `src/services/medicine/`, `src/components/health/`,
    `src/components/medicine/`, `src/components/hygiene/`,
    `src/pages/Health*.tsx`, `src/pages/MyData.tsx`,
    `src/pages/Medicine.tsx` is scanned by `scripts/precommit-medical-guard.cjs`
    (Husky hook). Banned: `inferDiagnosis`, `assessClinicalRisk`,
    `suggestTreatment`, `predictPathology`, `diagnoseFromExam`,
    `categorizeAsProfessional`, `calificarComoLaboral`,
    `inferOccupationalDisease`, diagnostic-shaped Gemini prompts, and medical
    views that don't render `<MedicalDisclaimer/>`. Don't bypass with
    `--no-verify`.
11. **Tier-gating enforcement always lives server-side.** Frontend gating in
    `SubscriptionContext` is UX-only; the canonical rank check is reading
    `users/{uid}.subscription.planId` and comparing against `RANK_*` (use the
    `requireTier(minPlan)` middleware). **Life-safety features are FREE on every
    tier (incl. `free`) and MUST NEVER be tier-gated** — SOS, emergency,
    ManDown, lone-worker, evacuation, brigade, DEA, incident/hazard reporting,
    and a worker reading their OWN prevention records. Tier-gating applies ONLY
    to management/scale/convenience (integrations, analytics, branding,
    multi-tenant, worker/project limits). See ADR 0021.
12. **Biometric processing is 100% on-device** (MediaPipe Vision, Health
    Connect, HealthKit). No camera frames or heart rate leave the device.
13. **Anti-stub-disfrazado.** Code that returns mock data or throws
    `NotImplementedError` MUST: (a) have an inline `// TODO(sprint-N):
    <owner>` comment, (b) be invisible to end users (feature flag gate or
    return HTTP 503), (c) have a test that pins the placeholder's shape,
    (d) be registered in `docs/stubs-inventory.md`. Enforced by
    `scripts/precommit-stub-guard.cjs` (shipped in PR #514; wired into `.husky/pre-commit` 2026-06).
14. **Audit log calls MUST be `await`ed.** `void auditServerEvent(...)`
    is banned because Firestore failures silently break the compliance
    trail. Pattern: `try { await auditServerEvent(...); } catch (err) {
    logger.error('audit_event_failed', ...); Sentry.captureException(err);
    }`. The original response must still succeed — audit failure is
    severe but non-blocking for the user-facing action.
15. **`Math.random()` banned in `src/server/` and any ID-generation
    code.** Use `randomId()` from `src/utils/randomId.ts` (which wraps
    `crypto.randomUUID()` with a documented fallback). Exception: test
    files with seeded determinism. Enforced by ESLint custom rule +
    `scripts/precommit-stub-guard.cjs`.
16. **SQLite on-device encryption is mandatory.**
    `sqliteConnection.createConnection(name, false, "encryption", 1,
    false)` with passphrase ≥32 bytes from Keychain/Keystore via
    `@capacitor/preferences`. Never use `"no-encryption"`. Smoke test:
    raw DB file bytes 16+ should not start with the ASCII `S` SQLite
    plaintext header.
17. **Android `allowBackup="false"` by default.** `adb backup` allows
    data extraction without root. If you have a legitimate reason to set
    it `"true"`, add an inline XML comment explaining why. Enforced by
    `scripts/precommit-allowbackup-guard.cjs` (shipped in PR #514; wired into `.husky/pre-commit` 2026-06).
18. **Locale parity.** The launch locales (`es` reference + `en`, `pt-BR`)
    must stay at key parity: a key present in `src/i18n/locales/es/common.json`
    MUST also exist in `en` and `pt-BR`. Enforced by
    `scripts/validate-i18n.cjs` (ratchet baseline
    `scripts/i18n-parity-baseline.json`) — `npm run lint:i18n`, the husky
    pre-commit hook, and the CI vitest gate
    `src/__tests__/scripts/i18nParity.test.ts`. A NEW `es` key with no
    `en`/`pt-BR` translation fails the gate. Lazy/stub locales (`fr`, `de`,
    `it`, `ja`, `zh-CN`, `ar`, `ko`, `hi`, `zh-TW`, `ru`) are out of scope by
    design — they are dynamically imported and covered by the `en`→`es`
    fallback chain (`src/i18n/index.ts`).
19. **Read-modify-write in server requires `runTransaction`.** If a
    handler does ≥2 `get()` calls AND ≥1 `set()`/`update()` call on the
    same document path, it MUST wrap them in `db.runTransaction(...)`.
    Candidates flagged for audit: `incidentTrends.ts`, `visitors.ts`,
    `apprenticeship.ts`, `culturePulse.ts`, `cphsMinute.ts`,
    `knowledgeBase.ts`.
20. **Doc-vs-code sync.** Any PR that modifies `src/services/<X>.ts` by
    more than 50 LOC MUST update the LOC count in `ARCHITECTURE.md` if
    that file is referenced there. Avoids the doc drift that produced
    "geminiBackend.ts 2666 LOC" in ARCHITECTURE.md when the real number
    was 2923.

## Testing notes specific to this repo

- Vitest **4** is in use. The legacy `environmentMatchGlobs` option is gone —
  React component tests must put `// @vitest-environment jsdom` at the top
  of the file. Default environment is `node`.
- `*.firestore.test.ts` are excluded from `npm test` and run only via
  `vitest.firestore.config.ts` against the emulator. Don't move them.
- Server tests use `supertest`; pattern consolidated in
  `src/__tests__/server/*.test.ts` (33 files). Minimum coverage for a new
  route: 401 (no token), 200 happy path, 400/403/404 validation paths.
- Mutation testing: `npm run mutation`, or domain-scoped variants
  (`test:mutation:auth|slm|ergonomics|protocols|safety`). Thresholds in
  `stryker.config.json` (high 80 / low 60 / break 50).

## Claude Code harness in this repo

- `.claude/settings.json` registers a `PreToolUse` hook on
  `Edit|Write|MultiEdit|NotebookEdit` that runs `scripts/check-frozen.cjs`.
  Honor `.claude/freeze.json` when it exists: writes outside frozen paths are
  blocked. The companion slash commands (`/freeze`, `/unfreeze`, `/guard`,
  `/careful`) live in `.claude/commands/` and are user-invoked.
- Other available commands worth knowing about:
  - `/cso-praeventio` — adversarial security review against OWASP Top 10 +
    STRIDE + prompt-injection + Praeventio directives.
  - `/cross-review`, `/cross-review-vs-codex` — second-opinion review.
  - `/canary`, `/retro`, `/design-html`.
- `.mcp.json` ships a single MCP server: `context-optimizer`.
- The Husky `pre-commit` hook (`.husky/pre-commit`) runs the medical guard
  noted above — it runs on `git commit`, independent of the Claude harness.

## Environment + secrets

- `.env.example` is the canonical template, fully annotated. Copy to
  `.env.local` (gitignored). Anything matching `<...>`, `YOUR_*`,
  `MY_*`, `REPLACE_*`, `PLACEHOLDER` is rejected in prod mode by
  `scripts/validate-env.cjs`.
- Minimum to boot: `GEMINI_API_KEY`, `SESSION_SECRET`
  (`openssl rand -hex 32`).
- `firebase-applet-config.json` is the PUBLIC Firebase **client** config
  (projectId / apiKey / authDomain / firestoreDatabaseId — NO service-account
  private key). It is git-TRACKED and intentionally baked into the image: vite
  bundles it into the client (`src/services/firebase.ts`) and `server.ts` reads
  it at startup to select the non-default Firestore DB. The real Firebase
  **Admin** credential comes from ADC / Workload Identity
  (`admin.credential.applicationDefault()`), never from this file. (Firebase Web
  apiKey/projectId are public by design — access is gated by Firestore Rules +
  App Check, not by hiding them.)
- Never commit a real `.env*`. Step-by-step provisioning per variable is in
  `docs/runbooks/SECRETS_RUNBOOK.md`.

## Git workflow

- Branch naming: `feat/`, `fix/`, `audit/`, `refactor/`, `test/`, `docs/`,
  `chore/`, `security/`, or `claude/<short-slug>`.
- Commit style: `<type>(<scope>): <imperative>` (Conventional-ish). Body
  explains the **why**.
- Required green before opening PR: `typecheck`, `test`, `build`, lint clean
  on touched files, Spanish-CL copy verified, audit_logs covered, no secrets
  staged.
- Do **not** push to `main` directly; PRs are the only path. Force-push only
  on your own feature branches and never with `--no-verify`.

## When in doubt

- For "where does X live?", grep first (`rg`, `grep -R`) — the layout above
  covers the conventions.
- For "is this safe to change?", check `security_spec.md` and the relevant
  rules tests under `src/rules-tests/` or `src/__tests__/firestore.rules.*`.
- For "what's the canonical pattern?", read the closest existing peer
  (sibling route, sibling test, sibling calc engine) before inventing a new
  shape.
- For unfamiliar files/branches/lockfile state, **investigate before
  deleting or overwriting** — assume it's the user's in-flight work.

## Active work — Phase 5 remediation (2026-06)

El repo fue auditado por completo (cada archivo leído línea por línea). Estado y hoja de ruta:
- `TODO.md` §2.32 (deuda FEAT) · §2.33 (17 patrones sistémicos) · §2.34 (tests/infra/docs).
- Índices: `docs/audits/file-ledger/DEEP-EX-INDEX.md`, `DEEP-EXT-INDEX.md`, `INDEX-CONSOLIDADO.md`.
- Roadmap de ejecución (checklist por bloque): `docs/audits/file-ledger/PHASE5-REMEDIATION.md`.

PRINCIPIO RECTOR: hacer REAL la app, NO eliminar. Cada función se cablea donde corresponde —
huérfanos→montar, mocks→datos reales, stubs→implementar, duplicados→consolidar (preservar
capacidades). ADR 0012 (no diagnóstico): reconvertir a función conforme, nunca borrar ni habilitar
diagnóstico. Datos legales fabricados (RUT falso, métricas inventadas): exigir el dato real.
Decisiones de arquitectura ya tomadas (COLMAP→on-device §2.28): documentar supersesión, no re-cablear.

La remediación va **un PR por bloque**, vida/privacidad primero
(B1→B7→B3→B16→B2→B17→B5→B12→B4→B8→B9→B6→B10→B11→B13→B14→B15→B18→B-DigitalTwin),
tras **cimientos compartidos** (F1 harness rules-tests real, F2 parseGeminiJson, F3
identidad-desde-token, F4 verify WebAuthn, F5 gobernanza CI). Cross-cutting (dominio/WebAuthn,
iOS mesh UUID, DR replication, voseo es-CL) y doc-drift se intercalan.

Reglas: TDD estricto con tests que ejercitan CÓDIGO REAL (prohibido Admin-SDK en rules-tests,
sembrar el campo del gate, reimplementar el handler, o tests "wire-up" solo router.stack —
catálogo en DEEP-EXT-INDEX.md). Cada cambio de estado escribe audit_logs (server estampa uid/tenant).
Nueva colección = reglas + ≥5 rules-tests (authenticatedContext) + Dirty Dozen en security_spec.md.
Actualizar TODO.md (resuelto con file:line) al avanzar.

Hecho (B1): sosOutbox dead-letter + routingBackend hazard-clearing.

Estado 2026-06-13: el roadmap activo es el plan híbrido controlado `revisa-si-el-workflow-mighty-goose.md` (olas 0-7). **OLA 0 (15 fixes quirúrgicos #866-#880) está CERRADA 2026-06-13** (ver `docs/audits/file-ledger/PHASE5-REMEDIATION.md` §"OLA 0 … CERRADA"); sigue OLA 1 (VIDA visible).
