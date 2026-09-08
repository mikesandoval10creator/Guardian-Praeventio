# ADR 0031 — Materializer dual para fuentes Zettelkasten históricas

- Status: Proposed
- Date: 2026-09-08
- Deciders: Daniel Sandoval (pending explicit approval)
- Related: ADR-0029, ADR-0030, Notion
  `3cdaa66d-73fe-81d8-ba3d-f1584c17b0b6`, E7d Zettelkasten

## Context

Guardian tiene más de una forma histórica de escribir conocimiento:

- `tenants/{tenantId}/zettelkasten_nodes/{id}` con payload tenant-scoped o
  documentos planos de `incidentPostmortem`;
- `zettelkasten_nodes/{id}` top-level desde wisdom/server writers;
- `nodes/{tenantId}_{projectId}_{id}` como lectura canónica del cliente.

El materializer puro existía, pero `setupMaterializerListener` no tenía caller
productivo, esperaba exclusivamente `{ payload, projectId }` y no procesaba la
forma plana. El resultado era una brecha de convergencia: un writer podía
reportar éxito y el nodo no llegar a `nodes`.

## Decision drivers / invariants

- La lectura canónica debe converger sin que un writer de vida-safety quede
  silenciosamente invisible.
- `tenantId` y `projectId` no se pueden inferir sin validación; un mismatch se
  descarta antes de escribir.
- Datos legacy no deben forzar una migración destructiva ni borrar la fuente.
- Un fallo transitorio de Firestore debe reintentarse de forma acotada y el
  shutdown debe liberar listeners y timers.
- La operación debe tener rollback explícito y no bloquear el servidor HTTP.
- La decisión no certifica despliegue, backfill histórico ni operación física.

## Options considered

### A — Mantener el trigger sin caller

No introduce costo, pero conserva la ruptura observada y deja el canonical graph
depender de dual-writes best-effort. Rejected.

### B — Escuchar solamente una tenant collection

Reduce el blast radius, pero requiere descubrir y mantener una lista de tenants;
no cubre los writers top-level ni el backfill natural de legacy. Rejected como
solución única.

### C — Listener dual + normalizador fail-closed (propuesta)

El boot productivo registra un listener para el collection group
`zettelkasten_nodes` tenant-scoped y otro para la colección top-level. Ambos
pasan por un normalizador único, resuelven `projects/{projectId}.tenantId`,
materializan al path determinista y reintentan fallos transitorios. La flag
`MATERIALIZER_ENABLED=false` detiene la instalación para rollback.

### D — Ejecutar consolidation commit

Podría reducir duplicación, pero mezcla migración, borrado y cambio de lectores
sin backup ni evidencia de deploy. Queda fuera de esta ADR y requiere una
operación posterior con backup, dry-run, lease y aprobación separada.

## Proposed decision

Adoptar C para la fase de convergencia no destructiva:

- `setupMaterializerListener` sin `tenantId` observa ambas fuentes;
- el normalizador acepta payload anidado y documentos planos compatibles;
- `incident_postmortem` se traduce al tipo canónico `incident-reported`;
- el tenant se valida contra el path/documento y, en boot, contra el documento
  del proyecto;
- datos malformados, ambiguos o sin tenant resoluble no generan writes;
- los writes canónicos usan `merge: true` y el path determinista;
- se permiten hasta tres reintentos después del intento inicial, con backoff
  acotado;
- el servidor inicia el listener por defecto y permite rollback explícito con
  `MATERIALIZER_ENABLED=false`;
- `SIGTERM` llama `unsubscribe()`, cancela timers y conserva el drain HTTP.

## Security and life-safety impact

Esto reduce la posibilidad de que una lección de seguridad o un post-mortem
exista solo en una colección que no leen UniversalKnowledge/RAG/Digital Twin.
No convierte una fuente legacy en confiable por sí misma: el normalizador
rechaza shape inválido y el resolver rechaza tenant/project mismatch.

El listener Admin SDK atraviesa las Firestore Rules, por lo que la autorización
se implementa en el propio resolver y en el contrato de origen; no se afirma
que las Rules protejan este proceso server-side.

## Performance and operations

El modo global hace un snapshot inicial de dos fuentes, incluido el collection
group tenant-scoped. Eso puede tener costo proporcional al backlog. Por eso:

- no se ejecuta `consolidateZettelkasten` automáticamente;
- el listener no borra fuentes;
- cada write es idempotente por path;
- los reintentos están acotados y se cancelan en shutdown;
- el costo y el tiempo de convergencia deben medirse en staging antes de
  promover `TM-T09`.

## Migration and rollback

Rollback inmediato: configurar `MATERIALIZER_ENABLED=false` y reiniciar la
revisión; el boot no instala listeners. El rollback no borra los `nodes` ya
materializados ni revierte writers.

La migración de documentos sin `tenantId`, `projectId` o con shape incompatible
requiere un job separado, backup verificable, dry-run y revisión de auditoría.
Esta ADR no autoriza ese commit.

## Verification gates

- RED→GREEN para flat/nested payload, incident postmortem y wisdom/server shape.
- Test de tenant/project mismatch y documento inválido sin write.
- Test de retry automático y cancelación de ambos listeners.
- Test de `removed` sin materialización.
- Contract test que prueba import, boot, flag y cleanup en `server.ts`.
- `npm run typecheck`, lint, conventions, security review y CI completo.
- Firestore/deploy staging con dos writers, reinicio y medición de backlog/costo.

## Consequences

### Positive

- Los writers históricos convergen a la lectura canónica sin reescritura
  inmediata de todos los productores.
- El fallo de un documento no bloquea los demás.
- La relación código → test → trigger → canonical path es auditable.

### Negative / residual

- El snapshot global puede ser costoso y requiere observabilidad operativa.
- Los documentos legacy sin tenant/project siguen sin poder materializarse.
- El listener en proceso no prueba Cloud Functions, Scheduler ni despliegue.
- El dual-write de algunos writers todavía puede fallar después de la fuente;
  la reconciliación durable queda para otro ticket.

## References

- `src/server/triggers/zettelkastenMaterializer.ts`
- `src/server/triggers/zettelkastenMaterializer.test.ts`
- `src/__tests__/contracts/serverMaterializerWiring.test.ts`
- `src/services/zettelkasten/incidentPostmortem.ts`
- `src/server/routes/wisdomCapsule.ts`
- `src/server/services/serverZkNodeWriter.ts`
- `server.ts`
- `docs/security/THREAT_MODEL.md` — TM-T09
- `docs/security/STRIDE_findings.md` — TM-T09
- `C:/Users/Usuario/Obsidian/Segundo-Cerebro/01-Guardian/04-BARRIDO-BACKEND/Barrido-E7d-Zettelkasten-Graph-Risk-2026-08-31.md`
