# ADR 0026 — Autoridad server-side para cerrar sesiones Lone Worker

- Status: Proposed
- Date: 2026-09-07
- Deciders: Daniel Sandoval (pending explicit acceptance)
- Related: Notion `3cdaa66d-73fe-81a3-b207-d5c11f25cc0b`, `firestore.rules:1005-1025`, ADR 0021, [[Auditoria-ManDown-Android-2026-08-30]]

## Context

`POST /:projectId/lone-worker/end-session` estaba protegido por autenticación y pertenencia al proyecto, pero aceptaba una `LoneWorkerSession` completa enviada por el cliente. El handler usaba Admin SDK para revocar campos de la capability nativa, por lo que las reglas de Firestore no constituían una defensa suficiente. Un miembro podía intentar cerrar la sesión de otro trabajador y afectar la autoridad ManDown.

La especificación Notion `3cdaa66d-73fe-81a3-b207-d5c11f25cc0b` exige autoridad propia o de rescate, sesión persistida como fuente canónica, transición CAS/idempotente, auditoría del actor y pruebas adversas.

## Decision drivers / invariants

- La vida-safety no puede depender de un `workerUid` enviado por el cliente.
- `verifyAuth` es la fuente de identidad: `req.user.uid`, `req.user.admin` y `req.user.role` vienen del token verificado.
- La pertenencia al proyecto sigue siendo obligatoria incluso para un rol de rescate.
- La capability ManDown debe revocarse junto con el cierre, sin dejar una ventana de autoridad por una actualización parcial.
- Una repetición segura no debe cambiar el `endedAt` canónico ni duplicar la transición.
- El documento de sesión final debe conservarse para investigación; cerrar no significa borrar.
- Un fallo de auditoría no debe convertir un cierre ya aplicado en un error para la persona.
- `platform_operator` no es una autoridad de proyecto y no se incluye como rol de rescate.

## Options considered

### A. Mantener el endpoint pure-compute y confiar en Firestore Rules

**Rechazada.** Admin SDK bypassa rules y el endpoint ya demostró que podía actuar con datos del body. Además, una ruta de mutación que responde éxito sin consultar el documento persistido no puede demostrar qué sesión se cerró.

### B. Cerrar la sesión canónica en una transacción server-side — propuesta

El cliente envía únicamente `sessionId`. El servidor exige membresía, lee el documento persistido en una transacción, autoriza al propietario o a un rol de rescate canónico (`admin`, `gerente`, `supervisor`, `prevencionista`, `director_obra`, `medico_ocupacional`), y aplica `status=ended`, `endedAt` generado por servidor, `endedBy` y la eliminación de campos de capability en una sola actualización atómica. Una sesión ya terminada se devuelve como replay idempotente sin reescritura.

### C. Deshabilitar completamente end-session

**Rechazada para esta fase.** El trabajador debe poder finalizar su protección y un coordinador autorizado debe poder cerrar una sesión operativa legítima. Deshabilitarlo conserva seguridad a costa de dejar sesiones abiertas y no materializa la capacidad existente.

## Proposed decision

Adoptar la opción B en `src/server/routes/loneWorker.ts`.

### Request contract

```json
{
  "sessionId": "<id persistido>",
  "endedAt": "<deprecated; validado pero ignorado>"
}
```

El objeto `session` completo se rechaza mediante schema estricto. El hook cliente expone solo `{ sessionId }`; el widget usa el id de la sesión activa.

### Authorization

1. `verifyAuth` establece el actor.
2. `assertProjectMember` exige pertenencia al proyecto.
3. El documento leído establece `workerUid` y el resto de la sesión.
4. El propietario puede cerrar su sesión.
5. Un actor no propietario necesita `admin=true`, `isAdminRole(role)` o `isSupervisorRole(role)` desde el token verificado.
6. El rol `platform_operator` no obtiene autoridad por sí solo.

### Transaction and replay

