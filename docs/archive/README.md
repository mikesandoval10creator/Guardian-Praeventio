# docs/archive/ — snapshots históricos

> **Fuentes de verdad activas (2026-07-20):** la **deuda pendiente** vive en
> Notion (_Alpha 41 — Tasks_); los **contadores** en
> [`/docs/ESTADO-MEDIDO.md`](../ESTADO-MEDIDO.md) (generado desde los ratchets);
> las **decisiones e historial** en [`/TODO.md`](../../TODO.md) y
> [`/docs/PENDIENTE.md`](../PENDIENTE.md). Cualquier documento dentro de
> `docs/archive/` es un snapshot histórico conservado para auditoría y
> trazabilidad — **no lo consultes para decisiones operacionales actuales**.

---

## ¿Por qué archivamos?

A lo largo de 2026-04 / 2026-05 el repo acumuló ~42 documentos `.md` en
raíz compitiendo por decir "cuál es el estado". Eso volvió cualquier
auditoría externa lenta y los reportes contradictorios entre sí
(p. ej. README declaraba "99% end-to-end" mientras TECHNICAL_DEBT_AUDIT
decía "~70% real").

La directiva del usuario (2026-05-15) fue consolidar TODO.md como **fuente
única de verdad** con **Regla #1 inviolable**: nada se marca ✅ sin
`file:line` de evidencia. Los docs históricos quedan archivados — son
útiles para responder "¿qué pensábamos en abril?" pero no para responder
"¿qué hay que hacer hoy?".

---

## Movimiento 2026-05-21 (Fase B del plan integrado)

Movidos en commit del 2026-05-21 (rama `fix/fase-a-cierre-residual-2026-05-21`):

| Documento (old path) | Tamaño | new path | Razón |
|---|---|---|---|
| `IMPLEMENTATION_ROADMAP.md` | 1503 LOC | `docs/archive/2026-05/IMPLEMENTATION_ROADMAP.md` | Roadmap superseded por TODO.md §6 (plan actual) |
| `MASTER_PROPOSAL_2026-05.md` | 827 LOC | `docs/archive/2026-05/MASTER_PROPOSAL_2026-05.md` | Propuesta estratégica histórica — su esencia vive en TODO.md §6 + §8 |
| `STRYKER_BASELINE.md` | 790 LOC | `docs/archive/2026-05/STRYKER_BASELINE.md` | Baseline mutational del Sprint 38 — current state está en `stryker.config.json` + TODO.md §1 |
| `STATE_OF_FUNCTIONALITY_2026-05-04.md` | 340 LOC | `docs/archive/2026-05/STATE_OF_FUNCTIONALITY_2026-05-04.md` | Snapshot del 2026-05-04 (claim "99%" rectificado por audit 2026-05-15) |
| `INFORME_ESTADO_2026-04-29.md` | 426 LOC | `docs/archive/2026-05/INFORME_ESTADO_2026-04-29.md` | Estado del 2026-04-29 |
| `INFORME_AVANCE_NOTEBOOK_LLM.md` | 325 LOC | `docs/archive/2026-05/INFORME_AVANCE_NOTEBOOK_LLM.md` | Avance Notebook LLM (Vertex Trainer descartado, ver TODO.md §9) |
| `SKILL_ROUTING_2026-05-04.md` | 421 LOC | `docs/archive/2026-05/SKILL_ROUTING_2026-05-04.md` | Skill routing histórico — superseded por configuración Claude Code actual |
| `TECHNICAL_DEBT_AUDIT.md` | 345 LOC | `docs/archive/2026-05/TECHNICAL_DEBT_AUDIT.md` | Audit deuda técnica — los hallazgos vivos están en TODO.md §2 |
| `VERTEX_MIGRATION.md` | 246 LOC | `docs/archive/2026-05/VERTEX_MIGRATION.md` | Migración Vertex Trainer (descartado, TODO.md §2.7) |
| `PLAN_PARTE1_GP_ACTUAL.md` | 199 LOC | `docs/archive/2026-05/PLAN_PARTE1_GP_ACTUAL.md` | Plan parte 1 |
| `PLAN_PARTE2_PROTOTIPO1.md` | 172 LOC | `docs/archive/2026-05/PLAN_PARTE2_PROTOTIPO1.md` | Plan parte 2 |
| `PLAN_PARTE3_PROTOTIPO2.md` | 240 LOC | `docs/archive/2026-05/PLAN_PARTE3_PROTOTIPO2.md` | Plan parte 3 |
| `PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md` | 260 LOC | `docs/archive/2026-05/PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md` | Plan parte 4 |
| `AUDIT.md` | 235 LOC | `docs/archive/2026-05/AUDIT.md` | Audit antiguo — vivo está en `docs/audits/` |
| `ROADMAP.md` | 119 LOC | `docs/archive/2026-05/ROADMAP.md` | Roadmap — superseded por TODO.md §6 |
| `ROADMAP_2026-05.md` | 163 LOC | `docs/archive/2026-05/ROADMAP_2026-05.md` | Roadmap 2026-05 |
| `PROTO_ARCHAEOLOGY.md` | 167 LOC | `docs/archive/2026-05/PROTO_ARCHAEOLOGY.md` | Arqueología prototipos previos |
| `IMPACTO.md` | 141 LOC | `docs/archive/2026-05/IMPACTO.md` | Reporte impacto histórico |

**Total movido:** 18 docs · ~6300 LOC. Raíz pasó de 42 → 24 `.md`.

---

## Cómo se manejan items de estos docs en el flujo actual

1. Propuestas y pendientes accionables se trasladan a **TODO.md §8** (Day-1)
   conforme se descubren con `file:line` verificable.
2. Hallazgos críticos sin file:line se trasladan a **TODO.md §2** como
   pendientes accionables.
3. Decisiones rectificadas (p. ej. Stripe descartado, Vertex Trainer
   descartado) se trasladan a **TODO.md §9** (descartado por directiva).
4. Items resueltos con file:line se promueven a **TODO.md §7** (cerrado
   verificado).

Si descubres un item en un doc archivado que NO está reflejado en TODO.md,
agrégalo a la sección apropiada **citando el doc + sección de origen** para
preservar trazabilidad histórica.

---

## Qué NO se archivó (queda activo en raíz)

Docs operacionales + de referencia técnica continúan en raíz porque tienen
audiencia recurrente:

- **Onboarding y core operacional:** `README.md`, `ARCHITECTURE.md`, `RUNBOOK.md`,
  `DR_RUNBOOK.md`, `SECURITY.md`, `CONTRIBUTING.md`, `BRAND.md`, `TODO.md`
- **Operaciones específicas:** `KMS_ROTATION.md`, `MONITORING.md`,
  `OBSERVABILITY.md`, `PERFORMANCE.md`
- **Integraciones:** `BILLING.md`, `SII_INTEGRATION.md`, `MARKETPLACE_SUBMISSION.md`,
  `PRICING.md`, `API_B2D_SPEC.md`
- **Specs activas:** `ZETTELKASTEN_V2_SPEC.md`, `ZETTELKASTEN_V2_NODES_FULL.md`,
  `BERNOULLI_EXTENSIONS.md`, `DIGITAL_TWIN_GPU_FREE_PLAN.md`
- **Mobile y plataformas:** `IOS_BUILD.md`, `HEALTH_CONNECT_MIGRATION.md`
- **Security spec adicional:** `security_spec.md`

Si alguno de estos pasa a ser histórico (p. ej. el setup ya está estable y
no se toca más), muévase aquí siguiendo la misma convención de tabla.
