# Read-pipeline specs — cola ejecutable para "hacer real" la analítica

**Por qué existe este doc.** La auditoría 2026-06-19 (ola MiMo) reveló que los
cascarones/mounts-fantasma de analítica NO están vacíos por falta de montaje, sino
porque **su pipeline de datos de LECTURA nunca se construyó** (solo hay write-side).
Montarlos con datos inventados = fabricación (prohibido, ver [[feedback_honest_means_real_not_empty]]).
El fix real = construir estos pipelines. Cada spec abajo es **ejecutable directo** (por
Claude o por MiMo vía spec interactivo + Claude merge-gate). Patrón probado: **PR #1071**
(roster CPHS) — léelo como plantilla.

> Disciplina por spec: `verifyAuth` + `assertProjectMember` (o `requireTier` si es
> management/scale, NUNCA en vida-safety) · read-only = sin audit_log · 5xx sin filtrar
> internals · ≥1 test conductual (401/200/403) sobre el router real (CLAUDE.md #22) ·
> **verificar la forma real de cada campo en disco antes de agregar** (no asumir nombres).

---

## ✅ HECHO — Roster de proyecto (plantilla)
`GET /api/projects/:projectId/roster` (organic.ts) — une `memberUids` de crews →
`users/{uid}.displayName`. PR #1071. Desbloqueó CPHS `candidateMembers`.

---

## ✅ P1 — HECHO — Snapshot de proyecto (desbloquea ProjectsCompare #1049 + ExecDash)
**Endpoint:** `GET /api/sprint-k/:projectId/multi-project/snapshots` en
`src/server/routes/multiProject.ts:222`. Agregador puro en
`src/server/services/projectSnapshotAggregator.ts` (verificado vs insights.ts /
cphsMinute.ts). Hook `fetchProjectSnapshots` en `src/hooks/useMultiProject.ts`;
`ProjectsCompare.tsx:63` carga snapshots reales en vez del prop vacío (cierra
DEEP-EX-34 H3). Tests: `multiProject.test.ts` (401/403/200 con datos sembrados +
honest-empty) + `projectSnapshotAggregator.test.ts` (clasificación de campos) +
`ProjectsCompare.test.tsx` (dato real fluye sin prop). Spec original abajo.
- **Auth:** `verifyAuth` + `requireTier('platino', …)` (es management/scale, no vida — tier OK) + `assertProjectMember` sobre cada proyecto devuelto.
- **Fuente real (verificar campos antes):** `projects` where `members array-contains uid`
  (proyectos visibles) → por cada uno agregar de `incidents`/`findings`/`audits`/`risks`/
  `corrective_actions` (todas existen server-side, confirmado por grep).
- **Output:** `ProjectSnapshot[]` (forma exacta en `src/services/projectComparator/projectComparator.ts:25`):
  - `incidentCount` = count `incidents` where projectId
  - `openFindingsCount` = `findings` where projectId & status≠closed
  - `auditCompliancePct` = % `audits` cumplidas (verificar campo status real)
  - `criticalRisksCount` = `risks` where level/severity = crítico (verificar campo)
  - `workersCount` = `projects/{id}.workersCount`
  - `correctiveActionsOnTimePct` = % `corrective_actions` con `closedAt <= dueDate` (verificar nombres de fecha — **este es el campo que NO se puede derivar client-side, motivo del cascarón**)
- **Frontend:** `useMultiProject` agrega `fetchProjectSnapshots(projectId)`; `ProjectsCompare`
  carga snapshots reales en vez del prop vacío (cierra #1049).
- **Tests:** 401 · 200 (agrega 2 proyectos con datos sembrados, verifica métricas reales) ·
  403 no-miembro · honest-empty (proyecto sin datos → métricas en 0 reales, no inventadas).

## P2 — Snapshot de horas-hombre (desbloquea SafetyMetricsDashboard: TRIR/LTIFR)
**Bucket D.** TRIR/LTIFR necesitan `totalHoursWorked` por período — **no se trackea hoy**.
- **Opción A (lazy-real):** derivar de roster × días-trabajados del período (aproximación
  explícita, etiquetada "(estimado)" en UI — honesto, no fabricado). Requiere fuente de
  días/turnos reales (¿`shifts`/`attendance`?). Verificar si existe; si no → Opción B.
- **Opción B:** colección `work_hours` + entrada manual/import (nueva colección = reglas +
  ≥5 rules-tests + Dirty Dozen). Hasta entonces, SafetyMetricsDashboard queda **honest-empty**
  ("falta dato horas-hombre"), NO montado con horas inventadas.
- Mismo patrón para el re-montaje honesto de los 3 dashboards fantasma (#1038/#1039/#1034):
  montar solo cuando su dato real exista; mientras, empty-state honesto.

## P3 — Telemetría de leading-indicators (desbloquea SpiDashboard)
**Bucket D.** `LeadingIndicators` (checklist %, charlas, capacitación vigente, inspecciones,
near-miss, observaciones positivas) — varios SÍ derivables de colecciones existentes
(pre-task checklists, trainings, inspections), otros no. Spec: derivar los reales, marcar los
faltantes como "sin medición" (no 0 fabricado). `LaggingIndicators` reusa P1/P2.

---

## Notas de flujo (MiMo)
MiMo ejecuta estos specs **de forma interactiva** (MiMo Code, o agente apuntado a su endpoint
Anthropic-compatible) — su suscripción prohíbe scripts automatizados. Claude redacta el spec,
MiMo lo implementa, Claude audita+mergea (review adversarial en lo sensible). Ver CLAUDE.md
"Active work" → "Flujo MiMo".
