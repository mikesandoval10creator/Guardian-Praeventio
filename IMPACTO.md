# Impacto — Rondas 14 + 15 (consolidación de cuña + LATAM real + tests reales)

## TL;DR

R14 cerró los siete BLOCKERs de la auditoría A1–A6: borró la ruta cross-tenant `/api/projects/:id/get-projects`, conectó realmente las calculadoras REBA/RULA/IPER a la UI con persistencia append-only, gateó 8 paths con `PremiumFeatureGuard`, embarcó el MVP de validación-de-experiencia (claims firmados + dos referees + magic links), y ejecutó la deuda diferida de R13 (ErrorBoundary, deep-links de KG, scope-por-proyecto en UKC). R15 abrió el flanco LATAM con i18n real (6 locales), adapter MercadoPago + currency formatter para PE/AR/CO/MX/BR, una capa supertest sobre las 7 rutas más críticas (cierra A6), un FCM adapter server-side limpio, y refactorizó cuatro páginas aspiracionales (LightPollutionAudit, SunTracker, WebXR, ArcadeGames + ClawMachine + PoolGame) para que tengan propósito de seguridad real (DS 594, Ley 16.744, Ley 20.096) y queden gateadas por tier. Suite: 705 → 866 tests (+161 reales, no escrituras vacías), `tsc -b` exit 0, `npm run build` exitoso con 216 precache entries.

## Round 14 — Closing audit BLOCKERs + shipping the wedge

### Hardening + cross-tenant fix (commit `6876533`, `5c55e70`)

- Validador RUT: `src/utils/rut.ts` con módulo-11 estricto, `22 tests` en `src/utils/rut.test.ts`. Cubre dígito verificador "K", pad de ceros, RUT con/sin guion, casos negativos.
- Borrada la ruta cross-tenant `GET /api/projects/:id/get-projects` que listaba proyectos de OTROS tenants — el reviewer de R14 la marcó como BLOCKER A1.
- KMS pre-flight: `server.ts` ahora aborta el boot si `KMS_KEY_RING` está configurado pero la cuenta de servicio no tiene `roles/cloudkms.cryptoKeyEncrypterDecrypter`.
- Sentry scrub: PII (email, RUT, custom claims) se elimina en `beforeSend` en `src/main.tsx` antes de enviar al backend.
- `assertProjectMember` ahora bloquea cualquier endpoint con `:projectId` que no haya pasado por su middleware — todos los endpoints de proyecto auditados.

### Safety calculations realmente conectadas a UI (commit `81fee62`)

- REBA/RULA wizard: `src/services/safety/ergonomicAssessments.ts` (deterministic, 9 tests en `ergonomicAssessments.test.ts:1-185`). Cada celda de la UI dispara recálculo, persiste en `ergonomic_assessments/{id}` con `metadata.signedAt: null` hasta firma, y luego queda append-only.
- IPER deterministic: `src/services/safety/iperAssessments.ts` con score determinista (8 tests en `iperAssessments.test.ts`). Matriz prob × consec × exposición → action level (1–4), wireado a la UI Safety con persistencia en `iper_assessments/{id}`.
- Webpay checkout flow: `server.ts:~1850` integra `useInvoicePolling` + `WebpayReturnBanner`, con histograma de latencia emitiendo en R12.

### Tier-gating real (commit `a0ae386`)

- 8 paths gateados con `PremiumFeatureGuard` en `src/components/shared/PremiumFeatureGuard.tsx`:
  - `/zettelkasten` → `canUseZettelkasten` (Plata+)
  - `/risk-network/predict` → `canUseRiskPrediction` (Oro+)
  - `/safety/iper/wizard` → `canUseIperWizard` (Plata+)
  - `/safety/ergonomic/wizard` → `canUseErgonomicsWizard` (Plata+)
  - `/curriculum/portable` → `canUsePortableCurriculum` (Plata+)
  - `/admin/manager-node-form` → `canUseManagerNodeForm` (Diamante+)
  - `/analytics/advanced` → `canUseAdvancedAnalytics` (Diamante+)
  - `/branding` → `canUseCustomBranding` (Diamante+)
- Feature flag matrix consolidada en `src/contexts/SubscriptionContext.tsx` con 12 tests (`SubscriptionContext.test.ts`).

