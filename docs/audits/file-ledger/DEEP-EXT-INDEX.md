# Pasada exhaustiva 2 — Tests + Infra + Build + Docs (DEEP-EXT/EXI) — Índice

**Fecha:** 2026-06-03 · **Rama:** `claude/technical-debt-review-e2e-87kVX`
**Cobertura:** 35/35 lotes · **1.725 archivos** leídos línea por línea
(1.247 tests + 89 I-CORE/I18N/DATA + 72 I-PLAT + 132 I-BUILD + 185 I-DOCS).
77 binarios I-ASSETS excluidos (no leíbles línea a línea).
**Detalle:** `DEEP-EXT-01..23.md` (tests) + `DEEP-EXI-24..35.md` (infra/build/docs).

> Con esta pasada, **el repo completo (3.545 archivos, menos 77 binarios) queda
> leído línea por línea**: la capa FEAT (1.743) en la pasada 1 (`DEEP-EX-INDEX.md`)
> y esta capa (1.725) ahora. Doc-only.

---

## 1. TESTS (1.247 archivos) — la confianza es BIMODAL

### 1.1 Alta calidad (cobertura real)
- **`src/__tests__/server/` (153 suites, 143 con supertest):** montan el router real,
  asertan efectos en `fakeFirestore` (que implementa `runTransaction`/`increment`/
  `count()` de verdad), identidad server-stamped vs spoof, 401/400/403/404/409.
- **Componentes React:** asertan valores computados del engine real, no presencia.
- **Engines puros:** `reba`/`rula` snapshots mutation-grade (Hignett 2000), `euler`
  valores de libro, **billing crypto** (vectores RFC TOTP/HOTP, FIPS sha256, RSA OIDC,
  `webpayAdapter` 1591 LOC matando mutantes), **`security/*`** (KEK/envelope/KMS, tamper).
- **Hooks:** `useBiometricAuth` (fail-closed R6), `useInvoicePolling` (state machine).

### 1.2 Falso-verde / cobertura ilusoria (clases sistémicas)
1. **🔴 "Wire-up contract" (144 de 164 tests co-located en `src/server/routes/*.test.ts`):**
   solo introspeccionan `router.stack` para afirmar que la ruta está registrada;
   **no arrancan Express, no ejercitan handler/`verifyAuth`/`validate`/`assertProjectMember`**.
   Borrar `verifyAuth` de cualquier endpoint deja la suite verde. Cubren routers
   sensibles (pinSign, qrSignature, sif, workPermits, privacyRetention, confidentialReports).
   _Mitigante:_ muchos tienen companion supertest en `__tests__/server/`; los que **no**,
   quedan sin cobertura de comportamiento.
