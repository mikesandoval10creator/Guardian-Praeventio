# Índice de auditorías — puntero a las fuentes vivas

> **Actualizado 2026-07-20.** La auditoría línea-por-línea de junio
> (`docs/audits/file-ledger/`, ~126 docs) se **triaó contra el código actual y
> se retiró** — sus hallazgos viven ahora en Notion (git conserva el histórico).
> Este índice ya no mapea "150+ docs de auditoría": esos se consolidaron.

## Dónde vive cada verdad

| Fuente | Rol |
|---|---|
| **Notion — _Alpha 41 — Tasks_** | Deuda pendiente + inventario positivo (`Ya-real (auditoría)`, con `Verify cmd`). La fuente de trabajo. |
| [`../ESTADO-MEDIDO.md`](../ESTADO-MEDIDO.md) | Contadores, generados desde los ratchets (no a mano). |
| graphify (`graphify-out/`) | Estructura y relaciones del código (`graphify explain/query/path`). |
| [`../../TODO.md`](../../TODO.md) · [`../PENDIENTE.md`](../PENDIENTE.md) | Decisiones, reglas e historial. NO listas de pendientes. |
| [`../../CLAUDE.md`](../../CLAUDE.md) | Convenciones #1-#25 + "Active work". |

## Audit docs que siguen vivos aquí

| Doc | Por qué se queda |
|---|---|
| `DIRECT-WRITES-INVENTORY-2026-07-14.md` | Referenciado por `src/server/routes/workers.ts`; rastrea trabajo activo (writes cliente sin audit). |
| `CONTEXT_AUDIT_2026-06.md` | Entrada del generador `audit-coverage-census.cjs`. |
| Este `INDEX.md` | Entrada del generador `audit-file-ledger.cjs`. |

## Histórico (archivado — solo consulta puntual, no refleja el estado actual)

`docs/audits/archive/` (snapshots 2026-05, auditoria777, PENDING_AFTER_SPRINT_19,
y las 2 auditorías externas `.txt` del 2026-06-20 — sus P0 se cruzaron con la
auditoría de junio ya triada a Notion) y `docs/archive/2026-05/`.