### Experience-validation MVP (la cuña, commit `ea9f18d`)

- Schema `curriculum_claims/{claimId}` con `firestore.rules:387-401`: worker create only, update solo via Admin SDK, delete denied.
- WebAuthn co-sign: `src/services/curriculum/refereeTokens.ts` genera token de 32 bytes, hash SHA-256, expiración 7 días (6 tests en `refereeTokens.test.ts`).
- Magic links: `POST /api/curriculum/claim` (`server.ts:2686`) crea claim + envía dos emails Resend con links `/curriculum/referee/:token`.
- Cosign endpoints: `GET/POST /api/curriculum/referee/:token` (`server.ts:2843, 2900`), con rate-limit y validación de token hash.
- `src/services/curriculum/claims.ts` (12 tests en `__tests__/server/curriculum.test.ts`) cubre el caso feliz, decline, doble-cosign, expiración, y duplicate-cosign-rejected.

### Round 13 deferred + Zettelkasten depth (commit `ec4ebc0`)

- ErrorBoundary: ahora wrappea `<App />` con `Sentry.ErrorBoundary` y un `CrashFallback` framework-light (sin Tailwind ni router) — sobrevive fallos en provider tree (`src/main.tsx:117-131`).
- KG prop drilling: `RiskNetwork` acepta `?node=` query param para deep-linking (`src/pages/RiskNetwork.tsx`).
- Backlinks: `src/services/zettelkasten/climateRiskCoupling.test.ts` (10 tests) más cobertura en propagation.
- `autoConnect`: nodes nuevos se conectan automáticamente a vecinos por similitud semántica.
- UKC project-scope: `UniversalKnowledgeContext.tsx` ahora particiona por `projectId` para no mezclar conocimiento entre tenants.

## Round 15 — LATAM + tests + wedge support + aspirational pages with purpose

### i18n LATAM (I1)

- `src/i18n/index.ts` reemplaza al monolito `src/lib/i18n.ts` (que queda como shim de compat). Bundles JSON estáticos, no lazy load (12 KB total, irrelevante para chunks).
- 6 locales en `src/i18n/locales/<tag>/common.json`: `es` (CL fallback, 111 líneas), `es-MX`, `es-PE`, `es-AR`, `pt-BR`, `en`. Cada uno cubre `app`, `nav`, `dashboard`, `emergency`, `risk_network`, `auth`, `errors`, `common`.
- `src/contexts/LanguageProvider.tsx` con detección 4-niveles: localStorage → user doc → navigator.language → fallback `'es'`. 14 tests (`LanguageProvider.test.ts`) validan cada precedencia y mapeo BCP-47 (`pt → pt-BR`, `en-GB → en`, `es-ES → es`).
- `src/main.tsx:5` importa `./i18n` ANTES que `<App />` para que el `Sentry.ErrorBoundary` fallback pueda llamar a `i18n.t(...)` con bundles cargados.
- `Sidebar.tsx`, `Settings.tsx`, `Analytics.tsx`, `Login.tsx` usan `useTranslation()` real.
- **NOTA: aún no commiteado** — los archivos están untracked. Requiere `git add src/i18n/ src/contexts/LanguageProvider.tsx src/contexts/LanguageProvider.test.ts && git commit`.

### MercadoPago LATAM payments (I2)

- `src/services/billing/mercadoPagoAdapter.ts` (245 líneas) — wrapper sobre el SDK oficial `mercadopago@2.12.0`. Soporta PE/AR/CO/MX/BR (5 países). API: `isConfigured()`, `createPreference()`, `getPayment()`. Sandbox/production switch vía `MP_ENV`.
- `src/services/billing/mercadoPagoAdapter.test.ts` (223 líneas, 10 tests) — mocks del SDK, valida fail-closed cuando falta `MP_ACCESS_TOKEN`, error envelope `MercadoPagoAdapterError`, init_point selection.
- `src/services/billing/currency.ts` — formatter Intl-aware para CLP/USD/PEN/ARS/COP/MXN/BRL. Tests en `currency.test.ts` (8 tests) survive variantes ICU (NBSP, narrow-NBSP).
- **GAP**: el endpoint `POST /api/billing/checkout/mercadopago` NO está en `server.ts` todavía. El adapter existe pero no está enrutado. Marcado como HIGH para R16 (1 hora de trabajo).