2. **🔴 Reimplementación-disfrazada:** el test re-implementa el handler (`buildApp`) y
   nunca importa la ruta real → cubre 0 líneas de prod. Casos: `auditCoverage` (¡prueba
   la invariante #3 sobre copias!), `mercadoPagoIpn`, `telemetryCanonical/Rotation`,
   `zettelkasten`, `webauthnVerify/Register`, `evacuationHeadcount`, `hazmatInventory`,
   `externalAuditPortal` (emula el tenant-isolation que está roto), `iot`, `suseso`,
   `visitors`, `coachChatTenant`, `sitebookSignRoutes.webauthn` (contradice la impl real).
3. **🔴 "ID crypto contract" tautológico:** construye el ID en el test y se asserta a sí
   mismo, sin importar el sujeto → pasaría con `Math.random()`. Casos: `apprenticeship`,
   `leadership`, `projectClosure`, `confidentialReports`, `drivingSafety`, `visitors`.
4. **🔴 Mock-the-SUT:** `ragService.test` (mockea `generateEmbedding`), `MorningRoutine`
   (llama `awardPoints()` a mano y enmascara que el componente no lo cablea).
5. **🟡 `validate`→`next()`:** sin cobertura de 400-schema (confidentialReports.router,
   dataConfidence, drivingSafety.router, suppliers, annualReview).
6. **🟡 Assert-opuesto-al-título:** `zettelkastenMaterializer` (dice ok:false, asserta
   ok:true), `e2eAuth`, `KekRotationPanel` "record-fail".
7. **🟡 Gemini-split "contract":** `chat`/`personPlans`/`safetyDocs`/etc. solo afirman
   `constructor.name==='AsyncFunction'` + aridad, sin invocar.
8. **🟡 Misc:** `hmac.test:141` `it()` vacío sin `expect`; `projectScopedStores.rules.test`
   `if(!testEnv) return` silent-pass de ~50 aserciones; `dteSigner.test` pasa con `'sig-fake'`.
9. **🔴🛟 e2e safety-críticos DESACTIVADOS:** `sos-button`, `process-lifecycle`,
   `offline-resilience` enteros en `describe.fixme` → **SOS y resiliencia offline (el
   núcleo) no tienen e2e activo**.
10. **🟡 DR dry-run** (`dr-runbook-dryrun.spec`): borra y re-siembra el mismo dataset →
    "Zero data loss" siempre verde; no prueba backup/import real (doble con el job roto).

**Implicación:** el conteo "10.029 passing" **sobreestima** la cobertura conductual.
Los rules-tests reales son limpios (usan `authenticatedContext`, no Admin SDK), salvo
el silent-pass de `projectScopedStores` + las siembras sintéticas (site_book, control_validations).

---

## 2. INFRA (I-CORE / I18N / DATA / PLAT)
- **I-CORE:** 🔴 `biometrics.ts` WebAuthn client-side (spoofable), `encryptData`=base64;
  patrón sistémico de escritura Firestore client-side sin audit; `?demo=true` sin gate
  de entorno; leaks de listeners (Theme/Notification).
- **I-I18N:** 🔴 **voseo es-AR en la referencia es-CL** (`Reintentá`/`Seleccioná`/`vos sos`,
  Regla #2). en↔es a paridad; pt-BR:59 es el gap baselined.
- **I-DATA:** corpus **real** (leyes/URLs verificables, catálogos médicos con licencia);
  🟡 doc-drift DS40↔DS44, `epp.ts` certs ISP falsas, `industryDemos` RUTs sin rango reservado.
- **I-PLAT:** 🔴 **mismatch de dominio** — manifest/AASA `praeventio.app` vs server/
  WebAuthn RP `app.praeventio.net`/`praeventio.net` (+ `WEBAUTHN_RP_ID` vs `WEBAUTHN_RPID`
  divergentes) → **passkeys y deep-links rotos en prod**; 🔴 **iOS `CBUUID` inválido** vs
  Android que mapea → **la malla BLE de emergencia no interopera iOS↔Android**; GATT acepta
  WRITE de cualquiera + fuga hash del UID; iOS `send()` trunca a 512B. allowBackup/SQLite OK.

## 3. BUILD (I-BUILD) — gobernanza
- 🔴 **No hay job de `lint` en CI** (grep=0) pese a CLAUDE.md "CI runs lint" → la regla
  anti-`Math.random` (#15) y react-hooks **no gatean PRs**.
- 🔴 **Ratchets solo en husky, no en CI** (#3/#19/any-ratchet/i18n) → bypaseables con
  `--no-verify`; solo el medical-guard tiene backstop en CI.
- 🔴 **Guards #13 (stub) y #17 (allowbackup) NO wired** (re-confirmado por grep).
- 🔴 `render-well-known.mjs:31` hardcodea el SHA-256 del cert Play de prod (fail-open).
- 🟡 `firebase-applet-config.json` git-trackeada; converters comparan token con `==`
  (timing oracle); contenedores legacy como root; `cphs_meetings:1175` append-only **no
  preserva el prefijo** del array de firmas. **Terraform 100% limpio** (ejemplar).

## 4. DOCS (I-DOCS) — doc-drift generalizado post-split
- 🔴 `ARCHITECTURE.md` (LOC/refs stale, Regla #20), `stubs-inventory.md` (SystemEngine
  "no mounted"/mesh stub), `CLAUDE.md` (#13/#17 "wired"), `TRACKING_PLAN.md` (analytics
  "no implementado" pero ~3457 LOC), `BERNOULLI_EXTENSIONS.md` (5/15 vs 16), `gemini-split-plan`
  (split ya hecho), cluster **photogrammetry** (worker COLMAP descartado documentado como vivo).
- 🟡 `BILLING.md` se contradice; `CONTRIBUTING.md` modelos viejos + refs muertas;
  `THREAT_MODEL`/`scope-justifications`/`security_spec` con `file:line` stale; `ADR 0013`
  propaga el UUID mesh inválido; `ADR 0005/0006` superseded sin marcar; links rotos.
- ✅ `SENTRY_*`↔yaml 1:1, `privacy-compliance-matrix`, `TYPESCRIPT_STRICT_ROADMAP`, archive marcado.

---

## 5. Reconciliación clave — "colecciones sin reglas" se DIVIDE
- **(a) Client-written → ruptura silenciosa real** (default-deny rompe el write):
  `clinical_alerts` (VitalityMonitor `db` cliente), `control_validations`, `comite_actas`,
  `findings`, `driving_incidents`, `documents`, `read_receipts`, `placed_objects`; +
  `site_book`/`lighting_audits` (mutables por gate falso). **Verificadas client-side.**
- **(b) Server-only (Admin SDK) → solo gap #4 + lectura cliente rota:** `health_vault`.
- Ambos grupos incumplen Regla #4 (reglas explícitas + rules-tests); el grupo (a) además
  pierde datos en runtime. (Corrige la sugerencia de EXI-31 de que todo era "server-only".)

## 6. Lo que aguantó el escrutinio (sólido)
Terraform · clúster cripto/KMS · billing crypto tests · `__tests__/server` supertest ·
engines puros mutation-grade · corpus normativo · SENTRY observability docs ·
SQLite native encryption · fastlane ENV-driven.

## 7. Para `TODO.md`
Elevado a **§2.34**: false-coverage de tests (wire-up 144 + reimplementación + tautologías),
e2e SOS desactivado, gobernanza CI (no-lint, ratchets fuera de CI, guards no-wired),
domain/WebAuthn mismatch, iOS mesh UUID, voseo es-CL, render-well-known cert, doc-drift masivo.
