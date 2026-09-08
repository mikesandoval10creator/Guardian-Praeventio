# ADR 0033 — Contrato común de validación del materializer

- Status: Proposed
- Date: 2026-09-08
- Deciders: Daniel Sandoval (pending explicit approval)
- Related: ADR-0031, Notion ticket
  `3cdaa66d-73fe-81b9-b3f8-da362247a243`, E7d Zettelkasten

## Context

El materializer tenía dos superficies con reglas distintas:

- `materializeNode` aceptaba cualquier objeto que satisficiera el tipo
  TypeScript en compile-time, incluyendo `title: ''`, type desconocido,
  metadata `NaN`/`Infinity` y arrays malformados en runtime.
- `materializeBatch` aplicaba solo dos checks locales y podía producir una
  decisión distinta para el mismo input.

Los writers y Firestore entregan datos que cruzan un boundary de runtime; una
aserción TypeScript no es validación. Un nodo inválido puede desaparecer del
Digital Twin, degradarse a `Riesgo` por un type desconocido o contaminar
conexiones/RAG.

## Decision drivers / invariants

- Un input inválido no produce `CanonicalNode` ni ejecuta un write.
- `materializeNode` y `materializeBatch` consultan el mismo validador.
- El batch reporta un código estable y continúa con los demás inputs.
- IDs, title, description, type, severity, metadata y arrays tienen límites de
  runtime explícitos; números metadata deben ser finitos.
- La relación real `projectId ↔ tenantId` sigue siendo responsabilidad del
  trigger/resolver, porque la función pura no tiene acceso a Firestore.
- El alias histórico `incident_postmortem` se normaliza en el boundary del
  trigger antes de llegar al contrato canónico.

## Options considered

### A — Mantener solo interfaces TypeScript

No protege documentos Firestore ni JavaScript compilado. Rejected.

### B — Validar por separado en cada caller

Reduce el riesgo local pero vuelve a permitir divergencia entre route, batch,
trigger y migración. Rejected.

### C — Validador puro compartido (propuesta)

`validateMaterializeInput` devuelve un issue estructurado sin I/O. El mapper
lanza un error fail-closed; el batch convierte el mismo código en `skipped`; el
trigger reutiliza la whitelist de types. Adopted.

## Proposed decision

Adoptar C en `src/services/zettelkasten/canonical/materializer.ts`:

- `isKnownRiskNodeType` centraliza el conjunto soportado.
- `validateMaterializeInput` valida shape, IDs, payload, scalar metadata finita,
  arrays y timestamps opcionales.
- `materializeNode` rechaza antes de construir el resultado.
- `materializeBatch` no aborta por un registro inválido y conserva códigos
  (`invalid_payload`, `missing_projectId`, etc.).
- `materializeOne` captura el error para mantener `ok:false` sin write.
- `zettelkastenMaterializer.ts` importa la whitelist común y mantiene la
  comprobación project/tenant propia del boundary I/O.

## Security and life-safety impact

El cambio elimina una divergencia de validación que podía convertir datos
malformados en nodos visibles y operativamente interpretables. La defensa es
local y automatizada; todavía no certifica la calidad de datos históricos,
backfill, despliegue ni la relación real de claims/Auth en producción.

## Consequences

### Positive

- Un solo contrato para mapper y batch.
- Fallo cerrado antes de persistencia canónica.
- Los errores son aislables por registro en migraciones/batches.
- Nuevos `RiskNodeType` deben añadirse explícitamente al conjunto runtime.

### Negative / residual

- Un writer legítimo con un nuevo type debe actualizar el conjunto y sus tests;
  de lo contrario será rechazado, preferible a degradarlo silenciosamente.
- La función pura no puede probar por sí sola que el proyecto pertenezca al
  tenant; el trigger/resolver sigue siendo necesario.
- `description` ahora debe ser no vacío para callers directos; postmortem debe
  seguir usando el normalizador que construye el fallback.
- Persisten pendientes de backfill, backup, deploy/Auth real y validación física.

## Verification

- RED contra el contrato previo: 4 fallos de validación/inconsistencia.
- Canonical + trigger: **39/39 PASS**.
- Callers directos (writers/route): **55/55 PASS**.
- Typecheck, lint, conventions y router ratchet: PASS.
- Threat model: **33/33 IDs únicos**; T11 permanece `partial` hasta deploy.
