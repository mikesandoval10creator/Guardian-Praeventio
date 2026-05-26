# Services / triggers / jobs — triage 2026-05-26

Triage exhaustivo de los hallazgos del auditor automatizado del 2026-05-26
(plan v2, Bloque M). Convención: cada item tiene **decisión + razón documentada**
y referencia `file:line`. Nada se borra sin investigación.

## Funciones exportadas sin caller (1)

### `resolveObservation`
- **File:** `src/services/vendorOnboarding/vendorAccreditationTracker.ts:147`
- **Hallazgo:** función exportada sin importadores en `src/`.
- **Decisión:** **DEFER**.
- **Razón:** API público del calc engine — recibe una observación de
  accreditación y retorna copia con `resolvedAt/resolvedByUid/resolutionNotes`.
  Función pura, válida y útil. Falta UI consumer en flujo de gestión de
  observaciones (vendedor → mandante). Espera consumer en sprint posterior
  cuando se complete el panel de gestión `<VendorAccreditationPanel/>`.
- **Acción:** marcar como API público en JSDoc; cuando se cree el panel,
  consumir desde `src/components/vendorOnboarding/`.

## Triggers huérfanos (1)

### `zettelkastenMaterializer`
- **File:** `src/server/triggers/zettelkastenMaterializer.ts:1-15`
- **Hallazgo:** módulo no importado en `server.ts`.
- **Decisión:** **DEFER (intencional)**.
- **Razón:** el módulo declara explícitamente:
  > "este módulo no se importa en server.ts hasta que el usuario active el
  > feature flag MATERIALIZER_ENABLED=true. Ship behind flag para no
  > perturbar el comportamiento actual."
  Es **shipped behind flag** por diseño. La materialización canonical-nodes
  desde `/tenants/{tid}/zettelkasten_nodes/*` se activará en el Bloque L
  cuando se complete el wire del Zettelkasten canonical (L4 + L10).
- **Acción:** documentar el flag `MATERIALIZER_ENABLED=true` en
  `.env.example` cuando se active. Wirearlo en `server.ts` detrás del flag
  en Bloque L10.

## Jobs sin caller scheduler (2)

### `runLoneWorkerEscalationCron`
- **File:** `src/server/jobs/runLoneWorkerEscalation.ts:55`
- **Hallazgo:** función exportada pero no invocada por ninguna route ni
  scheduler.
- **Decisión:** **WIRE (URGENTE).**
- **Razón:** este job ejecuta CADA 5 MIN sobre `lone_worker_sessions` activas
  y escala (supervisor → brigada → emergency_services) cuando un trabajador
  solo no hace check-in o pulsa "ayuda". **Es código de seguridad crítica —
  vidas dependen.** Sin scheduler montado, la escalación nunca dispara en
  producción.
- **Acción:** agregar route `POST /api/scheduler/lone-worker-escalation`
  gated por `verifySchedulerToken` middleware. Cloud Scheduler invoca cada
  5 min. Tracker en Bloque F6.

### `consolidateZettelkasten`
- **File:** `src/server/jobs/consolidateZettelkasten.ts:71`
- **Hallazgo:** función exportada pero no invocada por ninguna route ni
  scheduler.
- **Decisión:** **DEFER (intencional — one-shot manual).**
- **Razón:** el módulo declara explícitamente:
  > "**DO NOT RUN against production without a backup snapshot.** This job
  > rewrites Firestore documents across three collections to consolidate
  > the Zettelkasten on a single canonical path."
  Y luego:
  > "Default mode is dry-run. To actually migrate, the caller must pass
  > mode: 'commit' explicitly. There is no CLI flag to flip; the operator
  > passes the option in code."
  Es un **job de migración manual one-shot**, no continuo. Por diseño
  requiere invocación humana con backup previo. Mantener exportado para
  que un operador lo invoque desde Node REPL o un script ad-hoc cuando
  esté listo para consolidar.
- **Acción:** agregar runbook `docs/runbooks/ZK_CONSOLIDATION_RUNBOOK.md`
  documentando cómo y cuándo correrlo (post-Bloque L4 cuando el canonical
  schema esté firme).

## TODOs/FIXMEs services (14, distribuidos en plan v2)

Ya catalogados en el plan v2:

| Ubicación | Plan |
|---|---|
| `libredteAdapter.ts:1` | K1 (SII PSE selection) |
| `openfacturaAdapter.ts:6` | K1 |
| `simpleApiAdapter.ts:7` | K1 |
| `billing/types.ts:37` | A22 (verificado — nota ya correcta) |
| `mercadoPagoAdapter.ts:25` | K10 |
| `webpayAdapter.ts:346` | F13 |
| `resilientAiOrchestrator.ts:34` | F12 |
| `validate.ts:27` | F10 |
| `limiters.ts:244` | F11 |
| `curriculum.ts:710` | K11 |
| `billing.ts:679` | K7 |
| `billing.ts:1215` | (deferred — risk note ok) |
| `cloudErrorReportingAdapter.ts:42-75` | K9 |

## Gemini actions

- ✅ **88 actions mapeadas 1:1** entre `ALLOWED_GEMINI_ACTIONS` y exports de
  `geminiBackend.ts`. Sin huérfanos en ninguna dirección.

## Resumen

| Categoría | Total | Decisión |
|---|---|---|
| Funciones huérfanas | 1 | 1 DEFER |
| Triggers huérfanos | 1 | 1 DEFER (intencional) |
| Jobs sin scheduler | 2 | 1 WIRE (URGENTE), 1 DEFER (one-shot) |
| TODOs services | 14 | distribuidos en plan v2 |
| Gemini actions | 88/88 | ✅ clean |

Cero borrados. Cero decisiones ciegas. Cada item registrado con razón.
