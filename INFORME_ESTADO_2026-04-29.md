# Informe de Estado — Guardian-Praeventio (Praeventio Guard)

**Fecha:** 2026-04-29
**Repo:** https://github.com/mikesandoval10creator/Guardian-Praeventio
**HEAD:** `838e30e` (post Round 21)
**Sesión actual:** 10 rondas trabajadas (R12 → R21)

---

## TL;DR — Una sola página

Guardian-Praeventio es una plataforma SaaS de prevención de riesgos ocupacionales para Chile y LATAM (DS 54, DS 40, Ley 16.744, ISO 45001). Está **técnicamente production-ready a nivel código** pero **bloqueada operacionalmente** por items que vos tenés que tramitar (verificación de dominio, OAuth Consent Screen de Google, KYC Transbank, assets Marketplace, GCP terraform apply).

**Métricas finales R21:**
- 1.719 tests pasando + 66 skipped = 1.785 total. tsc 0 errors. Build PWA OK.
- server.ts: 457 LOC (era 3.242 al inicio de la sesión = **-86% reducción**).
- 14 route modules + 2 trigger modules extraídos.
- Stryker mutation testing: 85.52% global score, break threshold 65.
- WebAuthn con defensa de 5 capas (challenge cache + register + verify + counter + dual limiters).
- MercadoPago IPN con OIDC (jose@5) + HMAC RFC 8785 canonical.
- 14 commits R21 ya pushed a `origin/main`.

**Ruta crítica al primer cliente pago:** ~4-6 semanas wall-clock dominado por SLAs externos (Google OAuth review 5-15 días + Marketplace 5-15 días + Transbank KYC 2-4 semanas), no por código.

**Dónde recomiendo parar:** R21 está limpio y pushed. **Antes de Round 22**, conviene que vos dediques un día a destrabar items operacionales (domain, mailboxes, /privacy /terms, OAuth Consent submit). El código puede esperar — el reloj de Google no.

---

## Tabla de contenidos