### supertest HTTP layer (I3, cierra A6 BLOCKER)

- `src/__tests__/server/test-server.ts` (1038 líneas) — Express test app con la MISMA forma de middleware que `server.ts` (verifyAuth, validation, assertProjectMember, audit-log writes). Trade-off documentado: drift posible vs server.ts, mitigado con copy near-verbatim.
- `InMemoryFirestore` con `arrayUnion`, `delete()`, dot-path merges, query filters — emula Firebase Admin SDK suficiente para tests.
- 7 archivos de test, 79 tests passing:
  - `health.test.ts` — `/api/health` 200/503 con checks dict.
  - `auditLog.test.ts` — `/api/audit-log` con tenant isolation y email de servidor (no del cliente).
  - `admin.test.ts` — `/api/admin/set-role`, `/api/admin/revoke-access` con audit trail completo.
  - `billing.test.ts` (381 líneas) — `/api/billing/checkout`, `/api/billing/verify`, `/billing/webpay/return`, idempotency, webhook auth.
  - `projects.test.ts` (242 líneas) — invite, accept, expiration, dup-pending.
  - `curriculum.test.ts` — claim creation, referee endorse, decline, expired token, double-cosign reject.
  - `askGuardian.test.ts` — `/api/ask-guardian` smoke.
- `vitest.config.ts:15-25` actualizado: `environmentMatchGlobs` (deprecated en Vitest 4) eliminado, reemplazado por per-file `// @vitest-environment jsdom` pragma.

### Aspirational pages now with safety/wellness purpose (I4)

- `src/pages/LightPollutionAudit.tsx` — Auditoría de iluminación de puestos de trabajo según DS 594 Art. 103 (lux thresholds: 500/300/150/50). Persistencia `lighting_audits/{id}`, gated `canUseCustomBranding`. Test en `LightPollutionAudit.test.ts`.
- `src/pages/SunTracker.tsx` — Tracker de exposición UV (Ley 16.744 + Ley 20.096). Algoritmo offline `computeUvIndex(lat, doy, hour, cloud)`, alertas EPP (FPS50, gorro legionario). Persistencia `uv_exposures/{userId}_{date}`, gated `canUseAdvancedAnalytics`. Test en `SunTracker.test.ts`.
- `src/pages/WebXR.tsx` — Capacitación EPP en altura (DS 594 Art. 53) con AR overlay sobre `getUserMedia`. Checklist arnés/anclaje/línea-de-vida con marcadores posicionales, persiste en `safety_trainings/{id}`, gated `canUseAdvancedAnalytics`.
- `src/pages/ArcadeGames.tsx` — Hub de serious-games con `GAMES_REGISTRY` (objetivo de aprendizaje + normativa cubierta + tier). Cada juego con su propio guard (no se pasa con deep-link).
- `src/pages/ClawMachine.tsx`, `src/pages/PoolGame.tsx` — drills de selección de EPP y de planificación operativa (Ley 16.744). Tests en `gameScore.test.ts` cubren la pure-function de scoring.
- Rutas registradas en `src/routes/HealthRoutes.tsx:19` (sun-tracker) y `src/routes/TrainingRoutes.tsx:14-16` (arcade-games, clawmachine, poolgame).

### Push notifications + biometric native (I5)

- `src/services/notifications/fcmAdapter.ts` (139 líneas) — wrapper FCM server-side: `sendToTokens(tokens[], notification)` con multicast hasta 500 tokens y reporte de `failedTokens` (para podar tokens stale en `users/{uid}.fcmTokens[]`); `sendToTopic(topic, notification)` para fanout por proyecto.
- `src/services/notifications/fcmAdapter.test.ts` (8 tests) — mocks de `firebase-admin/messaging`, valida no-op en empty tokens, error envelope `FcmAdapterError`, success/failure aggregation.
- **GAP 1**: el endpoint `POST /api/push/register-token` NO está en `server.ts`. El adapter está pero la UI no tiene cómo registrar el FCM token del dispositivo aún.
- **GAP 2**: `src/hooks/useBiometricAuth.ts` quedó sin cambios — sigue siendo WebAuthn-only. NO se instaló plugin Capacitor (ej. `@capacitor-community/biometric-auth`) ni se actualizó `package.json`. La promesa de "biometric native-aware" no se cumplió en R15.
- Ambos gaps son HIGH para R16 (~3 horas de trabajo combinadas).

