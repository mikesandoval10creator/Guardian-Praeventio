# ADR 0027 — Límite de tenant para operaciones ARCO administrativas

- Status: Proposed
- Date: 2026-09-07
- Deciders: Daniel Sandoval (pending explicit approval)
- Related: Alpha 41 `3c3aa66d-73fe-81a3-b3cf-f4a61a917009`, ADR-0026, `Auditoria-ARCO-Tenant-2026-08-30.md`

## Context

Los endpoints administrativos de ARCO procesan solicitudes de acceso/portabilidad
y ejecutan borrado aprobado:

- `POST /api/compliance/admin/data-request/:id/process`
- `POST /api/compliance/admin/data-request/:id/erase`

El gate existente revalidaba `role=admin` desde Firebase Auth, pero no vinculaba
el `uid` de la solicitud con el tenant del administrador. Un administrador de
`tenant-a` que conociera el `requestId` de una solicitud perteneciente a
`tenant-b` podía iniciar procesamiento o borrado mediante Admin SDK, que no pasa
por las reglas de Firestore del cliente.

## Invariantes y drivers

1. Un administrador de empresa solo puede actuar dentro de su tenant.
2. Ni el body ni el rol/tenant declarado por el cliente pueden sustituir a Auth
   custom claims re-leídos server-side.
3. Una solicitud inexistente debe continuar devolviendo `404` sin revelar datos.
4. Un target sin tenant y un caller sin tenant deben fallar cerrado (`403`).
5. La defensa debe cubrir tanto acceso/portabilidad como borrado.
6. El flujo legítimo same-tenant y la idempotencia de ARCO deben conservarse.
7. El cambio no debe relajar `firestore.rules` ni bloquear el self-service
   `account/anonymize`, que tiene una superficie y autorización distintas.

## Opciones consideradas

### A. Mantener solo el gate de rol

Rechazada. Autenticación y rol no expresan pertenencia al cliente afectado; el
hallazgo P0 seguiría abierto.

### B. Confiar en `tenantId` enviado por body o token del cliente

Rechazada. Permite spoofing y contradice la fuente server-authoritative de Auth.

### C. Duplicar una comparación en cada endpoint ARCO

Rechazada como solución permanente. Reduce el bug inmediato, pero permite que
las superficies administrativas deriven en mensajes, manejo de target o política.

### D. Helper compartido server-side de intersección de tenant — propuesta

Elegida. `src/server/auth/tenantAuthorization.ts` re-lee caller y target desde
Firebase Auth, niega tenant ausente o distinto, y es reutilizado por `admin.ts`
y `compliance.ts`.

## Decisión propuesta

Usar `assertTargetInCallerTenant(res, callerUid, targetUid)` después de cargar el
recurso objetivo y antes de cualquier mutación o auditoría de la operación.

El helper:

- obtiene ambos usuarios con Admin SDK;
- compara `customClaims.tenantId` del caller y target;
- deniega si el target no existe, si falta cualquiera de los tenants o si son
distintos;
- deja intacta la regla de `isAdminRole` y no crea un rol global implícito.

Los endpoints ARCO pasan `existing.uid` como target. El `requestId` del URL solo
identifica la solicitud; nunca define autorización por sí mismo.

## Seguridad y privacidad

**Trust boundary:** `verifyAuth` autentica; `assertAdminCaller` revalida rol;
`assertTargetInCallerTenant` revalida el límite organizacional; los servicios ARCO
mutan solo después de ambos controles.

**Abuse cases cubiertos:**

- admin tenant-a → request tenant-b: `403`, sin cambio ni auditoría;
- admin tenant-a → target sin tenant: `403`, sin cambio;
- admin sin tenant → target tenant-a: `403`, sin cambio;
- worker que declara `admin` en el token cliente: continúa `403` por el gate de
  Auth;
- admin same-tenant: conserva acceso, portabilidad, borrado e idempotencia.

**Riesgo residual:** Auth custom claims pueden estar desactualizados respecto de
un sistema externo de membresías; este ADR define Auth como autoridad vigente para
las operaciones admin existentes. La provisión/rotación de claims y el rol
`platform_admin` global quedan fuera de este cambio.

## Operación, migración y rollback

No requiere migración de datos: solo se leen claims existentes. Antes de marcar
el ticket `Verified` todavía debe ejecutarse una prueba de integración con Auth y
Firestore desplegados, incluyendo dos tenants reales y una solicitud cruzada.

Rollback seguro: revertir el commit del PR restaura el helper privado en `admin.ts`
pero reabre el P0 ARCO; no debe hacerse como workaround operativo. El cambio es
reversible porque no altera shapes persistidas ni borra registros adicionales.

## Gates de aceptación

- [ ] Test real-router de `process`: tenant-a no procesa request de tenant-b.
- [ ] Test real-router de `erase`: tenant-a no borra request de tenant-b.
- [ ] Tests fail-closed de caller/target sin `tenantId`.
- [ ] Same-tenant access, erase e idempotencia siguen verdes.
- [ ] `admin.router.test.ts` conserva revoke/set-role/webauthn tenant guard.
- [ ] `npm run typecheck` y ESLint sin errores.
- [ ] CI required checks verdes; Stryker Linux revalidado.
- [ ] Integración Auth/Firestore desplegada y evidencia cross-tenant sin secretos.
- [ ] Daniel aprueba elevar esta ADR a `Accepted`.

## Archivos y contratos afectados

- `src/server/auth/tenantAuthorization.ts`
- `src/server/routes/admin.ts`
- `src/server/routes/compliance.ts`
- `src/__tests__/server/complianceArco.test.ts`

No se modifican `firestore.rules`, la política de retención, el self-service de
cuenta ni proveedores externos.

## Referencias

- `src/server/routes/admin.ts:197-199,285-287,352-354`
- `src/server/routes/compliance.ts:485-500,502-550,552-651`
- `src/__tests__/server/admin.router.test.ts:171-221`
- `src/__tests__/server/complianceArco.test.ts`
- Notion `3c3aa66d-73fe-81a3-b3cf-f4a61a917009`
- `C:/Users/Usuario/Obsidian/Segundo-Cerebro/01-Guardian/Auditoria-ARCO-Tenant-2026-08-30.md`
