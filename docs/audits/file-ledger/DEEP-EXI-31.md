# DEEP — Lote EXI-31 · I-BUILD (scripts/build/test config) · 2026-06-03

**Atestación: 22/22 archivos leídos línea por línea.**
DERIVA: `docs/audits/file-ledger/ledger.json` filtrado por
`category === "I-BUILD"` (132 matches), ordenado por `path`, slice `[110:132]`
→ 22 archivos. Lista verificada vía Node contra el ledger.

> No-repetición: `DEEP-EXI-29.md` / `DEEP-EXI-30.md` no existen en el repo
> (la serie EXI llega hasta `DEEP-EXI-28.md`, scope I-PLAT nativo). El
> adyacente `DEEP-EX-29/30` cubre FEAT (B15-Billing / B13-MOC). Cero solape.
> Foco aquí: secretos hardcodeados, guards no-cableados, gates que no fallan
> CI, codemods/inyección, Dockerfile/hardening, firestore.rules/storage.rules
> laxas o colecciones faltantes (cruzado con las ~20 colecciones "sin regla"
> del barrido), `Math.random`/`eval`, bugs reales.

---

## Archivos del lote

| # | Path | Veredicto |
|---|---|---|
| 110 | `scripts/precommit-stub-guard.cjs` | 🟡 N2 (no cableado) |
| 111 | `scripts/prepackage-slm-models.mjs` | 🔵 N6 (parser frágil) · limpio funcional |
| 112 | `scripts/reconstruct_faena.py` | 🔵 N5 (subprocess sin shell, input de server) |
| 113 | `scripts/render-well-known.mjs` | 🔴 N1 (SHA cert prod hardcodeado) |
| 114 | `scripts/restore-firestore.cjs` | limpio (safeguard prod sólido) |
| 115 | `scripts/retro-weekly.cjs` | limpio |
| 116 | `scripts/rotate-secrets.sh` | limpio |
| 117 | `scripts/secrets-bootstrap.sh` | limpio |
| 118 | `scripts/security-review.cjs` | 🟡 N3 (cobertura de colecciones ciega) |
| 119 | `scripts/test-backup-integrity.cjs` | limpio |
| 120 | `scripts/test-mobile-pipeline.sh` | limpio |
| 121 | `scripts/validate-env.cjs` | 🔵 N7 (drift SECRET_MANAGER vs REQUIRED) |
| 122 | `scripts/validate-i18n.cjs` | limpio |
| 123 | `scripts/verify-roles-sync.cjs` | 🔵 N4 (vm.runInContext sobre fuente) |
| 124 | `storage.rules` | 🔵 N8 (legacy companies/* role gap) |
| 125 | `stryker.config.json` | limpio (cobertura honesta documentada) |
| 126 | `tsconfig.json` | limpio (strict completo) |
| 127 | `vite.config.ts` | limpio |
| 128 | `vitest.config.ts` | limpio |
| 129 | `vitest.dr.config.ts` | limpio |
| 130 | `vitest.firestore.config.ts` | limpio |
| 131 | `vitest.rules.config.ts` | limpio |

---

## Hallazgos NUEVOS

### 🔴 N1 — `render-well-known.mjs:31` hardcodea el SHA-256 del certificado de firma Play REAL de producción como fallback por defecto
`render-well-known.mjs` corre en `prebuild` (verificado:
`package.json:12` → `... && node scripts/render-well-known.mjs`), así que se
ejecuta en TODO build real. Línea 30-31:
```js
const androidSha = process.env.ANDROID_CERT_SHA256
  ?? '3D:AC:D9:BC:C2:CD:5C:B0:6D:5F:5D:BC:37:4A:F5:78:50:99:DA:09:BA:E8:B1:F1:05:FF:B6:A5:42:D3:A7:A0';
```
Ese fallback **no es un placeholder**: es idéntico byte-a-byte al fingerprint
en el `public/.well-known/assetlinks.json` commiteado (verificado por diff).
Es decir, el SHA-256 del **app-signing cert de Play en producción** vive
hardcodeado en fuente versionada. El propio header del archivo se anuncia como
"anti-placeholder" y aborta si detecta `REPLACE_WITH_/YOUR_/PLACEHOLDER`
(`PLACEHOLDER_PATTERNS`, líneas 24-28) — pero el valor real escapa a ese guard
porque es hex válido. Doble problema:
1. **Exposición:** un fingerprint de firma no es secreto por sí mismo (es
   público en el APK), pero baked-in como *default silencioso* significa que si
   alguien hace fork/rota el keystore y olvida exportar `ANDROID_CERT_SHA256`,
   el build genera un `assetlinks.json` que valida App Links **contra el cert
   viejo** — App Links rotos o, peor, un cert ajeno aceptado. El guard
   anti-placeholder NO lo detecta (pasa el regex hex de la línea 43).
2. **Fail-open de hardening:** la promesa "aborta si placeholder" da falsa
   confianza; debería **exigir** `ANDROID_CERT_SHA256` (fail-closed) en build de
   release en vez de degradar a un cert hardcodeado de un solo proyecto. La
   plantilla de iOS (`appleTeamId`) sí hace lo correcto: sin env → deja
   `TEAMID` honesto + warning, no inventa un valor real.

Fix sugerido: eliminar el literal hex; si `ANDROID_CERT_SHA256` falta en
modo release, `throw`. El email de contacto (`contacto@praeventio.net`,
línea 33) y el bloque PGP "TODO" de `security.txt` (línea 98) son fallbacks
benignos por contraste (no son material criptográfico de identidad de la app).

### 🟡 N2 — `precommit-stub-guard.cjs` NO está cableado en el hook (contradice CLAUDE.md #13/#15)
El archivo se auto-declara honestamente: "NOT wired into .husky/pre-commit
yet (PR #514's job)" (línea 4). Verificado: `.husky/pre-commit` corre
`precommit-medical-guard.cjs`, `check-convention-guard.cjs`, `validate-i18n.cjs`,
`check-any-ratchet.cjs` — y **no** `precommit-stub-guard.cjs` ni
`precommit-allowbackup-guard.cjs`. Pero `CLAUDE.md` afirma como hecho
consumado: regla #13 "Enforced by `scripts/precommit-stub-guard.cjs` (wired in
PR #514)", regla #15 "Enforced by ESLint custom rule + …stub-guard", regla #17
"Enforced by …allowbackup-guard (wired in PR #514)". El hook real demuestra
que PR #514 nunca aterrizó el cableado. Resultado: las reglas 13/14/15/17
(anti-stub, `void auditServerEvent`, `Math.random` en server, `allowBackup`)
son **doc-only**, no se aplican en commit. Además, aunque se cableara, el guard
es débil: rule 13 sólo dispara con los markers literales
`NotImplementedError|currently returns a mock` (línea 49) — un stub que
devuelva `{ mock: true }` o `// TODO` sin esas cadenas pasa limpio; y el
escaneo de `Math.random` (línea 79) sólo cubre `src/server/**`, no
`ID-generation code` en `src/utils`/`src/services` como pide la regla #15.
Gate que no falla CI **por no estar conectado**.

### 🟡 N3 — `security-review.cjs` audita cobertura de firestore.rules con un check casi ciego (sólo `if true`)
`checkFirestoreRulesCoverage()` (líneas 118-128) marca Critical sólo si
encuentra el literal `allow (read|write): if true`. No verifica que cada
colección **escrita en código** tenga una regla — exactamente el gap que el
barrido reporta como "~20 colecciones sin regla". El scanner tampoco escanea
`storage.rules` en absoluto. Y `DANGEROUS_PATTERNS` mete `child_process|spawn(|
exec(` como High siempre (línea 63), lo que produce **falsos positivos masivos**
contra los propios scripts de este lote (`restore-firestore`, `retro-weekly`,
`reconstruct_faena` via server). Como sólo escanea `changedFiles()` vs
`origin/main` y se gradúa a `exit 2` con cualquier Critical, un solo
`allow ... if true` legítimo (p.ej. en un test fixture de rules) tumbaría
`npm run security:review`. Está wired en `package.json:33` (`security:review`)
pero **no** en ningún workflow CI (grep en `.github/workflows/*.yml` → 0), así
que hoy es opt-in manual — su falla potencial no bloquea merges, pero tampoco
aporta la garantía que su nombre promete.

### 🔵 N4 — `verify-roles-sync.cjs` evalúa `roles.ts` con `vm.runInContext` (RCE teórico si el archivo se contamina)
Líneas 56-91: el parser hace `vm.runInContext(wrapper, sandbox)` sobre la
fuente de `src/types/roles.ts` tras stripear sintaxis TS por regex. El propio
comentario (líneas 51-54) reconoce el riesgo: "roles.ts must remain a leaf
module with no runtime imports". El sandbox sólo expone `{__out, Set, Array}`
(línea 85) — no `require`/`process`, así que la superficie es estrecha — pero
ejecutar fuente del repo en un sandbox VM en CI es un patrón que un PR
malicioso podría explotar (top-level IIFE en roles.ts corre en el contexto del
runner). El parser equivalente para `firestore.rules` (líneas 106-151) es
puramente regex/string-scan, mucho más seguro; el lado TS debería migrarse al
mismo enfoque o usar el AST de TypeScript en vez de `vm`. No es bug funcional
(self-test pasa) pero es el patrón de mayor riesgo del lote tras N1.

### 🔵 N5 — `reconstruct_faena.py` pasa `video_path`/`output_dir` (originados en server) a `subprocess` sin validar
`extract_frames`/`run_colmap_sfm` invocan `ffmpeg`/`ffprobe`/`colmap` con
listas de args (no `shell=True`), así que **no hay shell injection** — bien.
Pero `video_path` proviene de `server.ts` (la docstring lo dice: "para que
server.ts pueda parsear Frame X/Y") y no se valida que sea ruta intra-sandbox:
un `video_path` controlado podría apuntar a un archivo arbitrario del
contenedor del worker (lectura), o `output_dir` a una ruta de escritura fuera
del scratch. Riesgo acotado por estar en el worker COLMAP aislado, pero falta
allowlist de prefijo de ruta. Sin secretos ni `eval`.

### 🔵 N6 — `prepackage-slm-models.mjs` parsea `registry.ts` con regex de balance-de-llaves (frágil)
`parseRegistry`/`parseModelLiteral` (líneas 75-154) extraen el array
`MODEL_REGISTRY` con un tracker `{}` y regex por-campo. Si el registry adopta
template strings con `}` embebidas, comentarios con llaves, o un campo
multilínea, el parser sobre/sub-cuenta modelos silenciosamente. El propio
código lo asume ("brittle by design… should fail loudly") y el CI corre
`--dry-run`, pero un drift que produzca un literal *parseable-pero-incompleto*
(p.ej. `expectedSha256` omitido) cae en `skip-no-hash` (línea 258-261) en vez
de fallar — un modelo dejaría de pre-empaquetarse sin error. Integridad SHA-256
del download sí es sólida (líneas 216-222, evict on mismatch). Funcional, no
bug.

### 🔵 N7 — `validate-env.cjs`: `SECRET_MANAGER_SECRETS` y `REQUIRED_PROD` divergen (mantenidos a mano)
La lista `SECRET_MANAGER_SECRETS` (líneas 134-159) incluye `RESEND_API_KEY`,
`VITE_OPENWEATHER_API_KEY`, `MODAL_TOKEN` que **no** están en `REQUIRED_PROD`,
y omite `MP_ACCESS_TOKEN`, `B2D_API_KEY_SALT`, `APPLE_*`, `GEMINI_API_KEY`
(este último sí está en ambas) — es decir, el modo `prod-secret-manager` y el
modo `prod` validan conjuntos distintos de secretos. El comentario admite "Kept
in sync manually because deploy.yml is the source of truth". Riesgo de drift
silencioso: un secreto requerido por el runtime puede faltar en Secret Manager
sin que `--mode prod-secret-manager` lo advierta (sólo emite warnings, nunca
error salvo `GOOGLE_CLOUD_PROJECT`). Debería derivarse de una sola fuente.

### 🔵 N8 — `storage.rules`: el namespace legacy `companies/*` usa un set de roles distinto y `companyId` (no `tenantId`)
`match /companies/{companyId}/...` (líneas 150-156) permite write con
`role in ['admin','prevencionista']` y particiona por
`request.auth.token.companyId`, mientras el resto del archivo (tenants/*) usa
`tenantId` + `['admin','gerente','supervisor','prevencionista']`. Marcado
"deprecated — to migrate to tenants/*" (línea 148) pero **sigue activo**: un
token con claim legacy `companyId` puede escribir hasta 25MB en
`companies/<id>/` sin pasar por quarantine/AV-scan ni por los content-type
guards (`isPdfOrImage` etc.) que aplican a `tenants/*`. Esto es un bypass del
pipeline AV de la Fase D.6 para cualquier cliente con el claim viejo. El resto
de `storage.rules` es sólido: quarantine-first, default-deny final (líneas
159-161), medical sólo médico+dueño, delete:false en medical/legal/evidence.

---

## Cruce con "~20 colecciones sin regla" (pings/deas/clinical_alerts/findings/
## control_validations/read_receipts/comite_actas/health_vault/lighting_audits)

Verificado contra `firestore.rules` + grep de acceso cliente vs Admin SDK:

- `lighting_audits` → **SÍ tiene** `match` en `firestore.rules` (falso positivo
  del barrido).
- `pings`, `deas`, `clinical_alerts`, `control_validations`, `read_receipts`,
  `comite_actas` → **0 referencias de acceso cliente**
  (`from 'firebase/firestore'` + `collection(db, ...)`); no hay tampoco
  `collection('...')` Admin con esos nombres salvo casos puntuales. Quedan
  cubiertos por el catch-all `match /{document=**} { allow read,write: if false }`
  (firestore.rules:17) → **default-deny correcto**, no exposición.
- `findings` → las refs cliente (`syncConflictRoutes.ts`) son **strings de
  ruteo URL**, no colecciones Firestore; el acceso real (`weeklyDigest.ts`,
  `insights.ts`) es **Admin SDK server-side**, que bypassa rules. Sin write
  cliente → default-deny correcto.
- `health_vault` → `src/services/health/vaultRecord.ts:13` importa
  `firebase-admin`; es subcolección `users/{uid}/health_vault` escrita
  **sólo server-side**. Default-deny correcto (de hecho deseable para PHI).

**Conclusión del cruce:** la lista del barrido es en su mayoría **falsa alarma
de seguridad** — son colecciones server-only legítimamente bloqueadas a
clientes por el default-deny global. El gap **real y residual** es de
*proceso*, no de exposición: CLAUDE.md regla #4 exige que cada colección nueva
tenga (a) regla *explícita*, (b) ≥5 rules-tests, (c) entrada en
`security_spec.md`. Estas colecciones server-only carecen del deny explícito +
tests (el repo ya usa ese patrón para `webauthn_challenges`,
firestore.rules:848-850, "explicit deny for clarity so future agents don't add
a permissive rule by accident"). Recomendación: añadir match explícito
`allow read,write: if false` + 1 rules-test por cada una, replicando ese patrón,
para que un PR futuro no abra accidentalmente la colección creyendo que "no
tiene regla".

---

## Confirmado limpio (sin hallazgos)

- `restore-firestore.cjs` — safeguard prod ejemplar: rechaza import a
  `praeventio-prod` sin `--confirm-i-know-what-im-doing`, sleep 5s last-chance,
  dry-run real, timeout 50min, valida `.overall_export_metadata` antes de
  importar. Sin secretos.
- `retro-weekly.cjs` — `spawnSync` con arg-arrays (no shell), `gh` degrada
  limpio si ausente, sólo lee git/gh. Sin inyección.
- `rotate-secrets.sh` / `secrets-bootstrap.sh` — `set -euo pipefail`, todo
  ENV-driven, idempotentes, sólo crean placeholders honestos
  (`PLACEHOLDER_REPLACE_ME`), smoke-test antes de retirar versión previa, nunca
  corren en CI (comentario explícito). Sin secretos hardcodeados.
- `test-backup-integrity.cjs` — chequeo de frescura/manifest/metadata robusto,
  dry-run opcional contra DR project. Sin secretos.
- `test-mobile-pipeline.sh` — smoke-only con contrato auto-verificado
  (canary regex que se excluye a sí mismo del scan); no dispara builds reales.
- `validate-i18n.cjs` — ratchet honesto (gate sólo crece-no-decrece), scope
  correcto (es→en/pt-BR), report-only sin baseline. Implementa la regla #18 fiel.
- `stryker.config.json` — `mutate` cubre verifyAuth/limiters/slm/billing +
  todos los engines safety/protocols/ergonomics nucleares (reba/rula/iper/
  prexor/tmert/ergonomicAssessments/iperAssessments). `ignoreStatic`/
  `excludedMutations:ArrayDeclaration` justificados en `_notes_*`. Honesto.
- `tsconfig.json` — strict completo (`strictNullChecks`, `noImplicitAny`,
  `noUnusedParameters`, `noImplicitReturns`, `noFallthroughCasesInSwitch`).
- `vite.config.ts` — CSP nonce placeholder + FCM SW injector desde env (no
  keys hardcodeadas), terser `drop_console`+mangle toplevel, externaliza
  express/firebase-admin del bundle cliente. `maximumFileSizeToCacheInBytes:
  100MB` es intencional para modelos SLM offline (documentado).
- `vitest.config.ts` / `.dr` / `.firestore` / `.rules` — separación correcta
  de suites (rules/firestore/DR excluidos del sweep general por requerir
  emulator), `fileParallelism:false` donde hay estado compartido en emulator,
  pragma per-file jsdom documentada (Vitest 4). Sin issues.

---

## Resumen (6-10 líneas)

22/22 leídos línea por línea. **1 🔴:** `render-well-known.mjs:31` hardcodea el
SHA-256 del cert de firma Play de producción (idéntico al `assetlinks.json`
commiteado) como fallback silencioso — el guard "anti-placeholder" no lo
detecta y degrada fail-open en vez de exigir la env var. **3 🟡:**
`precommit-stub-guard.cjs` NO está cableado en `.husky/pre-commit` pese a que
CLAUDE.md #13/#15/#17 lo declaran "Enforced/wired in PR #514" → reglas
anti-stub/Math.random/allowBackup son doc-only; `security-review.cjs` audita
cobertura de rules con un check casi ciego (sólo `if true`, ignora
storage.rules, no está en CI) y se auto-saborearía con falsos positivos de
`child_process`; el cruce de "~20 colecciones sin regla" resulta **mayormente
falsa alarma** — pings/deas/clinical_alerts/findings/health_vault/etc. son
server-only (Admin SDK) cubiertas por el default-deny global; el gap real es de
*proceso* (falta deny explícito + rules-tests por la regla #4). **5 🔵:**
`vm.runInContext` sobre `roles.ts`; subprocess en `reconstruct_faena.py` con
rutas de server sin allowlist; parser frágil del registry SLM; drift
SECRET_MANAGER vs REQUIRED en validate-env; bypass del pipeline AV via legacy
`companies/*` en storage.rules. 14 archivos limpios (restore/rotate/bootstrap/
backup-integrity/mobile-pipeline/i18n/stryker/tsconfig/vite/4×vitest).
Doc-only, sin commit.
