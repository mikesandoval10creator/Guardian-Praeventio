# Sentry Dashboards — Praeventio Guard

> **Owner**: Daho Sandoval (CEO/CTO) — `dahosandoval@gmail.com`
> **Última revisión**: 2026-05-04 (Sprint 20, 10ª ola, Bucket B)
> **Próxima revisión**: trimestral
> **Source of truth**: este documento. La definición JSON viva en
> [`dashboard-praeventio-overview.json`](./dashboard-praeventio-overview.json)
> es un esqueleto editable como punto de partida para ops.

Este documento define los **3 dashboards** que ops debe crear en la UI de
Sentry (organización `praeventio`). Cada widget está atado a una **señal
real** del código de la app — verificable contra el inventario en
[`SENTRY_ALERTS.md` Anexo A](./SENTRY_ALERTS.md#anexo-a--inventario-de-señales).

> **No hay codegen automático.** Cada dashboard se crea manualmente vía
> Sentry UI; este doc es el contrato. Cuando la API de Sentry estabilice
> el shape para dashboards
> ([Discover API docs](https://docs.sentry.io/api/discover/)), este doc
> + `dashboard-praeventio-overview.json` serán la entrada al codegen.

---

## 1. Catálogo de dashboards

| Dashboard | Audiencia | Ownership | Cadencia de review |
|---|---|---|---|
| **Overview** | Ops + Daho | dev | Diaria (cuando hay incidente activo) / semanal |
| **SLM Health** | AI bucket + security | AI bucket | Semanal |
| **Business Critical** | Daho + finance (cuando exista) | dev | Diaria — toca dinero |

---

## 2. Dashboard 1 — Overview

**Propósito**: vista de salud del sistema en una sola pantalla. Es el
dashboard que se proyecta durante un war room (ver
[`INCIDENT_RESPONSE.md` §4](../runbooks/INCIDENT_RESPONSE.md#4-war-room-template)).

**Archivo referencia**: [`dashboard-praeventio-overview.json`](./dashboard-praeventio-overview.json).

### 2.1 Widgets

#### W1.1 — Error rate por módulo (timeseries)

- **Tipo**: timeseries (line, 4 series).
- **Query**: agrupar `count(events)` por `tags.module` filtrando `level:error environment:production`.
- **Series**: `gemini`, `webpay`, `prediction`, `zettelkasten`.
- **Window**: rolling 24h, paso 5min.
- **Justificación**: las únicas 4 etiquetas posibles para `module` son fijas (`sentryInstrumentation.ts:42-46`), por lo que la cardinality es bounded y el gráfico es legible.

#### W1.2 — Top issues this week (table)

- **Tipo**: table top-N.
- **Query**: `events()` filtrado a `environment:production` últimos 7d, ordenado por `count() desc` agrupado por `issue.title`.
- **Limit**: 10 filas.
- **Justificación**: triage rápido. Inkube directo en un click hacia la página del issue.

#### W1.3 — p95 latency por route (timeseries)

- **Tipo**: timeseries (line, 1 serie por top-5 routes).
- **Query**: `transaction.duration p95` agrupado por `transaction` (route name) filtrando a transactions de servidor (`http.server`). Limitar a top-5 por volumen.
- **Window**: rolling 24h.
- **Justificación**: cualquier route que sostiene > 5x p95 baseline durante > 30 min activa P1 (ver `INCIDENT_RESPONSE.md` §1, "performance p95 > 5x baseline sostenido"). Este widget es el primer place a mirar.

#### W1.4 — Lighthouse scores trend (big-number)

- **Tipo**: big-number (4 tiles: Performance, Accessibility, Best Practices, SEO).
- **Query**: `measurements.lh_*` (cuando se conecte el pipeline de Lighthouse a Sentry; pendiente Sprint 21+).
- **Window**: rolling 7d, valor más reciente.
- **Justificación**: regresión de perf (W1.4) precede degradación percibida por el usuario.
- **Estado**: PLACEHOLDER — depende de Brecha D (E2E + Lighthouse pipeline). Si no existe data, mostrar "Pendiente Sprint 21+".

#### W1.5 — Fatal events (big-number)

- **Tipo**: big-number.
- **Query**: `count() level:fatal environment:production` últimos 24h.
- **Threshold visual**: rojo si > 0, gris si = 0.
- **Justificación**: refleja la alerta `P0-fatal-prod`. Cualquier número distinto de 0 abre war room.

---

## 3. Dashboard 2 — SLM Health

**Propósito**: salud del Small Language Model offline + reconciliación con
Zettelkasten. Owner: AI bucket. Driver legal: TM-T03 mitigation (HMAC).

### 3.1 Widgets

#### W2.1 — `slm.queue.hmac_mismatch` counter (big-number)

- **Tipo**: big-number.
- **Query**: `count() message:"slm.queue.hmac_mismatch" environment:production` últimos 7d.
- **Threshold visual**: rojo si > 0, gris si = 0.
- **Source**: `src/services/slm/reconciliation.ts:163`.
- **Justificación**: este número DEBE ser cero. Cualquier hit es señal P0 ya cubierta por la alerta.

#### W2.2 — `slm.queue.unsigned_legacy` counter (timeseries decreciente)

- **Tipo**: timeseries (1 serie).
- **Query**: `count() breadcrumb.category:"slm.queue.unsigned_legacy" environment:production` agrupado por día.
- **Window**: rolling 30d.
- **Source**: `src/services/slm/reconciliation.ts:188-194`.
- **Justificación**: tracking de drenado de colas legacy hacia cero antes del flip de Sprint 22. Visual inverso = backsliding.

#### W2.3 — `slm.queue.hmac_verify_error` count (timeseries)

- **Tipo**: timeseries (1 serie).
- **Query**: `count() breadcrumb.category:"slm.queue.hmac_verify_error" environment:production`.
- **Window**: rolling 24h.
- **Source**: `src/services/slm/hmac.ts:282-287`.
- **Justificación**: alto volumen sostenido = clase de browser/device problemática. Driver de la alerta P2.

#### W2.4 — Reconciliation pass success rate (big-number)

- **Tipo**: big-number con tendencia (sparkline).
- **Query**: `succeeded / attempted * 100` (proxy via custom event si se decide instrumentar; ver TODO abajo).
- **Window**: rolling 24h.
- **Source**: `reconciliation.ts:148-153` (objeto `ReconciliationResult`).
- **Estado**: PLACEHOLDER — requiere agregar un breadcrumb `reconcile.summary` con `attempted`/`succeeded`/`failed` para que sea visualizable. TODO Sprint 21.

#### W2.5 — `module:zettelkasten` errors (timeseries)

- **Tipo**: timeseries.
- **Query**: `count() module:zettelkasten level:error environment:production`.
- **Window**: rolling 24h, paso 15min.
- **Source**: `src/services/zettelkasten/persistence/writeNode.ts:107` y `reconciliation.ts:137`.
- **Justificación**: errors aquí indican write path roto (Firestore down, idempotency colisión). Driver de la alerta P1.

#### W2.6 — `pii.redaction` count + categories (table)

- **Tipo**: table.
- **Query**: agrupar por `breadcrumb.data.action` y sumar `breadcrumb.data.count` para `breadcrumb.category:"pii.redaction"`.
- **Window**: rolling 7d.
- **Source**: `src/services/geminiBackend.ts:34-39`.
- **Justificación**: visibility de qué endpoints están redactando más PII. Driver del P2-pii-redaction-spike.

> **Nota**: la métrica "online vs offline ratio" del SLM (especificada en
> el brief original via `slm.query.online`/`slm.query.offline`
> breadcrumbs) **NO está implementada todavía**. Cuando se agreguen esos
> breadcrumbs en el orchestrator del SLM, agregar widget W2.7. Por ahora
> se omite para no documentar señales inexistentes.

---

## 4. Dashboard 3 — Business Critical

**Propósito**: visibilidad de los flujos que tocan dinero o seguridad
operacional crítica. Driver legal: Ley 16.744 (servicio prevencional) +
Ley 21.719 (datos personales).

### 4.1 Widgets

#### W3.1 — Webpay transactions success/fail (timeseries stacked)

- **Tipo**: timeseries stacked (2 series: success, fail).
- **Query success**: `count() module:webpay !error.type:WebpayAdapterError environment:production`.
- **Query fail**: `count() module:webpay error.type:WebpayAdapterError environment:production`.
- **Window**: rolling 24h.
- **Source**: `src/services/billing/webpayAdapter.ts:276-326`.
- **Justificación**: fail/total > 5% sostenido es una P1; alerta P0-webpay-error-spike pesca el spike absoluto.

#### W3.2 — Webpay errors por acción (table)

- **Tipo**: table.
- **Query**: agrupar por `tags.action` (set por el `withSentryScope` context) para eventos `module:webpay level:error`.
- **Window**: rolling 7d.
- **Source**: `webpayAdapter.ts:278,300,315` (`action: 'createTransaction'|'commitTransaction'|'refundTransaction'`).
- **Justificación**: separa qué fase del flow rompe. `commitTransaction` errors > 0 = riesgo de double-charge sin idempotency lock.

#### W3.3 — `billing.webpay-return.authorized` audit count (big-number con sparkline)

- **Tipo**: big-number + sparkline.
- **Query**: requiere instrumentar audit-log → Sentry breadcrumb (no implementado todavía; los audit rows actualmente solo van a Firestore, ver `src/server/routes/billing.ts:1080` y `src/server/middleware/auditLog.ts:71-81`).
- **Window**: rolling 24h.
- **Estado**: PLACEHOLDER — TODO Sprint 21 agregar un breadcrumb `billing.webpay.authorized` con monto + invoiceId (sin `createdBy` para no exponer PII en breadcrumbs).
- **Justificación**: visibility de funnel de pago exitoso end-to-end.

#### W3.4 — Emergency events count + response time (table)

- **Tipo**: table.
- **Query**: `count() tags.domain:safety_critical environment:production` agrupado por `tags.trigger` (set por `captureEmergencyError({ trigger, projectId })`, ver `src/contexts/EmergencyContext.tsx:42`).
- **Window**: rolling 30d.
- **Columnas adicionales**: tiempo medio entre primer evento del trigger y el siguiente (proxy de "response time").
- **Source**: `src/lib/sentry.ts:127-133` y `src/contexts/EmergencyContext.tsx:42`.
- **Justificación**: cualquier `domain:safety_critical` event es de alta prioridad — tracking de la 2ª fase del Flow Infinito (Respuesta Adaptativa).

#### W3.5 — Top errors of the week (Business Critical filtered) (table)

- **Tipo**: table top-N.
- **Query**: `events()` filtrado a `(module:webpay OR domain:safety_critical) environment:production`, top-10 por count.
- **Window**: rolling 7d.
- **Justificación**: lo que toca dinero o seguridad operacional sube primero.

---

## 5. Cómo crear los dashboards en la UI de Sentry

> Manual mientras no haya codegen.

1. Sentry org `praeventio` → **Dashboards** → **Create Dashboard**.
2. Nombre exacto: `Overview`, `SLM Health`, o `Business Critical`.
3. Para cada widget de §2/§3/§4:
   - Add widget → tipo correspondiente.
   - Query: pegar exactamente la query indicada.
   - Limit/window según la fila.
   - Display name del widget = el ID `W#.#` para tracking 1:1.
4. Asignar ownership (en la UI: "Owners" del dashboard).
5. Guardar.
6. Para `Overview`, importar como punto de partida
   [`dashboard-praeventio-overview.json`](./dashboard-praeventio-overview.json)
   vía Sentry CLI o copy-paste si la API ya soporta dashboard import (consultar
   [Sentry Discover API](https://docs.sentry.io/api/discover/)).

> **Caveat sobre el JSON**: el shape exacto del export de dashboards de
> Sentry está sujeto a cambios. El archivo JSON aquí es un esqueleto
> **placeholder con `_comment` fields** que documenta intent. Ops debe
> editarlo para que matche el shape actual antes de import. La fuente de
> verdad de la lógica son las queries de §2.

---

## 6. Maintenance

- **Trimestral**: review del set completo. Eliminar widgets que no se han mirado en > 90 días. Ajustar windows según volumen real (ej: si hay > 1000 errores/día, paso de 1min en lugar de 5min).
- **Post-incident**: si durante el war room un widget faltó (no nos dejó ver lo que necesitábamos), agregarlo. Si un widget engañó (mostró verde cuando había problema), corregir la query.
- **Onboarding de nuevos signals**: si una nueva ola añade categories de breadcrumb o tags, este doc se actualiza en la misma ola.

---

## 7. Cross-references

- [`SENTRY_ALERTS.md`](./SENTRY_ALERTS.md) — alertas que disparan; estos dashboards son la vista cuando ya estás dentro del incidente.
- [`dashboard-praeventio-overview.json`](./dashboard-praeventio-overview.json) — JSON skeleton del dashboard Overview.
- [`INDEX.md`](./INDEX.md) — índice general.
- [`../runbooks/INCIDENT_RESPONSE.md`](../runbooks/INCIDENT_RESPONSE.md) — war room.
- [`../security/STRIDE_findings.md`](../security/STRIDE_findings.md) — TM-T03 driver de SLM Health.

---

## Changelog

- **2026-05-04** — Versión inicial. 3 dashboards (Overview, SLM Health,
  Business Critical) con 16 widgets totales: 5 + 6 + 5. 4 placeholders
  marcados como TODO Sprint 21+ donde la señal aún no se emite (Lighthouse,
  reconciliation summary breadcrumb, billing.webpay.authorized breadcrumb,
  online/offline SLM ratio).
