# SLOs y error budget — Guardian Praeventio

> **Documento formal de confiabilidad** (Ticket 3a4aa66d-73fe-81a7-9759-d8c5d965a86e).
> Fuente de investigación: `docs/research/drafts/05-observability-slo.md` (§4/§5/§6),
> que a su vez cita Google SRE Book + SRE Workbook §5 (multi-window burn-rate),
> Android vitals (umbrales Play), Sentry Release Health (definición crash-free)
> y Luciq Mobile App Stability Outlook 2025 (benchmark sector Health/Safety).
> Estado: **SLO interno** — NO es un SLA contractual (ver §6).

Guardian no es una app de consumo: cuando un trabajador aislado presiona SOS o
el detector de caídas se dispara, una falla puede costar una vida. Los SLOs de
este documento son requerimiento de seguridad ocupacional, no métricas de
marketing. Sector de referencia: Health/Fitness median **99.98%** crash-free
sessions (Luciq 2025); Guardian se posiciona en ese estándar.

---

## 1. SLIs (qué medimos)

| SLI                   | Definición                                                                  | Fuente de datos                              |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| `sos_delivery`        | Evento SOS llega a Firestore en <10s Y dispara notificación al supervisor   | Sentry trace `sos.deliver` + Firestore       |
| `checkin_p95`         | Latencia p95 desde tap "Check-in" hasta confirmación UI                     | Sentry span `checkin.sync`                   |
| `crash_free_sessions` | % de sesiones que no terminaron en crash (definición Sentry Release Health) | Sentry Release Health                        |
| `crash_free_sos_path` | % de sesiones crash-free donde el usuario tocó SOS o activó fall detection  | Sentry + breadcrumb `domain:safety_critical` |

Regla SRE aplicada: no medimos todo lo que podemos trackear — solo los SLIs
que el usuario (trabajador) percibe como confiabilidad.

---

## 2. Los 4 SLOs

### SLO 1 — SOS delivery (safety-critical)

| Campo         | Valor                                                                         |
| ------------- | ----------------------------------------------------------------------------- |
| SLI           | `sos_delivery`                                                                |
| **SLO**       | **99.95%** mensual                                                            |
| Ventana       | 28 días rodante (alineado con Android vitals y Luciq)                         |
| Justificación | Sector Health mediana 99.98%; 99.95% deja margen operativo sin ser negligente |

### SLO 2 — Crash-free sessions del path SOS (ultra-crítico)

| Campo         | Valor                                                         |
| ------------- | ------------------------------------------------------------- |
| SLI           | `crash_free_sos_path`                                         |
| **SLO**       | **99.99%** ("four nines")                                     |
| Ventana       | 28 días rodante                                               |
| Justificación | Un crash en el momento exacto del SOS es potencialmente fatal |

### SLO 3 — Crash-free sessions general

| Campo              | Valor                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------- |
| SLI                | `crash_free_sessions`                                                                    |
| **SLO**            | **≥ 99.9%** mensual; aspirar a 99.95% (mediana Health)                                   |
| Floor innegociable | 98.91% = 1.09% crash rate (umbral Android vitals bad behavior)                           |
| Target interno     | **≤ 0.5%** crash rate (la mitad del floor de Play — 1.09% es inaceptable para seguridad) |
| Ventana            | 28 días rodante                                                                          |
| Alerta temprana    | Page si 24h crash-free cae bajo 99.5%                                                    |

### SLO 4 — Latencia p95 del check-in de lone worker

| Campo         | Valor                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| SLI           | `checkin_p95`                                                            |
| **SLO**       | **≤ 2.000 ms** (p95) en 3G simulado; ≤ 800 ms p95 en WiFi/LTE            |
| Ventana       | 7 días rodante                                                           |
| Justificación | Para un lone worker, >2s percibido se interpreta como "no me escucharon" |

---

## 3. Error budget mensual

Para un SLO 99.95% mensual (30 días = 43.200 minutos):

- **Error budget = 0.05% × 43.200 = 21,6 minutos/mes** de indisponibilidad permitida.
- Para SOS a 99.99%: **4,32 minutos/mes**.
- Para crash-free general 99.9%: 0,1% de las sesiones pueden crashear (≈ 43 min equivalentes).

### 3.1 Política de congelación de deploys (SRE Workbook §5 / Appendix B)

