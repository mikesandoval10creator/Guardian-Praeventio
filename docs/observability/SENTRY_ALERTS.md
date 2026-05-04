# Sentry Alerts — Praeventio Guard

> **Owner**: Daho Sandoval (CEO/CTO) — `dahosandoval@gmail.com` / `contacto@praeventio.net`
> **Mutual**: ACHS · **Timezone**: America/Santiago (CLT/CLST)
> **Última revisión**: 2026-05-04 (Sprint 20, 10ª ola, Bucket B)
> **Próxima revisión**: trimestral (siguiente: 2026-08-04)
> **Source of truth**: este documento. La definición YAML viva en
> [`sentry-alerts.yaml`](./sentry-alerts.yaml) refleja exactamente el set
> abajo y es el insumo para futuro codegen contra la API de Sentry.

Este documento define las reglas de alerta que ops debe **crear manualmente
en la UI de Sentry** (organización `praeventio`, ver
`memory/reference_external_systems.md`). Cada regla está atada a una señal
real emitida por código de la app — verificada `file:line` en la sección
[Anexo A — Inventario de señales](#anexo-a--inventario-de-señales).

> **No hay codegen automático todavía.** Las reglas se editan en la UI; este
> archivo es el contrato que ops sigue. Cuando la API de Sentry estabilice el
> shape para alertas (ver [docs.sentry.io/api/alerts](https://docs.sentry.io/api/alerts)),
> este doc + [`sentry-alerts.yaml`](./sentry-alerts.yaml) serán la entrada al
> codegen.

---

## 1. Qué cubre la alertería

Las alertas cubren cuatro familias de eventos:

| Familia | Ejemplos | Severidad típica |
|---|---|---|
| **Errores de aplicación** | excepciones no manejadas, fallas de Webpay, crashes del worker SLM, errores de KMS | P0–P1 |
| **Degradaciones** | spike de error rate por módulo, latencia p95 elevada, fallas de descifrado | P1–P2 |
| **Señales de seguridad** | `slm.queue.hmac_mismatch` (TM-T03 tampering), spikes anómalos de `pii.redaction` | P0–P2 |
| **Eventos críticos de negocio** | `WebpayAdapterError` repetido, `commitTransaction` failures, ErrorBoundary fatal en producción | P0–P1 |

Las alertas **NO** cubren métricas de plataforma (uptime checks, CPU,
memoria de Cloud Run). Esas viven en Cloud Monitoring; ver
[`docs/runbooks/INCIDENT_RESPONSE.md` §2](../runbooks/INCIDENT_RESPONSE.md#2-on-call-rotation).

---

## 2. Severity ladder

Alineada 1:1 con [`INCIDENT_RESPONSE.md` §1](../runbooks/INCIDENT_RESPONSE.md#1-severity-levels-y-slas).

| Severidad | Política de notificación | Time to acknowledge | Canal primario |
|---|---|---|---|
| **P0** | Page inmediato | 15 min CLT diurno / 60 min nocturno | PagerDuty (cuando esté contratado) o Slack `#praeventio-ops` con `@here` |
| **P1** | Notificación dentro de 1h | 30 min business hours | Slack `#praeventio-ops` |
| **P2** | Review siguiente día hábil | 2h business hours | Slack `#praeventio-ops` (sin `@here`) |
| **P3** | Ticket only | 1 día business hours | Email a `dahosandoval@gmail.com` o issue de GitHub |

**P0 ejemplos** (page immediately):
- `slm.queue.hmac_mismatch` en producción — señal de tampering activo del IndexedDB offline queue (TM-T03 mitigation, ver [`docs/security/STRIDE_findings.md` TM-T03](../security/STRIDE_findings.md)).
- > 5 `WebpayAdapterError` en 5 min — pasarela de pagos cayendo, tocan dinero de usuarios.
- Errores de KMS (`oauth-tokens-kek` o cualquier cryptoKey) — ver [`KMS_ROTATION.md` §3 — Emergency rotation](../runbooks/KMS_ROTATION.md).
- Sentry `level:fatal` en producción (ErrorBoundary, init failures).

**P1 ejemplos**:
- Error rate de cualquier módulo (`module:gemini`/`webpay`/`prediction`/`zettelkasten`) > 5x el baseline en una ventana de 15 min.
- `slm.queue.unsigned_legacy` count > 0 en una ventana de 1h — esperamos cero después de Sprint 22 (ver TM-T03 follow-up).
- Vertex AI quota / budget alerts (cuando se conecten a Sentry desde GCP).

**P2 ejemplos**:
- Spike anómalo de `pii.redaction` — sugiere que apareció una nueva fuente upstream de PII.
- Replays con missing translation keys — el usuario ve `i18nextify` strings sin traducir.
- Lighthouse perf regressions (cuando se conecten al pipeline).

**P3 ejemplos**:
- Skipped tests increase.
- Breadcrumbs `category:cookie` en flows nuevos (deprecated API usage).

---

## 3. Reglas de alerta

> **Convención de IDs**: `<Severidad>-<dominio>-<descripcion-corta>`.
> Ejemplos: `P0-slm-hmac-mismatch`, `P1-webpay-create-failure`.
> Cada `id` aquí debe coincidir EXACTAMENTE con la entrada
> correspondiente en [`sentry-alerts.yaml`](./sentry-alerts.yaml).

> **Sintaxis de query**: la columna **Query** usa la
> [Sentry Search syntax](https://docs.sentry.io/concepts/search/) para
> alertas tipo *Issue Alert* y *Metric Alert*. Las queries que usan
> `breadcrumb.*` requieren *Discover* (ver [Discover Queries](https://docs.sentry.io/product/explore/discover-queries/)).

### 3.1 Alertas P0 (page immediately)

#### P0-slm-hmac-mismatch

| Campo | Valor |
|---|---|
| **Nombre** | SLM offline queue HMAC mismatch (tamper) |
| **Query** | `message:"slm.queue.hmac_mismatch" environment:production` |
| **Threshold** | count ≥ 1 en 1 min |
| **Severidad** | P0 |
| **Channels** | PagerDuty + Slack `#praeventio-ops` `@here` |
| **Runbook** | [`INCIDENT_RESPONSE.md` §5.1 Security](../runbooks/INCIDENT_RESPONSE.md#51-security) → STRIDE TM-T03 |
| **Owner** | security |
| **Justificación** | Único evento que indica tampering activo del IndexedDB del usuario. Es eslabón de la mitigación TM-T03 (ver `STRIDE_findings.md`); cualquier hit en producción es señal grave. |

Origen del evento: `src/services/slm/reconciliation.ts:163`
(`Sentry.captureMessage('slm.queue.hmac_mismatch', { level: 'warning', ... })`).

#### P0-webpay-error-spike

| Campo | Valor |
|---|---|
| **Nombre** | Webpay transaction errors spike |
| **Query** | `module:webpay level:error environment:production` |
| **Threshold** | count > 5 en 5 min |
| **Severidad** | P0 |
| **Channels** | PagerDuty + Slack `#praeventio-ops` `@here` |
| **Runbook** | [`INCIDENT_RESPONSE.md` §5.4 Billing](../runbooks/INCIDENT_RESPONSE.md#54-billing-especial-webpay-return-endpoint-failures) |
| **Owner** | dev |
| **Justificación** | `WebpayAdapter.{create,commit,refund}Transaction` lanzan dentro de `withSentryScope('webpay', …)`. Spike sostenido = pasarela de pagos rota. Toca dinero. |

Origen del evento: `src/services/billing/webpayAdapter.ts:276-326`
(módulo etiquetado por `withSentryScope` en `sentryInstrumentation.ts:84`).

#### P0-kms-error

| Campo | Valor |
|---|---|
| **Nombre** | KMS error (descifrado/rotación) |
| **Query** | `(message:*kms* OR message:*KeyManagementService* OR message:*cryptoKey*) level:[error,fatal] environment:production` |
| **Threshold** | count ≥ 1 en 5 min |
| **Severidad** | P0 |
| **Channels** | PagerDuty + Slack `#praeventio-ops` `@here` |
| **Runbook** | [`KMS_ROTATION.md` §3 Emergency rotation](../runbooks/KMS_ROTATION.md) |
| **Owner** | security |
| **Justificación** | Falla de descifrado en `kmsAdapter` puede indicar key compromise o version disabled mid-rotation. Ver DR_RUNBOOK §1 KMS key compromise. |

#### P0-fatal-prod

| Campo | Valor |
|---|---|
| **Nombre** | Fatal-level error en producción |
| **Query** | `level:fatal environment:production` |
| **Threshold** | count ≥ 1 en 1 min |
| **Severidad** | P0 |
| **Channels** | PagerDuty + Slack `#praeventio-ops` `@here` |
| **Runbook** | [`INCIDENT_RESPONSE.md` §5.2 Performance/availability](../runbooks/INCIDENT_RESPONSE.md#52-performance--availability) |
| **Owner** | dev |
| **Justificación** | `ErrorBoundary` en `src/components/shared/ErrorBoundary.tsx:64` y `captureEmergencyError` (`src/lib/sentry.ts:129` con `domain:safety_critical`) marcan eventos fatales. Cualquier hit en prod debe paginar. |

### 3.2 Alertas P1 (notificación dentro de 1h)

#### P1-gemini-error-rate

| Campo | Valor |
|---|---|
| **Nombre** | Gemini module error rate spike |
| **Query** | `module:gemini level:error environment:production` |
| **Threshold** | error count > 5x baseline (rolling 7d) en 15 min |
| **Severidad** | P1 |
| **Channels** | Slack `#praeventio-ops` |
| **Runbook** | [`INCIDENT_RESPONSE.md` §5.5 SLM offline](../runbooks/INCIDENT_RESPONSE.md#55-slm-offline-especial-web-worker-crashes) (fallback path) |
| **Owner** | AI bucket |
| **Justificación** | `withSentryScope('gemini', …)` en `geminiBackend.ts:187,228,293`. Spike = Vertex AI degradado o quota cerca del cap (TM-D01). |

#### P1-prediction-error-rate

| Campo | Valor |
|---|---|
| **Nombre** | Prediction module error rate spike |
| **Query** | `module:prediction level:error environment:production` |
| **Threshold** | error count > 5x baseline (rolling 7d) en 15 min |
| **Severidad** | P1 |
| **Channels** | Slack `#praeventio-ops` |
| **Runbook** | [`INCIDENT_RESPONSE.md` §5.2](../runbooks/INCIDENT_RESPONSE.md#52-performance--availability) |
| **Owner** | dev |
| **Justificación** | `withSentryScope('prediction', …)` en `predictionBackend.ts:11,78`. Pipeline de detección predictiva (Fase 1 del Flow Infinito). |

#### P1-zettelkasten-error-rate

| Campo | Valor |
|---|---|
| **Nombre** | Zettelkasten write/reconcile errors |
| **Query** | `module:zettelkasten level:error environment:production` |
| **Threshold** | error count > 5x baseline (rolling 7d) en 15 min |
| **Severidad** | P1 |
| **Channels** | Slack `#praeventio-ops` |
| **Runbook** | [`DR_RUNBOOK.md` §5.3 Data corruption](../runbooks/DR_RUNBOOK.md) |
| **Owner** | dev |
| **Justificación** | `withSentryScope('zettelkasten', …)` en `reconciliation.ts:137` y `writeNode.ts:107`. Errors aquí = consolidación de conocimiento (Fase 3) bloqueada. |

#### P1-slm-unsigned-legacy

| Campo | Valor |
|---|---|
| **Nombre** | SLM legacy queue entries detected (TM-T03 follow-up) |
| **Query** | `breadcrumb.category:"slm.queue.unsigned_legacy" environment:production` |
| **Threshold** | count > 0 en 1h |
| **Severidad** | P1 |
| **Channels** | Slack `#praeventio-ops` |
| **Runbook** | [`STRIDE_findings.md` TM-T03](../security/STRIDE_findings.md) |
| **Owner** | security |
| **Justificación** | Esperamos cero hits después de drenado de colas pre-Sprint-20-9th-wave. Cualquier presencia significa que un device tiene una cola legacy sin migrar — investigar antes del flip de Sprint 22 (`reconciliation.ts:184` TODO). |

#### P1-webpay-create-failure

| Campo | Valor |
|---|---|
| **Nombre** | Webpay createTransaction failure |
| **Query** | `module:webpay error.type:WebpayAdapterError environment:production` |
| **Threshold** | count > 3 en 10 min |
| **Severidad** | P1 |
| **Channels** | Slack `#praeventio-ops` |
| **Runbook** | [`INCIDENT_RESPONSE.md` §5.4 Billing](../runbooks/INCIDENT_RESPONSE.md#54-billing-especial-webpay-return-endpoint-failures) |
| **Owner** | dev |
| **Justificación** | Subset menos severo del P0-webpay-error-spike — alerta a sostenidos < 5 hits/5min para detectar degradación parcial antes de que escale. |

### 3.3 Alertas P2 (review next business day)

#### P2-pii-redaction-spike

| Campo | Valor |
|---|---|
| **Nombre** | PII redaction count anomaly |
| **Query** | `breadcrumb.category:"pii.redaction" environment:production` |
| **Threshold** | sum(`breadcrumb.data.count`) > 3x baseline (rolling 7d) en 1h |
| **Severidad** | P2 |
| **Channels** | Slack `#praeventio-ops` (sin `@here`) |
| **Runbook** | [`THREAT_MODEL.md` TM-I03](../security/THREAT_MODEL.md) |
| **Owner** | sec/AI bucket |
| **Justificación** | `geminiBackend.ts:34-39` emite breadcrumb con `count` y `categories`. Spike sugiere nueva fuente upstream de PII (UI nueva, copy/paste mass) y vale revisar si la regex cubre los nuevos shapes. NO bloquear — defense-in-depth, no security boundary. |

#### P2-hmac-verify-error

| Campo | Valor |
|---|---|
| **Nombre** | SLM HMAC verify environment fault |
| **Query** | `breadcrumb.category:"slm.queue.hmac_verify_error" environment:production` |
| **Threshold** | count > 10 en 1h |
| **Severidad** | P2 |
| **Channels** | Slack `#praeventio-ops` |
| **Runbook** | [`STRIDE_findings.md` TM-T03](../security/STRIDE_findings.md) |
| **Owner** | dev |
| **Justificación** | `hmac.ts:282-287` emite este breadcrumb cuando `crypto.subtle` falla durante verify. Volumen alto = browser/device class problemático. NO P0 — verifyPayload trata el fault como drop signal, no crash. |

#### P2-analytics-queue-overflow

| Campo | Valor |
|---|---|
| **Nombre** | Analytics queue overflow warnings |
| **Query** | `breadcrumb.category:"analytics.queue" level:warning environment:production` |
| **Threshold** | count > 50 en 1h |
| **Severidad** | P2 |
| **Channels** | Slack `#praeventio-ops` |
| **Runbook** | (no aún — abrir issue de tracking) |
| **Owner** | tracking |
| **Justificación** | `analytics/queue.ts:91-96` emite warnings cuando se descarta el oldest event al saturar. Volumen alto = el sink real (Sprint 21+) atrasa flush, perdemos eventos no-`safety_critical`. |

### 3.4 Alertas P3 (ticket only)

#### P3-organic-process-anomaly

| Campo | Valor |
|---|---|
| **Nombre** | Organic process state transition anomaly |
| **Query** | `breadcrumb.category:"organic.process" environment:production` |
| **Threshold** | count > 1000 en 24h (uso anómalo, no error) |
| **Severidad** | P3 |
| **Channels** | Email `dahosandoval@gmail.com` |
| **Runbook** | (no aún — backlog tracking) |
| **Owner** | product |
| **Justificación** | `src/server/routes/organic.ts:242-247` emite breadcrumb por cada transición Proyecto→Cuadrilla→Procesos→Tareas. Volumen muy alto puede indicar abuse o bug de UI con re-emisión. Solo ticket. |

#### P3-deprecated-cookie-breadcrumb

| Campo | Valor |
|---|---|
| **Nombre** | Deprecated cookie breadcrumb usage |
| **Query** | `breadcrumb.category:"cookie" level:error environment:production` |
| **Threshold** | count > 0 en 7d |
| **Severidad** | P3 |
| **Channels** | Email `dahosandoval@gmail.com` |
| **Runbook** | (no aún — backlog) |
| **Owner** | dev |
| **Justificación** | Cookie API deprecation tracking. Conviene saber si algún flujo nuevo aún la usa antes de tightening de CSP (TM-I05). |

---

## 4. Suppression / dedup policy

- **Snooze**: tras la primera alerta, suprimir alertas idénticas (misma `event signature`, definida por Sentry como combinación de `fingerprint` + `tags.module` + `tags.environment`) durante **1 hora**. Esto evita pager-storm cuando un mismo bug genera 1000 hits/min.
- **Acknowledgement**: una alerta P0 ack-eada en Sentry pausa la repetición durante 4h salvo que cambie la `event signature`.
- **Auto-resolve**: si una alerta P1/P2 no recibe nuevos hits en 24h, marcarla como resuelta automáticamente (Sentry "auto-resolve" feature).
- **Bursts**: si 3 alertas distintas (cualquier severidad) dispararan en < 60s, abrir war room (ver INCIDENT_RESPONSE §4) — hipótesis: incidente correlacionado.

---

## 5. Channel routing

| Severidad | Routing | Canal de fallback |
|---|---|---|
| **P0** | PagerDuty (cuando esté contratado, ETA Sprint 22) → si no, Slack `#praeventio-ops` con `@here` + email a `dahosandoval@gmail.com` + Telegram bot personal | SMS via UptimeRobot externo (planificado) |
| **P1** | Slack `#praeventio-ops` (sin `@here`) + email a `dahosandoval@gmail.com` | Sentry inbox (default) |
| **P2** | Slack `#praeventio-ops` (sin `@here`) | Sentry weekly digest |
| **P3** | Email semanal de digest a `dahosandoval@gmail.com` | GitHub issue manual |

> **Slack workspace**: aún a crear (ver INCIDENT_RESPONSE §3, "A crear cuando exista workspace de Slack"). Mientras tanto, P0/P1 caen a email + Telegram bot personal.

---

## 6. Maintenance

- **Review trimestral**: revisar el set completo el primer lunes de cada trimestre. Eliminar alertas que no dispararon en > 90 días Y cuyo dominio sigue sin issues abiertos. Ajustar thresholds basados en volumen real.
- **Post-incident**: tras cada P0/P1, evaluar si la alerta disparó en tiempo correcto. Si **no** disparó cuando debió (gap), agregar nueva regla. Si disparó **demasiado tarde**, bajar threshold. Documentar en post-mortem (`INCIDENT_RESPONSE.md` §4.3 → "Contributing factors → alerta no llegó").
- **Onboarding de nuevos signals**: cuando una nueva ola añade Sentry breadcrumbs/messages, este doc debe actualizarse en la misma ola, NO después. La discusión va en el plan de la ola, la implementación en el commit final.

---

## 7. Supported environments

Las queries arriba usan `environment:production` para reducir ruido de
staging/CI. Sentry recibe eventos de los siguientes entornos
(definidos por `VITE_APP_ENV` y `VITE_SENTRY_DSN`):

- `production` — Cloud Run (alertas activas).
- `staging` — Cloud Run staging (mismo set de reglas, severidad rebajada un nivel; no implementado todavía).
- `development` — local + tests (sin DSN; ver `src/lib/sentry.ts:91-94`).

---

## Anexo A — Inventario de señales

> **Cada query referencia este inventario**. No se debe agregar una alerta
> nueva sin antes verificar `file:line` que la señal existe en el código.

| Signal | File:line | Tipo |
|---|---|---|
| `tag module=gemini\|webpay\|prediction\|zettelkasten` | `src/services/observability/sentryInstrumentation.ts:42-46, 84` | tag (4-value enum) |
| `tag domain=safety_critical` | `src/lib/sentry.ts:129` | tag (boolean-like) |
| `message:"slm.queue.hmac_mismatch"` | `src/services/slm/reconciliation.ts:163-166` | captureMessage (warning) |
| `breadcrumb.category:"slm.queue.unsigned_legacy"` | `src/services/slm/reconciliation.ts:188-194` | breadcrumb (info) |
| `breadcrumb.category:"slm.queue.hmac_verify_error"` | `src/services/slm/hmac.ts:282-287` | breadcrumb (warning) |
| `breadcrumb.category:"pii.redaction"` | `src/services/geminiBackend.ts:34-39` | breadcrumb (info) |
| `breadcrumb.category:"analytics"` / `analytics.queue` / `analytics.adapter` | `src/services/analytics/{sinks,queue,adapter}.ts` | breadcrumb |
| `breadcrumb.category:"organic.process"` | `src/server/routes/organic.ts:242-247` | breadcrumb (info) |
| `error.type:WebpayAdapterError` | `src/services/billing/webpayAdapter.ts:276-326` | exception (en scope `module=webpay`) |
| `level:fatal` (ErrorBoundary) | `src/components/shared/ErrorBoundary.tsx:64` | captureEmergencyError |

---

## Anexo B — Cómo crear las reglas en la UI de Sentry

> Sin codegen: ops aplica el contrato manualmente.

1. Sentry org `praeventio` → project (frontend o backend según corresponda).
2. **Alerts** → **Create Alert** → tipo según query:
   - `level:`, `message:`, `error.type:`, `tag:` → **Issue Alert**.
   - `breadcrumb.category:` requiere consultas en **Discover** y luego **Metric Alert** sobre el resultado.
3. Pegar la query exactamente como aparece en §3.
4. Threshold y window según la fila correspondiente.
5. Action → Slack `#praeventio-ops` (cuando el workspace esté creado) o email `dahosandoval@gmail.com` mientras tanto. Para P0, marcar como "high priority" y, cuando exista, integrar con PagerDuty (ETA Sprint 22).
6. Guardar con el `id` exacto del YAML como **título de la regla** para tracking 1:1.

---

## Anexo C — Cross-references

- [`sentry-alerts.yaml`](./sentry-alerts.yaml) — mirror máquina-legible.
- [`SENTRY_DASHBOARDS.md`](./SENTRY_DASHBOARDS.md) — dashboards complementarios.
- [`INDEX.md`](./INDEX.md) — índice de toda la observability.
- [`../runbooks/INCIDENT_RESPONSE.md`](../runbooks/INCIDENT_RESPONSE.md) — SLAs por severidad.
- [`../runbooks/DR_RUNBOOK.md`](../runbooks/DR_RUNBOOK.md) — disaster recovery.
- [`../runbooks/KMS_ROTATION.md`](../runbooks/KMS_ROTATION.md) — KMS rotation procedure.
- [`../security/STRIDE_findings.md`](../security/STRIDE_findings.md) — TM-T03 hmac_mismatch driver.
- [`../security/THREAT_MODEL.md`](../security/THREAT_MODEL.md) — TM-I03 PII redaction driver.

---

## Changelog

- **2026-05-04** — Versión inicial. Sprint 20, 10ª ola, Bucket B. 14 reglas:
  4 P0, 5 P1, 3 P2, 2 P3. Cada query verificada contra el inventario de
  señales reales en el código. Pendiente: contratar PagerDuty (Sprint 22) y
  crear workspace de Slack para reemplazar el fallback email-only.