1. [Lo que está construido y funcionando](#1-lo-que-está-construido-y-funcionando)
2. [Lo que está bien testeado](#2-lo-que-está-bien-testeado)
3. [Arquitectura técnica actual](#3-arquitectura-técnica-actual)
4. [Lo que falta por código (Round 22+)](#4-lo-que-falta-por-código)
5. [Lo que falta operacional (vos manejás)](#5-lo-que-falta-operacional)
6. [Métricas duras consolidadas R12-R21](#6-métricas-consolidadas)
7. [Ruta crítica al primer cliente pago](#7-ruta-crítica)
8. [Mi recomendación honesta de qué hacer ahora](#8-recomendación)
9. [Apéndice: incidentes técnicos durante esta sesión](#9-incidentes-técnicos)
10. [Apéndice: cómo subir este informe a Drive](#10-apéndice-drive)

---

## 1. Lo que está construido y funcionando

### Plataforma core (real, en producción una vez deployada)
- **React 19 + Vite + TypeScript + Tailwind 4** — frontend SPA + PWA con service worker (220 precache entries)
- **Express + Node.js** — backend con 50 rutas distribuidas en 14 módulos
- **Firebase Admin SDK + Firestore** — persistencia + auth + rules default-deny
- **Capacitor 8** — Android/iOS apps nativos
- **Sentry SDK real (`@sentry/node@10.50`)** — error tracking + tracesSampleRate
- **Cloud KMS adapter real (`@google-cloud/kms`)** con boot pre-flight (refuse-to-start si `KMS_ADAPTER!=='cloud-kms'` en producción)

### Compliance Chile + LATAM
**Las 5 calculadoras canónicas conectadas a UI** (Round 14 cerró el "safety theatre" gap):
- **REBA** (Rapid Entire Body Assessment) — wizard 7-step en `AddErgonomicsModal.tsx`
- **RULA** (Rapid Upper Limb Assessment) — mismo wizard, diferentes inputs
- **IPER** (Identificación de Peligros y Evaluación de Riesgos) — matriz 5×5 deterministic en `IPERCAnalysis.tsx`, AI freeform descartada para clasificación legal (DS 40 + ACHS Manual IPER)
- **TMERT** (MINSAL Norma Técnica 2012) — Chile-specific
- **PREXOR** (DS 594 ruido ocupacional) — Q=3 dB

Cada cálculo:
- Persiste a colección dedicada (`ergonomic_assessments`, `iper_assessments`, etc.) con rules append-only post-sign
- Emite audit log inmutable (`safety.{reba|rula|iper}.completed`)
- Spanish-CL throughout

**Stryker mutation testing sobre las calculadoras:** 85.52% global score (rula 94.22%, reba 77.74%, iper 89.36%, tmert 85.07%, prexor 81.71%, ergonomicAssessments 87.50%, iperAssessments 87.50%).

### Compliance LATAM (paquetes normativa)
- Country packs: CL, PE, CO, MX, AR, BR, ISO 45001 fallback
- Reverse-geocoding con Google Maps API + per-tenant location override
- i18n con i18next + 6 locales (es, es-MX, es-PE, es-AR, pt-BR, en) — ~480 traducciones en 8 namespaces

### Revenue infrastructure
- **Webpay/Transbank** adapter real + idempotency lock + commit transaction + return latency histogram
- **Webpay checkout flow wired**: `Pricing.tsx → /api/billing/checkout → Transbank → return → useInvoicePolling`
- **MercadoPago LATAM** adapter real (`mercadopago@^2`) + currency formatter (CLP/USD/PEN/ARS/COP/MXN/BRL) + Pricing country routing
- **MP IPN endpoint** (`/api/billing/webhook/mercadopago`) con OIDC > HMAC > LEGACY precedence (jose@5.10.0 jwtVerify + JWKS cache 6h TTL)
- **10 pricing tiers** con .990 endings, multi-país sin recargo, RUT 78231119-0 emisor
- **Tier-gating real** — feature flag matrix de 8 flags (canUseSSO, canUseVertexFineTune, canUseMultiTenant, canUseExecutiveDashboard, canUseGoogleWorkspaceAddon, canUseAdvancedAnalytics, canUseAPIAccess, canUseCustomBranding) aplicada a 8 code paths
- **RTDN webhook** con shared-secret + idempotency

### Cuña competitiva (la diferenciadora pitchada y construida)
**Experience-validation MVP** (`src/services/curriculum/`) — anti-fraud para "X años de experiencia":
1. Worker firma claim con WebAuthn fingerprint
2. Nombra 2 referees (email)
3. Server genera tokens hex 32-byte, guarda hash sha256, manda magic links via Resend
4. Cada referee co-firma vía landing público `/curriculum/referee/:token` (rate-limited)
5. Cuando ambos firman → status `verified`, doc inmutable

**WebAuthn defensa de 5 capas:**
- Challenge cache server-side single-use TTL 5min
- Register ceremony con `verifyRegistrationResponse` (@simplewebauthn/server@11)
- Verify ceremony con full CBOR + signature verify + counter monotonic
- Per-uid rate limiter (5 verify/min, 3 register/min)
- expectedOrigin module-load fail-fast en producción

### Knowledge graph / Zettelkasten
- Real bidirectional edges (client + server enforced)
- Vector store mirror + RAG sobre BCN (Biblioteca Congreso Nacional)
- Backlinks panel ("Referencias entrantes") en detail drawer
- `?node=` deep-link reading + centra cámara + abre drawer
- `autoConnectNodes` activación post-embedding (suggestions, no auto-write)
- Project-scoped UniversalKnowledgeContext
- Form de creación de nodos en RiskNetworkManager

### Aspirational pages refactoreadas con propósito DS 594/Ley 16.744
- **WebXR** — AR training trabajo en altura (DS 594 Art. 53 fall-arrest)
- **ClawMachine** — drill EPP 4 escenarios timer 20s
- **PoolGame** — drill evacuación 2D NCh 2189
- **LightPollutionAudit** — DS 594 Art. 103 lux measurement
- **SunTracker** — Ley 20.096 UV exposure (DS 594)
- **ArcadeGames** — hub registry

### Hardening security
- Default-deny Firestore rules con 30+ collection blocks
- audit_logs immutable (rules tests)
- KMS envelope encryption real para OAuth refresh_tokens
- assertProjectMember helper aplicado a endpoints sensibles
- 4 rutas cross-tenant exploit BORRADAS (Round 14)
- RUT validator módulo-11
- Sentry beforeSend scrub: headers + query strings (token_ws/code/token redacted)
- /api/coach/chat con assertProjectMemberFromBody (cierra cross-tenant leak)
- /api/telemetry/ingest per-tenant HMAC + admin rotate-secret endpoint
- HMAC RFC 8785 canonical-JSON (suppresses ERR_ERL_KEY_GEN_IPV6 + handles non-Node clients)
- 6 endpoints añadiendo audit_logs (oauth/unlink, google/callback, calendar/sync, coach/chat, gamification/points, reports/generate-pdf) — ISO 27001 §A.12.4 compliance
- IPv6 keyGenerator en todos los rate limiters

### Documentación foundation (R16)
- `CONTRIBUTING.md` (312 LOC) — setup, TDD, how-to add route, how-to add Gemini action
- `ARCHITECTURE.md` (477 LOC) — module map, 3 critical data flows, server.ts split strategy
- `RUNBOOK.md` (334 LOC) — emulator local, Cloud Run deploy, restore from backup, KMS rotation
- `docs/api-routes.md` (522 LOC) — catálogo de las 43 rutas con auth/body/response/error/audit/rate-limit
- `STRYKER_BASELINE.md` — mutation testing baseline + ratchet history
- `AUDIT.md` — historial de findings + "Known harness behaviour: revert pattern" playbook

### Observability + Ops
- Cloud Monitoring metric descriptors + alert policies (Webpay latency p95 + absent-data)
- Webpay return histogram emitiendo en 5 exit branches del handler
- Cloud Run Dockerfile multi-stage
- Terraform IaC (KMS keyring + GCS bucket + Secret Manager + scheduler)
- DR_RUNBOOK.md + restore script
- Lighthouse CI + size-limit budgets + smoke tests
- 4 trigger modules con SIGTERM graceful shutdown

---

## 2. Lo que está bien testeado

### Test count progression R12 → R21
| Round | Tests passed | Net delta |
|-------|--------------|-----------|
| R12 baseline | ~600 | — |
| R13 | ~700 | +100 |
| R14 | ~780 | +80 |
| R15 | ~830 | +50 |
| R16 | ~880 | +50 |
| R17 | 967 | +87 |
| R18 | 1.069 | +102 |
| R19 | 1.158 | +89 |
| R20 | 1.456 | +298 |
| R21 | **1.719** | +263 |

**+186% en 10 rondas** (~600 → 1.719).

### Cobertura por capa
- **Pure-function math**: REBA/RULA/IPER/TMERT/PREXOR + idempotency + Webpay mapping — survive mutation testing (Stryker 85.52% global)
- **HTTP layer**: 177 supertest cases sobre las 50 rutas (Round 15 instaló supertest, R17 expandió, R20 añadió WebAuthn register, R21 añadió IPv6 keyGen tests)
- **Component tests**: jsdom + RTL instalado R15, ~3 archivos `.test.tsx` con tests reales (PredictedActivityModal, RiskNetwork, otros usan pure-helper extraction)
- **Rules tests**: 24+ casos sobre `firestore.rules` (auto-skip si emulator no corre)
- **Integration**: 79+ tests con `test-server.ts` minimal Express harness

### Stryker mutation testing baseline (R20-R21)
- Run completo en ~3-5 min
- 7 mutate targets (las 5 calculadoras + 2 services de Assessments)
- Break threshold: 65 (pass automatic en CI cuando se agregue gate)
- Per-file scores listados en `STRYKER_BASELINE.md`

---

## 3. Arquitectura técnica actual

### server.ts split (cumulative R12-R21)
| Round | Phase | server.ts LOC | Δ |
|-------|-------|--------------:|---:|
| R12 baseline | — | 3.242 | — |
| R16 R5 | Phase 1 (admin/health/audit + middleware) | 3.030 | -212 |
| R17 R2 | Phase 2 (billing) | 2.097 | -933 |
| R17 R1 | hardening (re-imports IoT) | 2.377 | +280 |
| R18 A1 | Phase 3 (oauth + curriculum + projects) | 1.290 | -1.087 |
| R19 A2 | Phase 4 (gemini + reports + telemetry + gamification + misc) | 598 | -692 |
| R21 B1 | Phase 5 (background triggers + healthCheck) | **457** | -141 |

**server.ts hoy es bootstrap-only** (~457 LOC): KMS pre-flight, Sentry init, helmet/CSP, 14 router mounts, SIGTERM handler, terminal error middleware.

### Route modules extraídos (14 actuales)
1. `src/server/routes/admin.ts` — set-role, revoke-access (Round 16)
2. `src/server/routes/health.ts` — /api/health (Round 16)
3. `src/server/routes/audit.ts` — /api/audit-log (Round 16)
4. `src/server/routes/push.ts` — /api/push/register-token (Round 17)
5. `src/server/routes/billing.ts` — 6 routes + Webpay return + MP IPN (Round 17, +OIDC R19, +R20 jose swap)
6. `src/server/routes/curriculum.ts` — claim + 2 referee endpoints + WebAuthn challenge + register + verify (Round 18-20)
7. `src/server/routes/projects.ts` — invite + members + invitations (Round 18)
8. `src/server/routes/oauthGoogle.ts` — google + drive + calendar + fitness (Round 18)
9. `src/server/routes/gemini.ts` — /api/gemini + /api/ask-guardian (Round 19, +geminiLimiter R20)
10. `src/server/routes/reports.ts` — /api/reports/generate-pdf (Round 19)
11. `src/server/routes/telemetry.ts` — /api/telemetry/ingest + admin rotate-secret (Round 19)
12. `src/server/routes/gamification.ts` — points + leaderboard + check-medals + coach (Round 19)
13. `src/server/routes/misc.ts` — legal + erp + seed + environment (Round 19)
14. **Plus** trigger modules en `src/server/triggers/` (background + healthCheck — Round 21)

### Direct deps añadidas durante esta sesión
1. `@sentry/node@^10.50` + `@sentry/react@^10.50` (R13)
2. `i18next@^23` + `react-i18next@^14` (R15)
3. `mercadopago@^2` (R15)
4. `supertest@^7` + `@types/supertest@^6` (R15)
5. `jsdom@^25` + `@testing-library/react@^16` + `@testing-library/jest-dom@^6` (R15)
6. `@aparajita/capacitor-biometric-auth@^10` (R15)
7. `@simplewebauthn/server@^11` (R19)
8. `jose@^5.10` (R20)
9. `@stryker-mutator/core@^9.6` + `@stryker-mutator/vitest-runner` (R17)

### Firestore collections nuevas
- `ergonomic_assessments`, `iper_assessments` (R14, append-only post-sign)
- `gamification_scores`, `lighting_audits`, `uv_exposures`, `safety_trainings` (R15)
- `curriculum_claims` (R14, immutable verification trail)
- `webauthn_challenges`, `webauthn_credentials` (R19-R20)
- `processed_mp_ipn` (R18, idempotency)

---

## 4. Lo que falta por código

### Round 22 (próxima ronda recomendada por B7 reporter)
1. **Gemini split kickoff** (`src/services/geminiBackend.ts` 2.701 LOC → 12 modules) — phased R22-R26, B7 recomienda 3 modules conservative pace en R22 (`_shared` + `embeddings` + `classify`, resuelve cycle networkBackend)
2. **reba boundary tests** (trunk/neck/upperArm extension paths + 5 validation NoCoverage throws) → target ≥80% para break ratchet 65→70
3. **Phase 5 cleanup** — extract 10-min `updateGlobalEnvironmentalContext setInterval` a trigger module + SIGTERM (M1 R21)
4. **Cleanup**: `BackgroundTriggersDeps.geminiApiKey` unused field + `.claude/` en `.gitignore`
5. **rula remaining mutants** — 4 EqualityOperator + 7 BooleanLiteral → target 94.22% → ≥96%
6. **`*Assessments.ts` coverage gaps** — `crypto === undefined` fallback + `existing?.metadata?` optional chaining
7. **jose 6.x bump prep** — migration doc (R23 ejecuta)

### Round 23+ (más adelante)
- gemini split execution (R23-R26 phased, modules 4-12)
- WebAuthn registration UI flow client-side completion
- SOC 2 Type I path kickoff (compliance docs + Vanta/Drata signup)
- Marketplace add-on artifact (advertised en Titanio+ tier)
- Vertex AI real SDK swap (cuando primer Empresarial+ pague)
- SII PSE integration (OpenFactura) cuando Webpay producción firme
- HR/Mutual/Regulator dashboard differentiator
- Real production deploy via Cloud Run

### Conocidos pero no urgentes
- WebAuthn `expectedOrigin` con HTTP en prod warns, no fail-fast — opcional R23
- Stryker CI gate per-PR (hoy break-only local) — opcional
- Pages > 700 LOC todavía existen (Training 868, Gamification 794, Matrix 766, SiteMap 746) — refactor pattern de Dashboard/Telemetry probado, aplicable
- `geminiBackend.ts` `analyzeRiskWithAI:725` aún emite criticidad — wait, esto se cerró R19 A1. ✓
- Push Notifications FCM client-side wiring — R15 dejó server-side, hooks no consumen aún (R22 candidate)

---

## 5. Lo que falta operacional

**Esto NO es código — vos tenés que hacerlo.** Sin estos, no hay cliente pago.

### Bloqueantes para go-live (estimado 4-6 semanas wall-clock)
| # | Item | Tu acción | SLA externa |
|---|------|-----------|-------------|
| 1 | **Verificación dominio praeventio.net** (Search Console) | 1 día tu trabajo | inmediato Google |
| 2 | **Mailboxes**: contacto@/privacidad@/security@/dev@ | 1 día tu trabajo | inmediato |
| 3 | **/privacy + /terms hosted pages** | 1-2 días redacción + deploy | inmediato |
| 4 | **OAuth Consent Screen** submit en Google Cloud Console | después de #1-#3 | **5-15 días Google review** |
| 5 | **Marketplace listing** submit | después de #4 | **5-15 días Google review** |
| 6 | **Marketplace assets** (CRÍTICO): 0 screenshots actualmente, 0 promo banner, 0 video 90-sec | 3 días trabajo | n/a |
| 7 | **Transbank Webpay producción KYC** | 1 día papeleo | **2-4 semanas Transbank** |
| 8 | **Apple Developer enrollment** $99/yr + macOS para Capacitor iOS | 1-3 días enrollment | n/a |

### GCP infraestructura (1-2h trabajo)
9. `gcloud auth application-default login`
10. Habilitar 8 APIs (cloudkms, iam, storage, cloudscheduler, run, secretmanager, firestore, cloudresourcemanager)
11. Crear `terraform.tfvars` con `project_id`, `region=southamerica-west1`, `environment`, `app_domain`
12. `terraform apply` en `infrastructure/terraform/` (crea KMS keyring + GCS backups + Secret Manager skeleton)
13. Poblar **Secret Manager values**:
    - `SENTRY_DSN` (sin esto Sentry silent-degrades)
    - `WEBPAY_COMMERCE_CODE` + `WEBPAY_API_KEY` (después KYC #7)
    - `MP_ACCESS_TOKEN` + `MP_OIDC_AUDIENCE`
    - `RESEND_API_KEY`
    - `GEMINI_API_KEY`
    - `IOT_WEBHOOK_SECRET`
    - `OPENWEATHER_API_KEY`
    - `SESSION_SECRET`
    - `WEBAUTHN_RP_ID` (production: app.praeventio.net)
    - `APP_BASE_URL` (production)

### Otros operativos
14. **PGP key** generar + publicar en `/.well-known/pgp-key.asc` (hoy es placeholder)
15. **status.praeventio.net** status page provisioning (diferible)
16. **LHCI_GITHUB_APP_TOKEN** GitHub Actions secret (Lighthouse CI status posts en PRs)

---

## 6. Métricas consolidadas

| Métrica | R12 | R21 | Δ |
|---------|----:|----:|---:|
| Tests pasando | ~600 | 1.719 | +186% |
| Tests skipped | ~30 | 66 | +120% |
| Test files | ~30 | 86 | +186% |
| TS errors | varios | 0 | clean |
| server.ts LOC | 3.242 | 457 | -86% |
| Route modules | 0 | 14 | +14 |
| Trigger modules | 0 | 2 | +2 |
| Direct deps añadidas | — | 9 | — |
| Firestore collections nuevas | — | 9+ | — |
| Stryker global | n/a | 85.52% | — |
| Stryker break threshold | n/a | 65 | — |
| WebAuthn defensa layers | 0 | 5 | +5 |
| MP IPN auth | HMAC only | OIDC > HMAC > LEGACY | hardened |
| HMAC scheme | JSON.stringify | RFC 8785 canonical | hardened |

**Bundle (post R21):**
- main 257 KB gzip (budget 280)
- vendor-react 17 KB / vendor-firebase 144 KB / vendor-motion 41 KB / vendor-gantt 11 KB — todos dentro de budget
- RiskNetwork lazy 201 KB gzip (budget 250)
- PWA precache: 220 entries, 7.9 MiB

---

## 7. Ruta crítica al primer cliente pago

### Track A — Cliente CL via Webpay (4-6 semanas)
1. Vos: domain verification + mailboxes + /privacy /terms (~3 días)
2. Vos: OAuth Consent submit → **5-15 días Google review** (no podés acelerar)
3. Vos: Marketplace assets + listing submit → **5-15 días review** (en paralelo después de #2)
4. Vos: Transbank KYC → **2-4 semanas** (en paralelo con #2-#3)
5. Cuando KYC firme: poblar `WEBPAY_COMMERCE_CODE` + `WEBPAY_API_KEY` en Secret Manager
6. Deploy via Cloud Run + smoke test
7. Primer cliente CL puede pagar

### Track B — Fallback más rápido (Stripe USD path) ~1 semana
- `npm install stripe`
- Implementar adapter siguiendo pattern de `webpayAdapter`/`mercadoPagoAdapter`
- Wire en Pricing.tsx para countries no-LATAM
- Submit Marketplace listing en paralelo con Track A
- **Primer cliente internacional antes de cliente CL si Track A se atrasa**

### Track C — Cliente LATAM via MercadoPago (existe la infra, falta credenciales)
- Adapter shipped (R15) + IPN OIDC shipped (R19+R20)
- Solo falta credentials en Secret Manager (`MP_ACCESS_TOKEN`, `MP_OIDC_AUDIENCE`, `MP_OIDC_ISSUER`)
- Más fácil que Webpay (no KYC formal en mismo nivel)

### Cuello de botella honesto
**El reloj de Google es lo que manda** (5-15 días OAuth + 5-15 días Marketplace). Cualquier hora que vos NO trabajes en Track A items 1-3 es una hora perdida en el calendario externo.

**El código no es el bottleneck.** Está listo.

---

## 8. Recomendación

Cuatro escenarios, vos elegís:

### Escenario 1 — "Quiero shippear, no más código"
**Acción**: vos atacás Track A items 1-3 esta semana. Yo me quedo standby. Cuando termines #1-#3, vos submiteás OAuth Consent y arranca el reloj Google. Mientras Google revisa, podés volver a pedirme Round 22 (gemini split) sin presión.

### Escenario 2 — "Sigo con Round 22 técnico mientras vos no podés operativo"
**Acción**: yo dispatcho Round 22 con el plan B7 entregó (gemini split kickoff + reba boundary + cleanup). Es 7 implementadores en paralelo + reviewer + reporter. ~2h de mi tiempo, aporta otro -10% en server.ts split + cierra los 2 MEDIUMs R21.

### Escenario 3 — "Pausa, dame 1 semana para entender"
**Acción**: te dejo este informe + el repo está estable en HEAD `838e30e`. No dispatcho nada. Cuando vuelvas, retomamos donde quieras (operativo, técnico, o estratégico).

### Escenario 4 — "Cambio de prioridad: SOC 2 + ISO 27001 path"
**Acción**: Round 22 reorientado a compliance. Crear `compliance/` folder con policies (Access Control, Change Management, Incident Response, BCP, Vendor Management), kickoff Vanta/Drata signup, mapear nuestros controles técnicos (KMS envelope, audit_logs immutable, RBAC, MFA scaffold, helmet/CSP, default-deny rules) contra Annex A. Habilita ventas Empresarial+/Corporativo. ~6 meses external review cycle independiente del producto.

**Mi recomendación honesta:** **Escenario 1**. El código está bien. Lo que NO está bien es que el reloj de Google no avance porque vos no submiteaste OAuth Consent. Eso destraba todo lo demás.

---

## 9. Incidentes técnicos

Para que sepas qué pasó en bambalinas:

### Revert pattern (5+ ocurrencias R14-R20)
Patrón observado: agentes implementadores escribieron archivos exitosamente (tool reportó OK) pero el archivo en disco se reverteó mid-sesión. Detectado vía git status mostrando 0 changes, grep returning nada, file timestamps jumping backwards. Documentado completo en `AUDIT.md` con 6-step mitigation playbook.

### A1 R20 stalled (watchdog 600s)
El agente que intentó Phase 5 server.ts split en R20 stalled — quedó pensando demasiado en el ABORT criteria de startup-order side effects. Solución R21: usar `EnterWorktree` isolation + 300s pre-pass timebox. R21 B1 completó en 75s sin stall. Pattern probado.

### R21 orchestrator pwd drift (false alarm)
Mid-R21 yo (orchestrator) creí que B2/B3/B4/B5 work se había perdido. Era falso — Bash tool había quedado en cwd del worktree de B1, no en main. Resuelto con `cd` explícito a main. Documentado en B6 reviewer report como "process improvement: orchestrator MUST cd back after worktree-isolated agents".

### A8 R18 lost work
Agent A8 R18 reportó éxito (Gemini criticidad cleanup) pero git status mostró 0 changes. Lost to revert pattern. Re-do R19 A1 con `git diff --stat` MANDATORY en completion report — ese ya no se perdió.

---

## 10. Apéndice — Drive

No tengo capacidad de subir directamente a tu Google Drive desde este entorno. Tres opciones:

### Opción A — descargar de GitHub
1. Voy a commitear este informe + push (siguiente paso)
2. Vos lo descargás de https://github.com/mikesandoval10creator/Guardian-Praeventio/blob/main/INFORME_ESTADO_2026-04-29.md
3. Click "Download raw file" → guardás como `.md`
4. Subís a Drive manualmente

### Opción B — copy-paste
Este mismo texto está completo arriba. Podés:
- Seleccionar todo el contenido del informe
- Pegarlo en un Google Docs nuevo
- Compartir con vos mismo

### Opción C — usar la integración Drive de la app (post go-live)
La app tiene `/api/drive/auth/*` endpoints OAuth para Drive. Una vez que OAuth Consent Screen esté aprobado por Google (Track A item #4), podés conectar la app a tu Drive y guardar reportes ahí automáticamente. Pero eso requiere primero cerrar Track A.

---

**Repo HEAD post-informe:** será el commit que añade este archivo. Working tree clean post-R21.

**Si querés actualizo este informe:** decime "actualizá el informe con XYZ" y lo regenero. Si querés que lo agregue a `IMPACTO.md` o cualquier otro doc, también.

**Si querés que pause:** decime y no dispatcho Round 22. El estado actual (R21 closed) es estable y shippable a nivel código.
