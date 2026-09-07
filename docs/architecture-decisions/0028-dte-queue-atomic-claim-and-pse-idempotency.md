# ADR-0028 — DTE queue atomic claim, lease y deduplicación del PSE

- **Estado:** Proposed
- **Fecha:** 2026-09-07
- **Ámbito:** `dte_issue_queue/{idempotencyKey}`, drain de maintenance y
  adapters SII
- **Tickets:**
  - `3cdaa66d-73fe-81fe-9e14-f0512e0d6136` — recovery de `in_flight`
  - `3cdaa66d-73fe-8121-916d-fa328ed30d38` — claim no atómico/doble emisión

## Contexto

Los pagos pueden quedar confirmados antes de emitir el DTE. La cola persistente
permite reintentar, pero el drain anterior hacía `read → set` sobre el mismo
documento. Dos procesos podían observar `pending` y ejecutar el PSE, y un crash
después de marcar `in_flight` podía dejar la entrada congelada.

La API oficial de Bsale documenta `salesId` como referencia externa de la venta
y su deduplicación por tipo de documento:
<https://docs.bsale.dev/documentos/>.

## Decisión

1. El drain reclama mediante una transacción que lee la entrada y el documento
   dedicado `dte_issue_claims/{idempotencyKey}`.
2. La primera reclamación usa `tx.create`; una reclamación concurrente colisiona
   sobre el mismo documento en Firestore y se reintenta/observa como `leased`.
3. La entrada conserva `claimToken`, `lastClaimStartedAt` y `leaseExpiresAt`
   para visibilidad y recuperación. El lease normal es de cinco minutos.
4. Una entrada `in_flight` con lease expirado puede reclamarse. Las entradas
   legadas sin timestamp utilizable se reportan como `legacyStuck` y no se
   reemiten por adivinación.
5. La finalización vuelve a leer el claim y solo persiste el estado si el
   `claimToken` sigue perteneciendo al worker. Luego elimina el claim dedicado.
   Un worker viejo no puede pisar ni borrar el lease de un worker nuevo.
6. `tryAutoIssueDte` recibe la key estable del pago y la propaga como `salesId`
   al payload Bsale. La key también viaja desde los cuatro rails de pago y el
   retry drain.
7. `DTE_AUTO_ISSUE=false` sigue siendo fail-closed: el drain retorna antes de
   consultar o mutar la cola. La recuperación ocurre cuando el auto-issue está
   habilitado.

## Semántica y límites

Esto garantiza **un solo claimant activo por key** y entrega **at-least-once**.
La deduplicación provider-side reduce el riesgo de una repetición después de un
crash/timeout, pero no es una prueba universal de exactly-once para cualquier
PSE ni sustituye la confirmación real SII. El test de dos procesos contra
Firestore Emulator prueba el claim concurrente; no certifica Bsale, PSE ni
producción.

## Consecuencias

- El drain expone `skippedLeased`, `reclaimedFromStale`, `legacyStuck` y
  `completionLost` para operación y auditoría.
- La colección `dte_issue_claims` debe conservar reglas/retención compatibles
  con auditoría; no contiene el invoice crudo ni credenciales.
- Bsale debe seguir recibiendo un `salesId` estable y dentro de su límite
  documentado; el adapter valida 1–255 caracteres.
- La recovery es deliberadamente conservadora con documentos históricos
  malformados: requieren intervención, no una segunda emisión automática.

## Alternativas rechazadas

- Mutex en memoria: no coordina procesos ni instancias Cloud Run.
- Read-then-update del documento de cola: deja una ventana de doble claim y el
  emulator no puede demostrar el conflicto de forma fiable.
- Afirmar exactly-once solo por usar un document ID determinista: Firestore no
  puede deshacer un side effect externo ya enviado.