| Consumo de budget             | Acción                                                 |
| ----------------------------- | ------------------------------------------------------ |
| **50% consumido en ≤ 7 días** | Congelar deploys de funcionalidad no-crítica           |
| **100% consumido**            | Solo se deployan fixes al servicio afectado            |
| Recuperación                  | El budget se renueva al cierre de la ventana (28 días) |

Esta política se revisa en cada release: si un release nuevo consume >50% del
budget del SLO 2 (SOS) en su primera semana, se congela el rollout de features.

---

## 4. Auditoría multi-window burn-rate (SRE Workbook §5, approach 6)

El patrón recomendado para alertar sobre SLOs sin ruido es el **multi-window
multi-burn-rate**: alertar cuando se consume una fracción grande del budget en
ventanas cortas (1h) O medias (6h), no solo umbrales absolutos.

### 4.1 Estado actual de sentry-alerts.yaml (auditoría 2026-08-10)

Todas las alertas existentes en `docs/observability/sentry-alerts.yaml` usan
umbrales simples (count + window) — **ninguna** usaba multi-burn-rate antes de
este ticket. Se agregó la primera:

| Alerta                 | Severidad | Ventanas | Trigger                                            |
| ---------------------- | --------- | -------- | -------------------------------------------------- |
| `P0-sos-delivery-burn` | P0        | 1h + 6h  | 2% del error budget de SLO 1 en 1h **OR** 5% en 6h |

### 4.2 Alertas SLO recomendadas (siguiente fase)

| Prioridad | Trigger                                  | Ventanas      | Canal         |
| --------- | ---------------------------------------- | ------------- | ------------- |
| P0        | SOS delivery rate cae bajo 99.5% en 1h   | 1h + 6h       | Page          |
| P0        | Crash-free path-SOS cae bajo 99.9% en 1h | 1h + 6h       | Page          |
| P1        | Crash-free general cae bajo 99.5% en 24h | 1h + 6h + 24h | Slack + email |
| P1        | Latencia p95 check-in > 3.000 ms por 1h  | 1h + 6h       | Slack + email |
| P2        | Android vitals emerging issue (7+ días)  | 24h           | Email         |

---

## 5. Instrumentación mínima (gap analysis resumido)

1. `src/lib/sentry.ts` — confirmar `Sentry.init` con `release` (commit SHA),
   `environment` y `autoSessionTracking: true` (Release Health requiere esto).
2. Span `sos.deliver` con tags `domain:safety_critical`, `module:sos`.
3. Span `checkin.sync` con `network_type` (wifi/lte/3g) y `offline_queued`.
4. `captureEmergencyError` invocado en TODOS los paths de fall-detection/SOS.
5. `redactPii` antes del transport (GPS, RUT, clínicos — Ley 19.628 Chile).
6. Error budget dashboard en `SENTRY_DASHBOARDS.md` (consumo % por SLO).
7. Sampling: paths safety-critical a 100%; resto 10-20%.

Ver checklist completo (15 ítems) en `docs/research/drafts/05-observability-slo.md` §6.

---

## 6. Límites

- **NO es un SLA contractual**: el SRE Book advierte que un SLA sin SLO bien
  medido es receta para desastre. Guardian debe cumplir 6 meses de SLO interno
  antes de comprometer un SLA con consecuencia financiera.
- Los valores son objetivos internos; la telemetría actual (Sentry Release
  Health + Crashlytics + vitals) es la fuente, no aspiraciones.

---

## 7. Fuentes

| Fuente                                     | URL                                                                                                     | Uso                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Google SRE Book — Service Level Objectives | https://sre.google/sre-book/service-level-objectives/                                                   | Vocabulario SLI/SLO                 |
| Google SRE Workbook — Alerting on SLOs     | https://sre.google/workbook/alerting-on-slos/                                                           | Multi-window burn-rate (approach 6) |
| Android vitals                             | https://developer.android.com/topic/performance/vitals                                                  | Floor 1.09% crash rate              |
| Sentry Release Health                      | https://docs.sentry.io/product/releases/health/                                                         | Definición crash-free sessions      |
| Luciq Mobile App Stability Outlook 2025    | https://www.luciq.ai/blog/benchmarking-crash-free-sessions-for-mobile-apps-whats-a-good-crash-free-rate | Benchmark 99.98% Health             |

Verificación completa de cada fuente en `docs/research/drafts/05-observability-slo.md` §7.