- Documento inexistente: `404 session_not_found`.
- Miembro sin autoridad sobre la sesión: `403 forbidden_not_session_owner_or_rescuer`.
- Sesión inválida: `409 lone_worker_session_invalid`.
- Sesión activa: transición atómica y revocación de capability.
- Sesión ya terminada con `endedAt`: `200` con el documento canónico, sin reescritura.
- El timestamp enviado por el cliente no controla el resultado; la respuesta refleja el timestamp server-side.
- `Idempotency-Key` se conserva: su middleware incluye fingerprint de body y devuelve `422` si se reutiliza con parámetros distintos; la transacción aporta idempotencia natural por estado.

## Security and life-safety impact

| Threat | Control | Evidence gate |
|---|---|---|
| Member closes another worker | owner-or-rescue check after persisted read | route test with member, supervisor, admin and platform_operator |
| Forged `workerUid`/full session | strict request schema + canonical Firestore document | legacy payload `400`; persisted worker remains authoritative |
| Capability survives a close | capability fields deleted in same transaction as terminal state | Native ManDown route test after close returns `409` |
| Client controls end time | `endedAt` generated server-side | future timestamp test |
| Cross-project actor | membership gate plus project-scoped reference | rules suite + non-member route test |
| Audit outage blocks help | best-effort audit after committed transition | audit failure regression test remains required |

## Operations, migration and rollback

- Existing persisted sessions keep their shape; `endedBy` is additive.
- Existing clients sending `{ session }` receive `400` rather than a silent, unsafe close. The current in-repo widget is migrated in the same change.
- Rollback of the code must not re-enable the old endpoint without restoring the owner/rescue gate; any rollback should be reviewed against this ADR.
- Cloud Scheduler is not the writer for this endpoint. Production verification must still exercise Firebase Auth, Admin SDK, Firestore transaction and native capability on a deployed environment.

## Verification gates

- `npx vitest run src/__tests__/server/loneWorker.router.test.ts src/__tests__/server/loneWorkerNativeManDown.router.test.ts src/pages/LoneWorker.test.tsx`
- `npx vitest run src/server/middleware/idempotencyKey.test.ts src/services/loneWorker/loneWorkerService.test.ts src/server/jobs/runLoneWorkerEscalation.test.ts`
- `npm run typecheck`
- `npm run lint:rules:raw && npm run lint:rules && npm run test:rules`
- Adversarial probes: no member, member without rescue role, every canonical rescue role, `platform_operator`, missing doc, replay, forged payload, future/invalid timestamp, capability after close, and idempotency-key parameter mismatch.
- Device/deployed evidence remains separate: this ADR and unit/emulator tests do not certify a physical Android run.

## Consequences

### Positive

- Admin SDK path now has an explicit authorization boundary.
- Worker and rescue flows remain available; no capability is removed from the product.
- Session history and terminal actor are retained for audit and incident review.
- Native ManDown authority is revoked atomically with the state transition.

### Negative / residual

- Closing a session now requires the session document to exist; an offline client with only an unpersisted local object must retry after persistence rather than claim success.
- Firebase token role claims may be stale until role rotation revokes tokens; this remains an operational dependency.
- Real Firestore transaction contention and deployed Auth/Rules integration still require environment evidence.

## References

- `src/server/routes/loneWorker.ts:49-59, 114-166, 704-817`
- `src/hooks/useLoneWorker.ts:117-140`
- `src/components/loneWorker/LoneWorkerCheckInWidget.tsx:89-100`
- `src/pages/LoneWorker.tsx:251-287`
- `firestore.rules:1005-1025`
- `src/types/roles.ts:16-33, 68-78`
- `src/server/middleware/idempotencyKey.ts:107-111, 234, 277-303`
- `src/__tests__/server/loneWorker.router.test.ts`
- `src/__tests__/server/loneWorkerNativeManDown.router.test.ts`
