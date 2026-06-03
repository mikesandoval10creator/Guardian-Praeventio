# DEEP — Lote EXI-30 · I-BUILD (terraform + build config + scripts) · 2026-06-03

**Atestación: 55/55 archivos leídos línea por línea.**
DERIVA: `docs/audits/file-ledger/ledger.json` filtrado por
`category === "I-BUILD"` (132 matches), ordenado por `path`, slice `[55:110]`
→ 55 archivos. Lista verificada vía Node contra el ledger.

> No-repetición: el doc previo que el usuario referencia (`DEEP-EXI-29.md`) **no
> existe** en el repo; el último EXI presente es `DEEP-EXI-28.md` (I-PLAT:
> fastlane + capacitor-mesh + forceGraphWorker, slice [55:72]). Cero solape: ese
> lote cubrió código nativo móvil; este cubre el módulo Terraform completo,
> config de build raíz (lighthouse/nginx/playwright/metadata) y ~30 scripts
> (`scripts/*`). Foco de este lote: secretos hardcodeados, guards no-wired,
> gates que no fallan CI, codemods peligrosos, Dockerfile/nginx hardening,
> firestore/storage rules, scripts con Math.random/eval/inyección, bugs reales.

---

## Hallazgos

### 🔴 N1 — Directivas #13 y #17 declaran guards "wired in PR #514" pero `precommit-stub-guard.cjs` y `precommit-allowbackup-guard.cjs` están COMPLETAMENTE sin cablear (dead guards)
`.husky/pre-commit` ejecuta SOLO 4 guards:
```
node scripts/precommit-medical-guard.cjs
node scripts/check-convention-guard.cjs
node scripts/validate-i18n.cjs
node scripts/check-any-ratchet.cjs
```
`grep -rn "precommit-allowbackup-guard|precommit-stub-guard"` sobre `.husky/`,
`.github/workflows/` y `package.json` → **cero matches** (exit 1). Sin embargo:
- CLAUDE.md directiva **#13** (anti-stub-disfrazado): «Enforced by
  `scripts/precommit-stub-guard.cjs` (wired in PR #514)».
- CLAUDE.md directiva **#17** (`allowBackup="false"`): «Enforced by
  `scripts/precommit-allowbackup-guard.cjs` (wired in PR #514)».
- El propio header de `precommit-allowbackup-guard.cjs:17-19` admite: «PR #514
  wires this script into .husky/pre-commit. THIS PR does NOT modify
  .husky/pre-commit».

Ambos scripts existen y son funcionalmente correctos, pero NINGUNO está en el
hook, en CI, ni en un npm script. Resultado: dos controles de seguridad que el
proyecto **documenta como activos** están dormidos. El de `allowBackup` protege
contra extracción de la SQLCipher DB vía `adb backup` sin root (directiva #16/#17
juntas); el de stub-disfrazado es el seal anti-mock en `src/server/`. Un
`android:allowBackup="true"` o un stub nuevo pasarían sin fricción. Es una
invariante documentada rota — exactamente el tipo de drift que la Regla #1 de
TODO.md (nada ✅ sin file:line) intenta prevenir.

### 🟡 N2 — Los ratchets de seguridad (`check-convention-guard` Rule#3/#19, `check-any-ratchet`, medical, i18n) corren SOLO en husky pre-commit, NO en CI → bypaseables con `git commit --no-verify` sin backstop
`ci.yml` tiene 10 jobs: `roles-sync`, `typecheck`, `test`, `validate-env`,
`rules-tests`, `firestore-stores`, **medical-guard** (sí está en CI, L170-203),
`build`. **No hay job de lint** (`npm run lint` no se ejecuta en ningún
workflow) ni de `lint:conventions` / `lint:any`. El único guard de los cuatro
del husky que tiene backstop en CI es el medical. Los otros tres
(convention-guard que enforcea la invariante audit-log #3 y el tracker #19;
any-ratchet de type-safety; i18n parity #18) dependen exclusivamente del hook
local. `--no-verify` (que la propia directiva #10 prohíbe pero el harness no
puede forzar) o un push desde un entorno sin husky instalado los saltea sin que
CI lo note. Para invariantes de cumplimiento (audit-log append-only) esto es
deuda real: la regla existe pero el enforcement es opcional en la práctica.

### 🟡 N3 — `canary-monitor.cjs`: la baseline de Sentry usa la MISMA ventana que el "now" ⇒ el ratio es siempre ~1.0 y ROLLBACK/WATCH por errores nunca dispara honestamente
`canary-monitor.cjs:141-142`:
```js
const sentryNow  = await sentryEventCount(args.duration);
const sentryBase = await sentryEventCount(args.duration); // same call shape; replace with 7d-ago window…
```
Ambas llamadas piden el MISMO rango temporal (últimos `duration` minutos). En
`decide()` (L118-127) el `ratio = currentErrors / baselineErrors` por lo tanto da
~1.0 SIEMPRE (salvo jitter entre dos requests consecutivos), así que las ramas
`ratio>2 → ROLLBACK` y `ratio≥1.5 → WATCH` son estructuralmente inalcanzables.
El comentario inline reconoce el defecto («replace with 7d-ago window when API
key has historical access») y hay un helper `weekAgoMinusMinutesIso()` (L48-50)
**definido pero nunca usado** — la implementación correcta quedó a medias. El
monitor post-deploy reporta GREEN casi siempre; su valor de detección de
regresiones por error-rate es nulo. Mitigante: el script siempre sale 0 y es
informativo (el caller decide), y `--baseline <sha>` solo nombra el reporte; no
es un gate de CI. Pero es un guard que da falsa confianza.

### 🟡 N4 — `firestore-pentest.mjs` afirma un job de CI inexistente
`firestore-pentest.mjs:13-14`: «CI integration: see the `firestore-pentest` job
in `.github/workflows/ci.yml`». No existe tal job en ningún workflow
(`grep firestore-pentest .github/workflows/*.yml` → vacío). La Dirty Dozen
(`src/rules-tests/dirtyDozen.test.ts`, presente) SÍ corre, pero por el job
genérico `rules-tests` que ejecuta todo `src/rules-tests/**` vía
`vitest.rules.config.ts`, no por un job dedicado. Doc-vs-código: el comentario
miente sobre el cableado; el efecto neto (la suite corre) es benigno, de ahí
🟡 y no 🔴.

### 🔵 N5 — `migrate-oauth-tokens-to-envelope.cjs` re-envuelve `refresh_token` PII en Firestore SIN escribir `audit_logs` (directiva #3)
El script (L159-165) hace `doc.ref.update({ refresh_token: envelope, … })` sobre
la colección `oauth_tokens` (material sensible: tokens OAuth de refresh) y nunca
emite un evento de auditoría. La directiva #3 («every state-changing operation
MUST write to `audit_logs`») apunta a operaciones de servidor; este es un script
de migración one-off ops-only, de ahí 🔵 y no 🔴. Aun así, una re-envoltura
masiva de credenciales sin rastro en el trail de cumplimiento es una brecha de
observabilidad. Además es un `.cjs` que hace `await import('../src/.../*.ts')` →
requiere ejecutarse bajo `tsx` (documentado en el header), no `node` plano.

### 🔵 N6 — `generate-ar-usdz.mjs` valida `body.ok && body.signedUrl` pero luego accede `body.sha256.slice(...)` sin chequear → TypeError si el converter no retorna sha256
`generate-ar-usdz.mjs:118` valida `if (!body.ok || !body.signedUrl)` pero L136
hace `body.sha256.slice(0, 12)` en el log de éxito. Si el Cloud Run converter
omite `sha256` el script lanza `Cannot read properties of undefined` DESPUÉS de
haber escrito el `.usdz` (L128) — el archivo queda bien, pero el loop aborta y
los kinds restantes no se convierten. Robustez menor (tool de build interno).

### 🔵 N7 — `cli/praeventio.mjs`: ternario de credencial no-op + comandos de mutación sin audit_logs
`praeventio.mjs:61-64`: `credential: process.env.GOOGLE_APPLICATION_CREDENTIALS
? admin.credential.applicationDefault() : admin.credential.applicationDefault()`
— ambas ramas idénticas (dead ternary; probablemente quiso `cert(path)` en la
rama true). Funciona porque ADC cubre ambos casos, pero es código muerto.
Además `grant-tier`, `seed-tenant`, `simulate-emergency`, `flush-cache` mutan
Firestore (incl. `customers.tier`, que es tier-gating server-side, directiva #11)
sin `audit_logs`. Es un CLI admin local invocado por humano con SA, no una ruta
HTTP, de ahí 🔵; pero `grant-tier` sí cambia un campo de facturación sin trail.

### 🔵 N8 — `metadata.json` declara `requestFramePermissions: ["camera","microphone","geolocation"]`
`metadata.json:4` (artefacto AI-Studio) pide los tres permisos de frame de alto
riesgo. Es metadata declarativa del entorno de preview, no un manifiesto de
producción (Capacitor usa AndroidManifest/Info.plist, ya auditados en EXI-28);
el `Permissions-Policy` real de runtime lo fija `nginx.conf:42`
(`geolocation=(self), camera=(self), microphone=(self), payment=()`). Sin
impacto productivo, se anota por completitud.

### 🔵 N9 — `nginx.conf` sin CSP `script-src` (auto-documentado) + `dr-failover.sh` despliega DR público
Dos notas menores honestas:
- `nginx.conf:5-6,37` documenta explícitamente que NO setea `script-src` CSP
  («SPA bootstraps Sentry+Firebase from third-party domains, not emitting
  nonces»). Mitigado parcialmente con `frame-ancestors 'none'` + `X-Frame-Options
  DENY` + `nosniff`. Deuda conocida, no oculta.
- `dr-failover.sh:70-79` despliega el servicio DR SIN `--no-allow-unauthenticated`
  (a diferencia de `dr-simulate.sh:75` que sí lo pone) — pero eso es correcto:
  el endpoint productivo es público, el DR debe espejarlo. Región DR
  (`us-central1`/`us-east1`) difiere de la app (`southamerica-west1`) por diseño
  geográfico. Sin hallazgo real.

---

## Tabla (55 archivos)

| # | Archivo | LOC | Sev | Nota |
|---|---|---|---|---|
| 55 | infrastructure/terraform/dashboards/operational.json | 233 | ✅ | Dashboard CR/Firestore/KMS; sin alta cardinalidad. |
| 56 | infrastructure/terraform/example.tfvars | 31 | ✅ | Solo project_id/region/labels; .gitignore protege *.tfvars. |
| 57 | infrastructure/terraform/iam.tf | 72 | ✅ | 3 SAs, least-privilege (KMS/secrets a nivel recurso). |
| 58 | infrastructure/terraform/kms.tf | 67 | ✅ | KEK 90d rotation, prevent_destroy, IAM key-level. |
| 59 | infrastructure/terraform/main.tf | 61 | ✅ | Backend GCS comentado (state local solo dev). |
| 60 | infrastructure/terraform/monitoring.tf | 758 | ✅ | 6 SLOs + absent-data companions; thresholds CALIBRATE. |
| 61 | infrastructure/terraform/outputs.tf | 60 | ✅ | Outputs no-sensibles (resource names/emails). |
| 62 | infrastructure/terraform/scheduler.tf | 79 | ✅ | OIDC (no oauth), audience==URI, v2 API. |
| 63 | infrastructure/terraform/secrets.tf | 41 | ✅ | Solo recursos, valores out-of-band; prevent_destroy. |
| 64 | infrastructure/terraform/storage.tf | 85 | ✅ | UBLA + public_access enforced + retention + versioning. |
| 65 | infrastructure/terraform/variables.tf | 137 | ✅ | Tipado + validación environment; defaults sanos. |
| 66 | infrastructure/terraform/versions.tf | 36 | ✅ | TF>=1.6, google ~>5.0 pinneado. |
| 67 | lighthouserc.json | 36 | ✅ | a11y/best-practices=error; perf/seo/pwa=warn. |
| 68 | metadata.json | 5 | 🔵 | N8 pide camera/mic/geo (metadata AI-Studio, no prod). |
| 69 | nginx.conf | 71 | 🔵 | N9 sin script-src CSP (auto-documentado); resto OK. |
| 70 | package-lock.json | — | ✅ | Lockfile npm (no leído línea-a-línea; generado). |
| 71 | package.json | — | 🟡 | N1/N2: lint:conventions/lint:any definidos, NO en CI. |
| 72 | playwright.config.ts | 121 | ✅ | locale es-CL fijo; E2E secret solo en E2E_MODE. |
| 73 | scripts/analyze-coverage.cjs | 35 | ✅ | One-off coverage report; puro. |
| 74 | scripts/any-ratchet-baseline.json | — | ✅ | total=160 as-any; baseline monotónico. |
| 75 | scripts/audit-coverage-census.cjs | 197 | ✅ | Coverage Book; gate UNMAPPED==0; honesto. |
| 76 | scripts/backfill_bcn_norma_id.cjs | 206 | ✅ | dry-run default; idempotente; batches de 450. |
| 77 | scripts/backup-firestore.cjs | 259 | ✅ | LRO con timeout 50min; manifest best-effort. |
| 78 | scripts/biorender-references.json | — | ✅ | Solo metadata pública (license-safe). |
| 79 | scripts/canary-monitor.cjs | 199 | 🟡 | N3 baseline == now → ratio siempre ~1.0, no detecta. |
| 80 | scripts/check-any-ratchet.cjs | 169 | 🟡 | Guard correcto pero solo husky (N2). |
| 81 | scripts/check-convention-guard.cjs | 175 | 🟡 | Enforcea #3/#19 pero solo husky, no CI (N2). |
| 82 | scripts/check-coverage-ratchet.cjs | 147 | 🟡 | Sin npm script NI CI: guard sin cablear (N2-relacionado). |
| 83 | scripts/check-frozen.cjs | 77 | ✅ | PreToolUse hook; fail-open ante freeze.json malo. |
| 84 | scripts/check-mutation-thresholds.cjs | 229 | ✅ | Wired en mutation.yml; ratchet+critical floors. |
| 85 | scripts/cli/praeventio.mjs | 348 | 🔵 | N7 ternario muerto + mutaciones sin audit_logs. |
| 86 | scripts/compute-slm-sha256.mjs | 140 | ✅ | Regex-injection fix (whitelist+escape) verificado. |
| 87 | scripts/convention-guard-baseline.json | — | ✅ | rule3_pending vacío; exempts documentados. |
| 88 | scripts/convert-to-webp.mjs | 127 | ✅ | mtime-aware; skip SVG biology; puro. |
| 89 | scripts/coverage-floors.json | 11 | ✅ | Floors globales 50/48/44/44; files{} vacío. |
| 90 | scripts/debug_browser.mjs | 29 | ✅ | Debug local playwright; puerto hardcoded inofensivo. |
| 91 | scripts/download-mediapipe-models.mjs | 274 | ✅ | Stream+sha256+.partial; sha null = warn (honesto). |
| 92 | scripts/download-slm-model.mjs | 192 | ✅ | EXPECTED_SHA256 null documentado; .partial atomic. |
| 93 | scripts/dr-failover.sh | 116 | 🔵 | N9 DR público (correcto); DNS flip manual. |
| 94 | scripts/dr-simulate.sh | 108 | ✅ | --no-allow-unauth + trap teardown; no toca DNS. |
| 95 | scripts/fill-android-assetlinks.mjs | 298 | ✅ | sha256 validado colon-hex; dry-run; no-op idempotente. |
| 96 | scripts/fill-ios-aasa.mjs | 204 | ✅ | TeamID regex 10-char; walk estructurado, no replace naïve. |
| 97 | scripts/firestore-pentest.mjs | 66 | 🟡 | N4 afirma job CI inexistente; suite igual corre. |
| 98 | scripts/fix-mojibake.mjs | 221 | ✅ | Byte-level; --check con detector residual; tabla amplia. |
| 99 | scripts/generate-ar-models.mjs | 229 | ✅ | gltf-transform; geometría cilindro; bbox accessor OK. |
| 100 | scripts/generate-ar-usdz.mjs | 151 | 🔵 | N6 body.sha256 sin guard → TypeError post-write. |
| 101 | scripts/generate-medical-icons.mjs | 282 | ✅ | Prompts originales (no copia); 429 backoff; ADR-0004. |
| 102 | scripts/generateZettelkastenMarkdown.ts | 53 | ✅ | One-shot generador MD desde registries; puro. |
| 103 | scripts/i18n-parity-baseline.json | — | ✅ | en=[] vacío; pt-BR pending listado (ratchet #18). |
| 104 | scripts/migrate-auth-headers.mjs | 218 | ✅ | Codemod con pattern EXACTO; skip = manual; dry-run. |
| 105 | scripts/migrate-oauth-tokens-to-envelope.cjs | 189 | 🔵 | N5 re-wrap PII sin audit_logs; requiere tsx. |
| 106 | scripts/pinecone-bootstrap.mjs | 173 | ✅ | Idempotente; solo CL_PACK público; Zettelkasten nunca. |
| 107 | scripts/ply_to_glb.py | 57 | ✅ | Blender bpy; decimate; sin red/inyección. |
| 108 | scripts/precommit-allowbackup-guard.cjs | 105 | 🔴 | N1 correcto pero SIN cablear (directiva #17 miente). |
| 109 | scripts/precommit-medical-guard.cjs | 172 | ✅ | Wired husky+CI; ADR-0012; scope+disclaimer+prompts. |

Leyenda: ✅ ok · 🟡 deuda/bug real · 🔵 backend/infra nota menor · 🔴 invariante rota.

## Archivos limpios (sin hallazgo 🔴/🟡)
55-67 (excepto nada), 70, 72-78, 83-92, 94-96, 98-99, 101-104, 106-107, 109 →
**43/55 limpios**. Con 🔵 nota menor: 68, 69, 85, 93, 100, 105 (6). Con 🟡 deuda
real: 71, 79, 80, 81, 82, 97 (6). Con 🔴 invariante rota: 108 (1; N1 también
toca `precommit-stub-guard.cjs`, fuera del slice pero confirmado sin cablear).
Terraform (12 archivos, 55-66): **100% limpio** — IAM least-privilege, KMS con
prevent_destroy+rotation, storage con UBLA/public-access-enforced/retention,
scheduler OIDC, secrets sin valores. Cero secretos hardcodeados en todo el lote.

---

## Resumen (6-10 líneas)

Lote EXI-30 — 55/55 archivos I-BUILD (módulo Terraform completo + config build
raíz + ~30 scripts) leídos línea por línea. El módulo Terraform es ejemplar:
IAM least-privilege a nivel recurso, KEK con rotación 90d y prevent_destroy,
bucket de backups con UBLA + public-access-enforced + retention policy + object
versioning, scheduler OIDC (no oauth), secrets solo como recursos sin valores en
state. Cero secretos hardcodeados en los 55 archivos. **🔴 N1**: las directivas
CLAUDE.md #13 (stub-guard) y #17 (allowbackup-guard) afirman «wired in PR #514»
pero NINGUNO de los dos está en `.husky/pre-commit`, CI ni package.json — dos
controles de seguridad documentados como activos están dormidos (el propio
header del allowbackup-guard lo admite). **🟡 N2**: los ratchets restantes
(convention #3/#19, any-ratchet, i18n) corren SOLO en husky pre-commit, no en
CI; `check-coverage-ratchet.cjs` no tiene ni npm script ni CI — bypaseables con
`--no-verify` sin backstop (solo el medical-guard tiene job CI). **🟡 N3**:
`canary-monitor.cjs` calcula la baseline de Sentry con la misma ventana que el
"now", así que el ratio es siempre ~1.0 y ROLLBACK/WATCH por errores nunca
dispara (defecto auto-reconocido, helper `weekAgoMinusMinutesIso` definido y sin
usar). **🟡 N4**: `firestore-pentest.mjs` cita un job CI que no existe (la suite
igual corre vía `rules-tests`). 🔵 menores: migración OAuth re-envuelve PII sin
audit_logs (N5); `generate-ar-usdz` accede `body.sha256` sin guard (N6); CLI
admin con ternario muerto + mutaciones sin audit (N7); `metadata.json` pide
camera/mic/geo (N8). Codemods (`migrate-auth-headers`, `fix-mojibake`) son
seguros: pattern EXACTO, byte-level, dry-run. Doc-only, sin commit.
