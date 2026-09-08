# ADR 0032 — Identidad autoritativa para replay offline de nodos

- Status: Proposed
- Date: 2026-09-08
- Deciders: Daniel Sandoval (pending explicit approval)
- Related: ADR-0031, Notion ticket
  `3cdaa66d-73fe-81b9-b3f8-da362247a243`, E7d Zettelkasten

## Context

`MatrixSyncManager` conserva operaciones offline como `{ type, id, data }`.
Un `update` contiene normalmente un patch parcial; puede no incluir `id`,
`projectId` ni `tenantId`. La implementación previa enviaba solo `data` a
`syncNodeToNetwork`, que entonces podía generar otro document ID y normalizar
la operación a `global`.

El fallo no es meramente cosmético: un replay después de reconexión puede dejar
la edición original sin aplicar, crear un nodo huérfano y contaminar el índice
vectorial fuera del proyecto esperado.

## Decision drivers / invariants

- `op.id` es la identidad autoritativa del replay; el `id` dentro del payload
  nunca puede sustituirlo.
- `update` solo puede modificar un documento existente en `nodes/{op.id}`.
- `projectId` y `tenantId` son identidad de alcance, no campos mutables del
  patch. Un intento de moverlos falla cerrado antes del write.
- El patch se fusiona sobre el documento remoto autoritativo para conservar
  campos que el cliente offline no transporta.
- Las operaciones `set` fuerzan igualmente `op.id` para evitar divergencia
  entre queue key y payload.
- Un error de replay queda en `failedOps`; `MatrixSyncManager` conserva la
  operación para el siguiente ciclo. No se afirma exactly-once ni certificación
  del proveedor vectorial.

## Options considered

### A — Seguir haciendo upsert con `op.data`

Mantiene compatibilidad con el código existente, pero permite pérdida de
identidad y scope. Rejected: reproduce T10.

### B — Completar campos en el cliente antes de encolar

Reduce algunos patches incompletos, pero el cliente no es una fuente
autoritativa y puede reiniciarse con un estado obsoleto. Rejected como control
único.

### C — Resolver y fusionar en el backend (propuesta)

El backend, después de verificar al caller, lee `nodes/{op.id}`, valida
inmutabilidad de proyecto/tenant, fusiona el patch y llama al writer con el id
forzado. Es la propuesta adoptada.

## Proposed decision

Adoptar C en `src/services/networkBackend.ts`:

- `resolveBatchNodeData` prepara `set`/`update` antes de cualquier embedding o
  write vectorial;
- `update` de target inexistente es error, no creación automática;
- `projectId`/`tenantId` divergentes son errores deterministas;
- el writer sigue haciendo membership check para el proyecto canónico y sus
  backlinks no se amplían;
- la cola conserva `failedOps` para retry del ciclo de sincronización.

## Security and life-safety impact

La decisión evita que una edición offline de un registro de seguridad se
convierta en otro registro sin identidad, global o cross-tenant. Reduce la
probabilidad de perder una corrección operativa durante reconexión, pero no
sustituye la validación desplegada con Auth real ni las pruebas físicas de
reinicio/offline/Doze/pantalla apagada.

## Consequences

### Positive

- El replay tiene una identidad estable y auditable.
- Los patches parciales conservan contexto remoto no transportado.
- Los intentos de cross-project/cross-tenant quedan rechazados antes del side
  effect.
- La cola puede reintentar fallos sin convertirlos en creates silenciosos.

### Negative / residual

- Cada update requiere una lectura remota adicional antes del write.
- Un update encolado antes de que exista el target debe esperar un set previo o
  quedar en retry; no se hace upsert implícito.
- Falta evidencia de dos tenants/proyectos reales, restart del cliente y
  convergencia entre Firestore/vector store en staging.
- El historial de documentos legacy sin `tenantId` no se migra en esta ADR.

## Verification

- `networkBackend.test.ts`: 15/15, incluyendo update parcial, id divergente,
  missing target y spoof de proyecto/tenant.
- `syncManager.test.ts`: 6/6, incluyendo forwarding de `op.id` y patch parcial.
- Typecheck/lint/CI de la PR serán gates separados; el merge no equivale a
  deploy o certificación.
