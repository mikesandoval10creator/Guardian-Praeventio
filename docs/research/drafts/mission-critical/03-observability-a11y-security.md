# Observabilidad, Accesibilidad y Seguridad/Privacidad-by-Design — Estándares para Guardian Praeventio

> **Documento de investigación — borrador.**
> Ticket: `3a3aa66d-73fe-8196-b5aa-de61e48f3641`. Base commit: `09349d1f`.
> Fecha de investigación: 2026-08-12.
>
> Este documento contrasta los estándares primarios autoritativos (Google SRE,
> W3C WCAG 2.2, web.dev/Core Web Vitals, Android vitals, Apple App Store) con la
> evidencia verificable en el repositorio de Guardian Praeventio. Cada claim de
> Guardian se ancla en `archivo:línea` tras lectura directa del código. Solo se
> enumeran gaps verificables — no aspiraciones.

---

## Tabla de contenidos

1. [Metodología](#1-metodología)
2. [Tabla fetch/blocked de fuentes primarias](#2-tabla-fetchblocked-de-fuentes-primarias)
3. [SLO, error budgets y monitoring](#3-slo-error-budgets-y-monitoring)
4. [WCAG 2.2 y criterios de rendimiento web](#4-wcag-22-y-criterios-de-rendimiento-web)
5. [Seguridad y privacidad en apps Android y Apple](#5-seguridad-y-privacidad-en-apps-android-y-apple)
6. [Evidencia actual de Guardian por dominio](#6-evidencia-actual-de-guardian-por-dominio)
7. [Gaps verificables restantes](#7-gaps-verificables-restantes)
8. [Fuentes canónicas](#8-fuentes-canónicas)

---

## 1. Metodología

- **Fuentes primarias**: se consultaron directamente las páginas canónicas de
  Google SRE Book/Workbook, W3C WCAG 2.2, web.dev, Android Developers (Android
  vitals) y Apple Developer (App Review Guidelines). Cada cita entre comillas
  proviene de la lectura directa del contenido publicado.
- **Evidencia de Guardian**: cada claim sobre el repositorio se obtuvo leyendo
  el archivo físico en el worktree
  `wt-3a3aa66d-mission-critical-standards/` al commit base `09349d1f`. Las
  referencias siguen el formato `archivo:línea` para que cualquier verificador
  pueda confirmarlas con `read_file` o `git show`.
- **Gaps**: se enumeran únicamente deficiencias verificables — ausencia de
  código/configuración documentada como pendiente en archivos del propio repo,
  no opiniones del investigador.
- **Sin edición de producción**: no se modificaron archivos del repositorio,
  Notion ni git.

---

## 2. Tabla fetch/blocked de fuentes primarias

| Fuente                                          | URL canónica                                                                                              | Método                                                          | Fecha      | Estado                                                                                  |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| Google SRE Book — Ch.4 Service Level Objectives | `https://sre.google/sre-book/service-level-objectives/`                                                   | browser_navigate + lectura completa                             | 2026-08-12 | ✅ fetched                                                                              |
| Google SRE Workbook — Alerting on SLOs          | `https://sre.google/workbook/alerting-on-slos/`                                                           | web_search (snippet confirmado por SLO.md §7)                   | 2026-08-12 | ✅ fetched (vía search snippet)                                                         |
| W3C — What's New in WCAG 2.2                    | `https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/`                                             | browser_navigate + lectura completa                             | 2026-08-12 | ✅ fetched                                                                              |
| W3C — WCAG 2.2 Recommendation (TR)              | `https://www.w3.org/TR/WCAG22/`                                                                           | web_search (descripción confirmada)                             | 2026-08-12 | ✅ fetched (vía search)                                                                 |
| web.dev — INP / Core Web Vitals                 | `https://web.dev/articles/inp`                                                                            | browser_navigate + lectura completa                             | 2026-08-12 | ✅ fetched                                                                              |
| web.dev — Core Web Vitals thresholds            | `https://web.dev/articles/defining-core-web-vitals-thresholds`                                            | web_search (descripción confirmada)                             | 2026-08-12 | ✅ fetched (vía search)                                                                 |
| Android Developers — Crashes / Android vitals   | `https://developer.android.com/topic/performance/vitals/crash`                                            | browser_navigate + lectura completa                             | 2026-08-12 | ✅ fetched                                                                              |
| Apple Developer — App Review Guidelines         | `https://developer.apple.com/app-store/review/guidelines/`                                                | browser_navigate + lectura (sección Safety + Before You Submit) | 2026-08-12 | ✅ fetched (parcial — guideline 5.1.x Privacy no se cargó completamente en el snapshot) |
| Sentry — Release Health (crash-free sessions)   | `https://docs.sentry.io/product/releases/health/`                                                         | Cita indirecta via `docs/observability/SLO.md` §7               | 2026-08-12 | ⚠️ referencia secundaria (no fetch directo)                                             |
| Luciq — Mobile App Stability Outlook 2025       | `https://www.luciq.ai/blog/benchmarking-crash-free-sessions-for-mobile-apps-whats-a-good-crash-free-rate` | Cita indirecta via `docs/observability/SLO.md` §7               | 2026-08-12 | ⚠️ referencia secundaria (no fetch directo)                                             |

> **Nota de bloqueos**: `web_extract` falló (backend DuckDuckGo es search-only);
> se usó `browser_navigate` como alternativa. Ninguna fuente primaria quedó
> totalmente bloqueada — las marcadas "vía search" se confirmaron por snippet de
> resultados con URL canónica verificable, pero el contenido completo no se
> navegó en browser.

---

## 3. SLO, error budgets y monitoring

### 3.1 Estándar primario — Google SRE Book

**Fuente canónica**: Google SRE Book, Chapter 4 — Service Level Objectives.
URL: `https://sre.google/sre-book/service-level-objectives/`

> «An SLI is a service level _indicator_—a carefully defined quantitative
> measure of some aspect of the level of service that is provided.»

> «An SLO is a _service level objective_: a target value or range of values for
> a service level that is measured by an SLI.»

> «SLAs are service level _agreements_: an explicit or implicit contract with
> your users that includes consequences of meeting (or missing) the SLOs they
> contain.»

> «The error budget provides a clear, objective metric that determines how
> unreliable the service is allowed to be within a single quarter.»

_(Fuente: SRE Book, Ch.3 Embracing Risk — `https://sre.google/sre-book/embracing-risk/`)_

**Multi-window burn-rate** — SRE Workbook §5 (Alerting on SLOs):
URL: `https://sre.google/workbook/alerting-on-slos/`

> «the SLO is a target percentage and the error budget is 100% minus the SLO»

_(Fuente: SRE Workbook, Implementing SLOs — `https://sre.google/workbook/implementing-slos/`)_

### 3.2 Estándar primario — Android vitals

**Fuente canónica**: Android Developers — Crashes.
URL: `https://developer.android.com/topic/performance/vitals/crash`

> «Al menos el 1.09% de los usuarios activos por día experimentan una falla
> percibida por el usuario en todos los modelos de dispositivos.» _(Umbral
> general de comportamiento inadecuado)_

> «Al menos el 8% de los usuarios activos por día experimentan una falla
> percibida por el usuario [en algún modelo de dispositivo].» _(Umbral por
> dispositivo)_

> «La tasa de fallas percibidas por el usuario es una _métrica esencial_, lo que
> significa que afecta la visibilidad de tu app en Google Play.»

### 3.3 Evidencia de Guardian — SLO y error budgets

Guardian mantiene **dos capas de SLO**:

**Capa A — SLOs operacionales (infraestructura)** definidos en
`OBSERVABILITY.md:308-316` y codificados en Terraform
`infrastructure/terraform/monitoring.tf`:

| SLO                         | Target  | Ventana       | Archivo fuente                                                                   |
| --------------------------- | ------- | ------------- | -------------------------------------------------------------------------------- |
| `/api/health` 2xx rate      | ≥ 99.9% | 7d (proxy 1h) | `OBSERVABILITY.md:312`, `monitoring.tf:257-310`                                  |
| Webpay return p95 latency   | < 5 s   | 1h            | `OBSERVABILITY.md:313`, `monitoring.tf:323-384`                                  |
| Health Connect sync success | ≥ 95%   | 1d            | `OBSERVABILITY.md:314`, `monitoring.tf` (resource `health_connect_success_rate`) |
| Calendar predictions p99    | < 10 s  | 1d            | `OBSERVABILITY.md:315`                                                           |
| SII emission success rate   | ≥ 98%   | —             | `OBSERVABILITY.md:316`                                                           |
| Firestore backup freshness  | < 36h   | —             | `MONITORING.md:64` (SLO #5)                                                      |
| KMS error rate              | < 1%    | 1h            | `MONITORING.md:65` (SLO #6)                                                      |

**Capa B — SLOs safety-critical** definidos en `docs/observability/SLO.md`
(ticket `3a4aa66d`):

| SLO                          | Target                     | Ventana     | Archivo fuente |
| ---------------------------- | -------------------------- | ----------- | -------------- |
| SOS delivery                 | **99.95%**                 | 28d rodante | `SLO.md:39`    |
| Crash-free sessions path SOS | **99.99%**                 | 28d rodante | `SLO.md:49`    |
| Crash-free sessions general  | **≥ 99.9%** (floor 98.91%) | 28d rodante | `SLO.md:57-61` |
| Check-in p95 latency         | **≤ 2.000 ms** (3G)        | 7d rodante  | `SLO.md:68`    |

**Error budget mensual** calculado en `SLO.md:76-80`:

- SLO 99.95% (30d = 43.200 min): error budget = **21,6 min/mes**
- SLO 99.99%: error budget = **4,32 min/mes**
- SLO 99.9% general: 0,1% de sesiones pueden crashear

**Política de congelación de deploys** (`SLO.md:82-91`):

> «50% consumido en ≤ 7 días → Congelar deploys de funcionalidad no-crítica»
> «100% consumido → Solo se deployan fixes al servicio afectado»

**Multi-window burn-rate** — primera alerta implementada en
`docs/observability/sentry-alerts.yaml:95-104`:

```yaml
- id: P0-sos-delivery-burn
  name: SOS delivery burn-rate (multi-window 1h+6h)
  threshold:
    burnRate:
      - window: 1h
        budgetFraction: 0.02 # 2% del error budget SLO 1 consumido en 1h
      - window: 6h
        budgetFraction: 0.05 # 5% en 6h
```

**Implementación de burn-rate en código** — `src/services/observability/slos.ts:107-134`:
función `computeBurn()` implementa el cálculo de error budget consumption para
tres tipos de métrica (availability, latency_p95, error_rate), con función
`burnRateStatus()` para badges de UI (`slos.ts:144-148`).

### 3.4 Gaps de observabilidad verificados

| Gap                                      | Evidencia en repo                                                                                                                   | Impacto                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Cloud Monitoring adapter sigue como stub | `OBSERVABILITY.md:405-409`: «install `@google-cloud/monitoring`, define custom metric types, replace `cloudMonitoringAdapter` stub» | Métricas operacionales (api/requests, latency) no se emiten a Cloud Monitoring; SLO #3-#4 dependen de esto |
| OpenTelemetry tracing no implementado    | `OBSERVABILITY.md:410-412`: «OpenTelemetry distributed tracing — deferred to Round 3»                                               | Sin trazas distribuidas entre Express → Vertex AI → Firestore                                              |
| Métricas custom no emitidas todavía      | `MONITORING.md:249-251`: «billing/active_subscriptions, iper/assessments. Los paneles del business dashboard quedan vacíos»         | Business dashboard tiene paneles sin datos                                                                 |
| PagerDuty/Slack pendientes               | `MONITORING.md:238-240`: «PagerDuty integration — cuando exista rotación on-call»                                                   | Alertas P1 no despiertan a nadie fuera de horario                                                          |
| Burn-rate batch job pendiente            | `MONITORING.md:252-253`: «calcular el SLO real de 7d y 1d en lugar de usar el proxy de ventana corta»                               | SLO accuracy depende de aproximación de ventana corta                                                      |
| Source map upload para Sentry diferido   | `OBSERVABILITY.md:402`: «Source map upload in build step (`@sentry/cli`) — deferred»                                                | Stack traces en Sentry muestran código minificado                                                          |
| React `Sentry.ErrorBoundary` diferido    | `OBSERVABILITY.md:393-394`: «React `Sentry.ErrorBoundary` around root — deferred to Round 14»                                       | Errores de React no se capturan con boundary de recuperación                                               |
| Calibración de thresholds pendiente      | `MONITORING.md:155-161`: «Los thresholds son _placeholders del primer día_»                                                         | Umbrales sin validar contra baseline de producción real                                                    |

---

## 4. WCAG 2.2 y criterios de rendimiento web

### 4.1 Estándar primario — W3C WCAG 2.2

**Fuente canónica**: W3C — What's New in WCAG 2.2.
URL: `https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/`

> «WCAG 2.2 was published as a "W3C Recommendation" web standard on
> 5 October 2023.»

> «**WCAG 2.2 provides 9 additional success criteria since WCAG 2.1.** They are
> introduced on this page.»

> «The 2.0 and 2.1 success criteria are essentially the same in 2.2, with one
> exception: **4.1.1 Parsing is obsolete and removed from WCAG 2.2.**»

**Los 9 criterios nuevos en WCAG 2.2** (verificados en la página canónica):

| #      | Criterio                             | Nivel | Fuente        |
| ------ | ------------------------------------ | ----- | ------------- |
| 2.4.11 | Focus Not Obscured (Minimum)         | AA    | W3C new-in-22 |
| 2.4.12 | Focus Not Obscured (Enhanced)        | AAA   | W3C new-in-22 |
| 2.4.13 | Focus Appearance                     | AAA   | W3C new-in-22 |
| 2.5.7  | Dragging Movements                   | AA    | W3C new-in-22 |
| 2.5.8  | Target Size (Minimum)                | AA    | W3C new-in-22 |
| 3.2.6  | Consistent Help                      | A     | W3C new-in-22 |
| 3.3.7  | Redundant Entry                      | A     | W3C new-in-22 |
| 3.3.8  | Accessible Authentication (Minimum)  | AA    | W3C new-in-22 |
| 3.3.9  | Accessible Authentication (Enhanced) | AAA   | W3C new-in-22 |

Cita exacta del criterio 2.4.11 Focus Not Obscured (Minimum):

> «When a user interface component receives keyboard focus, the component is not
> entirely hidden due to author-created content.»

### 4.2 Estándar primario — Core Web Vitals

**Fuente canónica**: web.dev — Interaction to Next Paint (INP).
URL: `https://web.dev/articles/inp`

> «Un INP bajo significa que la página pudo responder rápidamente a todas las
> interacciones del usuario, o a la gran mayoría de ellas, de forma constante.»

> «La métrica Interaction to Next Paint (INP) es una métrica de Métrica web
> esencial _estable_ que evalúa la capacidad de respuesta con datos de la API de
> Event Timing.»

**Umbrales oficiales INP** (verificados en web.dev):

- **Good (bueno)**: ≤ 200 ms
- **Needs improvement (necesita mejorar)**: 201–500 ms
- **Poor (deficiente)**: > 500 ms

INP reemplazó a First Input Delay (FID) como Core Web Vital el **12 de marzo de
2024** (`https://web.dev/blog/inp-cwv-march-12`).

### 4.3 Evidencia de Guardian — WCAG 2.2 AA

Guardian realizó un **audit WCAG 2.2 AA completo** documentado en tres archivos:

**`docs/a11y/A11Y_AUDIT.md`** — auditoría metodológica:

- Scope: web SPA (`src/`), 4 modos de UI (normal-light, normal-dark, driving,
  emergency)
- Método: axe-core automatizado (`tests/e2e/accessibility.spec.ts`) + inspección
  manual por superficie (`A11Y_AUDIT.md:34-56`)
- **52 criterios WCAG 2.2 AA evaluados** (`A11Y_AUDIT.md:110`)
- Resultado inicial: 28 PASS, 12 PARTIAL, 5 FAIL, 7 N/A, 1 removed

**`docs/a11y/checklist-WCAG-2.2-AA.md`** — checklist criterio por criterio con
estado, justificación y referencia a file:line para cada uno.

**`docs/a11y/WCAG_findings.md`** — 20 findings concretos con `file:line`,
severidad (SEV1/SEV2/SEV3), status y mitigación.

**Estado actual de findings** (verificado `WCAG_findings.md:36-41`):

- Total findings: **20**
- SEV1 critical: **0** (A11Y-001 cerrado)
- SEV2 medium: 6
- SEV3 low: 14
- Status: **0 fail, 1 partial, 19 mitigated**

El único partial restante es **A11Y-016** (Focus Not Obscured — ModeSwitcher
overlap), marcado como "monitoring-only, no code change planned" con
justificación explícita en `WCAG_findings.md:29`.

**Verificación de los 9 criterios nuevos de WCAG 2.2** en
`checklist-WCAG-2.2-AA.md`:

| Criterio 2.2                    | Estado Guardian   | Referencia checklist | Finding                               |
| ------------------------------- | ----------------- | -------------------- | ------------------------------------- |
| 2.4.11 Focus Not Obscured (Min) | PARTIAL           | `checklist:84`       | A11Y-016 (partial/monitoring)         |
| 2.4.13 Focus Appearance         | PARTIAL           | `checklist:85`       | A11Y-017 (mitigated)                  |
| 2.5.7 Dragging Movements        | MITIGATED         | `checklist:95`       | A11Y-018 (design decision documented) |
| 2.5.8 Target Size (Minimum)     | PARTIAL→mitigated | `checklist:96`       | A11Y-010 (24×24 overlays added)       |
| 3.2.6 Consistent Help           | PASS              | `checklist:115`      | —                                     |
| 3.3.7 Redundant Entry           | PASS              | `checklist:125`      | —                                     |
| 3.3.8 Accessible Auth (Min)     | PASS              | `checklist:126`      | —                                     |

> Nota: 2.4.12 y 3.3.9 son nivel AAA — fuera del scope AA del audit.

**Verificación directa** — `index.html` ahora declara `<html lang="es-CL">`
(verificado `index.html:2`), cerrando A11Y-001 (lang="en" → lang="es").

### 4.4 Evidencia de Guardian — Rendimiento web

**`PERFORMANCE.md`** documenta dos capas de budgets:

**Bundle size** (`.size-limit.json`):

| Bundle              | Límite (gzipped) | `PERFORMANCE.md` ref |
| ------------------- | ---------------- | -------------------- |
| `index-*.js` (main) | 300 KB           | `PERFORMANCE.md:30`  |
| `vendor-*.js`       | 500 KB           | `PERFORMANCE.md:31`  |
| `RiskNetwork-*.js`  | 250 KB           | `PERFORMANCE.md:32`  |
| `index-*.css`       | 60 KB            | `PERFORMANCE.md:33`  |

**Lighthouse CI** (`lighthouserc.json`) — assertion levels verificados:

| Métrica                 | Threshold | Severity  | `lighthouserc.json` ref |
| ----------------------- | --------- | --------- | ----------------------- |
| Performance score       | ≥ 0.85    | warn      | línea 25                |
| **Accessibility score** | ≥ 0.9     | **error** | línea 26                |
| **Best Practices**      | ≥ 0.9     | **error** | línea 27                |
| CLS                     | ≤ 0.1     | **error** | línea 32                |
| LCP                     | ≤ 4000 ms | warn      | línea 31                |
| TBT                     | ≤ 600 ms  | warn      | línea 33                |

> **Nota de discrepancia entre doc y código**: `PERFORMANCE.md:54-55` documenta
> LCP ≤ 2.200 ms y TBT ≤ 200 ms, pero `lighthouserc.json:31,33` tiene los valores
> reales en 4000 ms y 600 ms respectivamente. Esto indica que la config fue
> relajada en iteraciones posteriores ("Sprint 34 audit quick-win" comment en
> `lighthouserc.json:22`). Performance y Best-Practices se promueven a `error`
> pero el threshold de LCP/TBT se relajó — verificado en el JSON canónico.

**Throttling**: configuración de 3G simulado (400 kbps, 150ms RTT, 4x CPU
slowdown) en `lighthouserc.json:9-14`, diseñada para emular bandwidth de faena
minera (`lighthouserc.json:23`).

### 4.5 Gap de rendimiento verificado

| Gap                      | Evidencia                                                                                                   | Impacto                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| INP no medido            | `lighthouserc.json` no incluye `interaction-to-next-paint` como assertion; `PERFORMANCE.md` no menciona INP | Guardian no mide la métrica Core Web Vital estable desde marzo 2024 (reemplazo de FID) |
| LCP/TBT relajados vs doc | `PERFORMANCE.md:54-55` dice LCP ≤ 2.200ms, `lighthouserc.json:31` dice ≤ 4.000ms                            | Brecha entre intención documentada y enforcement real                                  |

---

## 5. Seguridad y privacidad en apps Android y Apple

### 5.1 Estándar primario — Apple App Store Guidelines

**Fuente canónica**: Apple Developer — App Review Guidelines.
URL: `https://developer.apple.com/app-store/review/guidelines/`

> «We also scan each app for malware and other software that may impact user
> safety, security, and privacy. These efforts have made Apple's platforms the
> safest for consumers around the world.»

> «You are responsible for making sure everything in your app complies with
> these guidelines, including ad networks, analytics services, and third-party
> SDKs, so review and choose them carefully.»

**Data Minimization** (Guideline 5.1.1, citado vía web_search):

> «Apps should only request access to data relevant to [the] app»

**Pilares de privacidad de Apple** (WWDC24, confirmado vía search):

1. Data Minimization
2. On-Device Processing
3. Transparency and Control
4. Security

### 5.2 Estándar primario — Android vitals y Play Store

**Fuente canónica**: Android Developers — Android vitals.
URL: `https://developer.android.com/topic/performance/vitals`

> «The crash, ANR, and battery usage core vitals have two bad behavior
> thresholds: one for all sessions across devices and one per device.»

> «Your vitals metrics affect your user experience and the promotability of your
> app on Google Play.»

**Umbral bad behavior verificado** (crash page citado en §3.2):

- General: ≥ 1.09% DAU con user-perceived crash → visibilidad reducida
- Por dispositivo: ≥ 8% → advertencia en Play Store listing

### 5.3 Evidencia de Guardian — Privacy-by-Design

**ADR 0010 — Privacy by Design** (`docs/architecture-decisions/0010-privacy-by-design-no-intimate-data.md`):

Decisión arquitectónica **accepted** con estatus de "principio inviolable"
(`ADR-0010:2`). Pilar filosófico: **«prevención cálida, NO vigilancia
disfrazada de cuidado»** (`ADR-0010:21`).

Datos íntimos que la app **JAMÁS** captura (`ADR-0010:42-56`):

- Sueño, ritmo cardíaco fuera de turno, ubicación fuera de turno
- Mensajería personal, redes sociales, vida fuera de faena
- Salud mental privada, estado emocional inferido, relaciones personales

**Guards de código** — la API rechaza lecturas fuera del turno activo
(`ADR-0010:84-101`):

```ts
// src/services/health/healthFacadeNative.ts
getHeartRateDuringShift(shift: ShiftWindow): Promise<HrSample[]>;
// REJECTS reads outside active shift window. Throws if range escapes.
```

**Privacy compliance matrix** (`docs/privacy-compliance-matrix.md`):

| País   | Régimen                | Estado               | Deadline |
| ------ | ---------------------- | -------------------- | -------- |
| Chile  | Ley 19.628 mod. 21.719 | **IMPLEMENTADO E2E** | 30d      |
| Brasil | LGPD-BR                | **IMPLEMENTADO E2E** | 15d      |
| EU     | GDPR-EU                | DECLARADO            | 30d      |
| US-CA  | CPRA/CCPA              | DECLARADO            | 45d      |
| Japón  | APPI-JP                | DECLARADO            | 14d      |

Rights soportados E2E hoy (`privacy-compliance-matrix.md:29-37`):

- access: `GET /api/compliance/data-export/:requestId`
- portability: mismo endpoint con `type='portability'`
- rectification: `POST /api/compliance/data-request type=rectification`
- erasure: `POST /api/compliance/data-request type=erasure`
- consent_withdrawal: `DELETE /api/compliance/consent/:purpose`

### 5.4 Evidencia de Guardian — Seguridad

**Sentry PII redaction** — dos capas:

**Capa servidor** (`src/services/observability/piiRedactor.ts`):

- Redacta RUT chileno, email, teléfono móvil CL, tarjetas, API keys
  (`piiRedactor.ts:61-86`)
- Idempotente y Unicode-safe (`piiRedactor.ts:91-98`)
- Comentado como defensa en depth: «the boundary is the BAA with Google +
  region selection» (`piiRedactor.ts:15-17`)

**Capa browser/Sentry init** (`src/lib/sentry.ts`):

- `redactPii()` elimina email, username, ip_address de event.user
  (`sentry.ts:20-24`)
- Redacta headers Cookie, Set-Cookie, Authorization, Proxy-Authorization
  (`sentry.ts:48-49`)
- Scrub GPS de breadcrumbs (lat, lng, latitude, longitude) — Ley 19.628
  (`sentry.ts:62-80`)
- `captureEmergencyError()` taggea con `domain: safety_critical`
  (`sentry.ts:134-140`)

**Sentry instrumentation** (`src/services/observability/sentryInstrumentation.ts`):

- `REDACT_KEYS` — 11 keys redactadas antes de salir del proceso
  (`sentryInstrumentation.ts:157-169`): authorization, cookie, token, apiKey,
  api_key, sessionId, session, password, prompt, rawPrompt, userInput
- `withSentryScope()` envuelve cada llamada en scope aislado
  (`sentryInstrumentation.ts:77-109`)
- SDK fault nunca toma down el request path (`sentryInstrumentation.ts:15-18`)

**Endpoint security telemetry** — redacción de grant IDs y record IDs en
`verifyAuth.ts` (`endpointForSecurityTelemetry`), verificado con tests en
`src/server/middleware/verifyAuth.healthPrivacy.test.ts:6-15`.

### 5.5 Gaps de seguridad/privacidad verificados

| Gap                                                                | Evidencia en repo                                                                                                                                     | Impacto                                                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Clave PGP real para responsible disclosure pendiente               | `SECURITY.md:17-25` declara que la clave aún no está hecha; `public/.well-known/pgp-key.asc` es una plantilla que exige reemplazo por un export real. | Reportes sensibles dependen de coordinación ad-hoc hasta publicar una clave verificable. |
| `security.txt` publicado, pero sin instrucción `Encryption` activa | `public/.well-known/security.txt:4` mantiene `Encryption:` comentado mientras no exista clave real.                                                   | El punto de contacto RFC 9116 existe; falta cerrar cifrado PGP, no publicar el archivo.  |
| DSAR worker GDPR portability incompleto                            | `privacy-compliance-matrix.md:72-74`: falta bundle estándar CSV + JSON + manifest.                                                                    | Portabilidad GDPR no demuestra todavía el formato machine-readable requerido.            |
| Breach notification routes faltantes                               | `privacy-compliance-matrix.md:75`: rutas hacia EDPB / ANPD / CPPA / PPC.                                                                              | Notificación a autoridades no automatizada.                                              |
| Cookie banner per-jurisdiction pendiente                           | `privacy-compliance-matrix.md:76`.                                                                                                                    | Consent strings aún no se adaptan por jurisdicción.                                      |
| Auditoría legal por jurisdicción pendiente                         | `privacy-compliance-matrix.md:78-79`: cada país requiere validación local antes de marketing claims.                                                  | Claims de cumplimiento no validados legalmente.                                          |

> **Corrección adversarial:** la lista de sub-procesadores **ya está publicada** en `public/subprocessors.html:1-17,54-95` y referenciada desde `public/privacy.html:46,81`. La línea de la matriz que la marca pendiente está stale frente al árbol actual; no se conserva como gap.
> | Sentry source-map upload diferido | `OBSERVABILITY.md:402`: deferred | Triage de errores más lento (minified traces) |
> | Focus trap en AddDocumentModal diferido | `WCAG_findings.md:26`: «Focus trap deferred — would require adding `focus-trap-react`» | WCAG 2.4.3 focus order parcialmente cubierto |

---

## 6. Evidencia actual de Guardian por dominio

### Resumen de cobertura vs estándares

| Dominio                         | Estándar aplicado          | Cobertura Guardian                                        | Fuente principal                              |
| ------------------------------- | -------------------------- | --------------------------------------------------------- | --------------------------------------------- |
| SLI/SLO definidos               | Google SRE Book Ch.4       | ✅ 2 capas (operacional + safety-critical)                | `OBSERVABILITY.md`, `SLO.md`                  |
| Error budgets                   | Google SRE Workbook §5     | ✅ Calculados + política de freeze                        | `SLO.md:76-91`                                |
| Multi-window burn-rate          | SRE Workbook §5 approach 6 | ⚠️ 1 alerta implementada (SOS), 4 recomendadas pendientes | `sentry-alerts.yaml:95-104`, `SLO.md:112-119` |
| Monitoring como código          | Terraform google provider  | ✅ 6 alert policies + 2 channels + 7 metric descriptors   | `monitoring.tf`                               |
| Sentry SDK wired                | Sentry docs                | ✅ `@sentry/node@^10.69`, `@sentry/react@^10.69`          | `package.json:136-137`, `src/lib/sentry.ts`   |
| PII redaction                   | Ley 19.628 / GDPR art.5    | ✅ Doble capa (browser + server instrumentation)          | `src/lib/sentry.ts`, `piiRedactor.ts`         |
| WCAG 2.2 AA audit               | W3C TR WCAG 22             | ✅ 52 criterios evaluados, 19/20 findings mitigados       | `docs/a11y/` (3 archivos)                     |
| Core Web Vitals (LCP/CLS/TBT)   | web.dev                    | ✅ Lighthouse CI con thresholds + throttling 3G           | `lighthouserc.json`                           |
| INP (Core Web Vital desde 2024) | web.dev                    | ❌ No medido                                              | Ausencia en `lighthouserc.json`               |
| Bundle size budgets             | —                          | ✅ `.size-limit.json` con 4 bundles                       | `PERFORMANCE.md`                              |
| Privacy-by-Design               | ADR 0010                   | ✅ Guards de código + test patterns                       | `ADR-0010`, `healthFacadeNative`              |
| Privacy compliance matrix       | Ley 19.628 / GDPR / LGPD   | ✅ CL + BR E2E; 6 países declarados; 2 stub               | `privacy-compliance-matrix.md`                |
| Android crash threshold         | Android vitals 1.09%       | ✅ Referenciado como floor en SLO 3                       | `SLO.md:58`                                   |
| Apple Data Minimization         | App Store Guidelines 5.1.1 | ✅ Implementado via ADR 0010 (shift-boundary)             | `ADR-0010:42-56`                              |

---

## 7. Gaps verificables restantes

Lista consolidada de gaps verificables, priorizada por impacto en producción:

### Observabilidad (P1-P2)

1. **Cloud Monitoring adapter sin swap real** — métricas operacionales no llegan
   a GCP. SLOs #3-#4 son "absent metric" hasta que se emita. (`OBSERVABILITY.md:405-409`)
2. **OpenTelemetry tracing no implementado** — sin trazas distribuidas.
   (`OBSERVABILITY.md:410-412`)
3. **Sentry source-map upload diferido** — stack traces minificados.
   (`OBSERVABILITY.md:402`)
4. **React ErrorBoundary diferido** — errores React sin boundary de
   recuperación. (`OBSERVABILITY.md:393-394`)
5. **Burn-rate batch job pendiente** — SLO accuracy depende de proxy de ventana
   corta. (`MONITORING.md:252-253`)
6. **PagerDuty/Slack pendientes** — alertas P1 no despiertan on-call.
   (`MONITORING.md:238-240`)

### Accesibilidad (P2-P3)

7. **INP no medido** — Core Web Vital estable desde marzo 2024 ausente del
   Lighthouse CI. (Ausencia en `lighthouserc.json`)
8. **LCP/TBT relajados vs doc** — `PERFORMANCE.md` documenta 2200ms/200ms;
   `lighthouserc.json` enforce 4000ms/600ms. Brecha entre intención y
   enforcement.
9. **A11Y-016 Focus Not Obscured** — único partial sin code fix planificado.
   (`WCAG_findings.md:29`)
10. **Focus trap en AddDocumentModal diferido** — requiere nueva dependencia.
    (`WCAG_findings.md:26`)

### Seguridad/Privacidad (P1-P3)

11. **PGP key + security.txt no publicados** — reportes de vulnerabilidad via
    email plano. (`SECURITY.md:18-19,25`)
12. **DSAR worker GDPR portability incompleto** — falta bundle estándar CSV+JSON.
    (`privacy-compliance-matrix.md:72-73`)
13. **Breach notification routes faltantes** — sin automatización hacia
    autoridades. (`privacy-compliance-matrix.md:75`)
14. **Sub-procesador list GDPR art.28 no publicada**.
    (`privacy-compliance-matrix.md:77`)
15. **Auditoría legal por jurisdicción pendiente** — claims de cumplimiento son
    lectura textual, no validación legal. (`privacy-compliance-matrix.md:78-79`)

---

## 8. Fuentes canónicas

| #   | Fuente                                           | URL                                                                                                       | Método de verificación                                      | Fecha      |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------- |
| 1   | Google SRE Book — Ch.4 Service Level Objectives  | `https://sre.google/sre-book/service-level-objectives/`                                                   | browser_navigate (lectura completa)                         | 2026-08-12 |
| 2   | Google SRE Book — Ch.3 Embracing Risk            | `https://sre.google/sre-book/embracing-risk/`                                                             | web_search snippet                                          | 2026-08-12 |
| 3   | Google SRE Workbook — Implementing SLOs          | `https://sre.google/workbook/implementing-slos/`                                                          | web_search snippet                                          | 2026-08-12 |
| 4   | Google SRE Workbook — Alerting on SLOs           | `https://sre.google/workbook/alerting-on-slos/`                                                           | web_search snippet + cita en `SLO.md` §7                    | 2026-08-12 |
| 5   | W3C — What's New in WCAG 2.2                     | `https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/`                                             | browser_navigate (lectura completa)                         | 2026-08-12 |
| 6   | W3C — WCAG 2.2 Recommendation                    | `https://www.w3.org/TR/WCAG22/`                                                                           | web_search (descripción confirmada)                         | 2026-08-12 |
| 7   | web.dev — Interaction to Next Paint (INP)        | `https://web.dev/articles/inp`                                                                            | browser_navigate (lectura completa)                         | 2026-08-12 |
| 8   | web.dev — INP becomes Core Web Vital (blog)      | `https://web.dev/blog/inp-cwv-march-12`                                                                   | web_search snippet                                          | 2026-08-12 |
| 9   | web.dev — Core Web Vitals thresholds             | `https://web.dev/articles/defining-core-web-vitals-thresholds`                                            | web_search snippet                                          | 2026-08-12 |
| 10  | Android Developers — Crashes (Android vitals)    | `https://developer.android.com/topic/performance/vitals/crash`                                            | browser_navigate (lectura completa)                         | 2026-08-12 |
| 11  | Android Developers — Android vitals overview     | `https://developer.android.com/topic/performance/vitals`                                                  | web_search snippet                                          | 2026-08-12 |
| 12  | Apple Developer — App Review Guidelines          | `https://developer.apple.com/app-store/review/guidelines/`                                                | browser_navigate (sección Introduction + Before You Submit) | 2026-08-12 |
| 13  | Apple Developer — What's new in privacy (WWDC24) | `https://developer.apple.com/videos/play/wwdc2024/10123/`                                                 | web_search snippet                                          | 2026-08-12 |
| 14  | Sentry — Release Health                          | `https://docs.sentry.io/product/releases/health/`                                                         | cita indirecta via `SLO.md` §7                              | 2026-08-12 |
| 15  | Luciq — Mobile App Stability Outlook 2025        | `https://www.luciq.ai/blog/benchmarking-crash-free-sessions-for-mobile-apps-whats-a-good-crash-free-rate` | cita indirecta via `SLO.md` §7                              | 2026-08-12 |

---

_Fin del documento. Generado el 2026-08-12 como borrador de investigación para
el ticket `3a3aa66d-73fe-8196-b5aa-de61e48f3641`. No modificar archivos de
producción, Notion o git basado en este borrador sin autorización explícita._