## Métricas

- **`npx tsc -b`**: exit 0 (clean). Después de fix tardío en typing de `audit` array en `test-server.ts:94` para soportar campos `userEmail`, `oldRole`, `target`, `newRole`.
- **`npx vitest run`**: 63 test files passed, **866 tests (830 passed + 36 skipped)**. Delta vs R13 baseline: 705 → 866 (+161 tests). Test files: 50 → 63 (+13).
- **`npm run build`**: exit 0. PWA mode `generateSW`, **216 precache entries** (vs 209 en R13, +7), main bundle `index-BF0C0RVG.js` 867.43 KB → brotli 213 KB (within budget). Vendor chunks: vendor-firebase (118 KB br), vendor-react (15 KB br), vendor-motion (36 KB br) — split intacto desde R12.
- **LOC delta** (working tree, sin commit todavía): 13 files modified (+817/−1360, refactor neto −543), 32 untracked (`+~3500 LOC` entre i18n bundles, mercadoPagoAdapter, fcmAdapter, currency, LanguageProvider, supertest fixtures, nuevas páginas).
- **`npm audit`**: 37 vulnerabilities (9 low, 17 moderate, 10 high, 1 critical). El crítico es `xlsx` (Prototype Pollution + ReDoS en `node_modules/xlsx` via dependency). High count subió por `vite ≤6.4.1` (Path Traversal en `.map` handling, Arbitrary File Read via WS) — `npm audit fix` disponible. **Tracked como HIGH para R16**: bump `vite` a ≥6.5 y reemplazar/aislar `xlsx`.

## Round 16 priorities (de E2 forward scout)

1. **Cerrar los 2 GAPs de R15 wiring**: agregar `POST /api/billing/checkout/mercadopago` y `POST /api/push/register-token` en `server.ts` (delegan a sus adapters ya escritos). Tests supertest correspondientes. Estimado: 3 horas.
2. **Bump `vite` ≥6.5 + auditar `xlsx`**: cierra 11 vulnerabilities de severidad alta+crítica. Validar que el build PWA siga funcionando con `vite-plugin-pwa` compatible. Estimado: 4 horas.
3. **Biometric Capacitor real**: instalar `@capacitor-community/biometric-auth` o equivalente, refactor `useBiometricAuth.ts` para detectar plataforma (web → WebAuthn, native → plugin), preserva fallback a `userVerification: 'required'`. Estimado: 4 horas.
4. **Refactor `server.ts` (3027 LOC) en `registerRoutes(app, deps)`**: el test-server de I3 admite que la duplicación de handler-shape es la única forma de testear sin refactor. Extraer a un registrar reduce drift y permite que `__tests__/server/test-server.ts` llame al MISMO código. Estimado: 12 horas.
5. **Reglas Firestore para `ergonomic_assessments` + `iper_assessments`**: el commit `1079e48` documentó las reglas en el commit message pero el diff sólo agregó `curriculum_claims`. Rules tests bloquean creates fuera de project membership; auditar antes de R16 close. Estimado: 4 horas.

## Lo que NO entró en R14+15 (deferred)

- **SOC 2 / ISO 27001 path kickoff**: aún sin policy framework, sin SoA, sin penetration test. Bloqueante para enterprise deals fuera de Chile.
- **`server.ts` split refactor (3027 LOC)**: monolito con 50+ handlers inline. Trabajo asumido en R16 priority #4.
- **`geminiBackend.ts` split refactor (2666 LOC)**: aún no abordado. Bloquea la cobertura unit testing del flujo Ask-Guardian (hoy sólo smoke en supertest).
- **Marketplace assets**: screenshots actualizados, video demo, banner del Play Store, ASO copy en es-CL/en. Diferido hasta que las nuevas páginas (LightPollutionAudit, SunTracker, WebXR) estén estables 1 sprint en producción.
- **`CONTRIBUTING.md` / `ARCHITECTURE.md`**: el repo crece >100 archivos pero no hay onboarding doc. Diferido a R16 si el equipo extends.
- **Commit y PR de R14+15**: HEAD sigue en `e50df7b` (R15 prep). Todo el trabajo de los 5 implementer agents está untracked/unstaged y requiere round de commits estructurados antes de PR a main.
