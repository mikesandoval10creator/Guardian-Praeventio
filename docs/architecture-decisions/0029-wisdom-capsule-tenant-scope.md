# ADR 0029 — Scope tenant/project para WisdomCapsules

- Status: Proposed
- Date: 2026-09-07
- Deciders: Daniel Sandoval (pending explicit approval)
- Related: Notion `3cdaa66d-73fe-819f-8944-d54f9416a259`, TM-T07,
  `Barrido-E7c-Wisdom-Capsules-2026-08-31.md`

## Context

`wisdomCapsules` es una colección top-level consumida por
`useWisdomCapsules` y mostrada por `WisdomCapsuleWatcher`. El lector anterior
hacía un `getDocs(collection(db, 'wisdomCapsules'))` sin `tenantId`,
`projectId` ni límite. La regla permitía el read a cualquier usuario con email
verificado, aunque el resto de Guardian usa membresía de proyecto y claims de
tenant como boundary.

No se encontró un writer productivo para esta colección. Por ello existen dos
problemas distintos: impedir lecturas cross-tenant ahora y definir una forma
segura para futuros writers/migración de documentos legacy.

## Invariantes y drivers

1. Un usuario solo puede leer cápsulas cuyo `tenantId` coincide con su custom
   claim y cuyo `projectId` pertenece a ese tenant y proyecto miembro.
2. La ausencia de tenant claim, proyecto seleccionado o stamps persistidos debe
   fallar cerrado; no se sustituye Auth por body/query del cliente.
3. La query debe estar acotada (`limit(100)`) y nunca descargar la colección
   completa.
4. Datos malformed, no finitos, fuera de rango u oversized no llegan al
   overlay de seguridad.
5. Admin/supervisor puede escribir solo dentro de su tenant y no puede cambiar
   tenant/project en un update.
6. La decisión no debe convertir una cápsula local en una autorización de
   emergencia ni afirmar que existe una fuente operativa de despacho.

## Options considered

### A. Mantener la colección top-level y filtrar solo en el cliente

Rechazada. Un actor podría leer todos los documentos antes del filtro y la rule
no tendría una condición demostrable para una query cross-tenant.

### B. Mover inmediatamente a `tenants/{tenantId}/projects/{projectId}/wisdomCapsules`

No elegida como primer cambio. Es un diseño fuerte para un writer nuevo, pero
requiere migración de documentos legacy, actualizar todos los writers no
localizados y coordinar índices/rollback. Se mantiene como evolución posible.

### C. Endpoint server-side que materializa cápsulas autorizadas

No elegida ahora. Añade una segunda superficie de autorización y no resuelve
la colección legacy sin identificar el writer. Puede evaluarse si las cápsulas
pasan a contener contenido sensible o necesitan ranking server-side.

### D. Query top-level tenant+project + rule vinculada — propuesta

Elegida como contención compatible: conservar el nombre de colección, exigir
los dos stamps en query/rules, validar shape en writes y filtrar records
malformed en el hook. La ausencia de stamps legacy se trata como no legible,
no como wildcard.

## Proposed decision

Mantener `wisdomCapsules` top-level durante la transición, con este contrato:

- `useWisdomCapsules({ tenantId, projectId })` no ejecuta Firestore si falta
  cualquiera de los dos valores.
- Firestore usa `where('tenantId', '==', tenantId)`,
  `where('projectId', '==', projectId)` y `limit(100)` más el índice compuesto.
- `WisdomCapsuleWatcher` obtiene `tenantId` de `useTenantId` y `projectId` de
  `useProject`; además no renderiza overlay sin ambos.
- `firestore.rules` compara el stamp del recurso con el claim, comprueba
  `projectTenantId(projectId)` y `isProjectMemberTenantScoped(projectId)`.
  Create/update exigen rol de administración, shape bounded y stamps
  inmutables; delete conserva admin y el mismo boundary.
- El hook valida nuevamente tenant/project, título/contenido, coordenadas,
  radius y strings opcionales antes de exponer datos al UI.

El documento canónico futuro debe contener como mínimo:
`tenantId`, `projectId`, `title`, `content`, `lat`, `lng`, `radius`; los campos
opcionales tienen límites explícitos. Legacy sin ambos stamps permanece
invisible hasta una migración revisada.

## Security and privacy impact

El trust boundary queda: Firebase Auth custom claim → `useTenantId`/rules;
ProjectContext → query/rule membership; Firestore → resultado bounded; parser
cliente → defensa de shape antes de GPS/overlay. Una query manipulada no puede
ensanchar la lectura porque la rule evalúa cada recurso y su proyecto.

Abuse cases cubiertos por tests de emulator:

- member de tenant A lee su proyecto A: permitido;
- member de tenant B, outsider y no-auth leen proyecto A: denegado;
- admin de tenant A opera dentro de A: permitido;
- admin/caller cross-tenant o stamps spoofed: denegado;
- contenido oversized/coordenadas inválidas: write denegado y read client
  descartado.

Riesgo residual: Admin SDK bypasses client rules, por lo que cualquier writer
server-side futuro debe llamar un helper equivalente y estampar Auth-derived
values. Auth claims desplegados y documentos legacy aún no han sido validados
en dos tenants reales.

## Performance and operations

La query requiere un composite index tenantId+projectId y devuelve como máximo
100 documentos. El hook cancela resultados de un scope anterior para no
mostrar cápsulas del proyecto previo. El cambio no es una migración ni garantiza
que exista contenido actualizado: solo limita y valida lo que ya está en la
colección.

## Migration and rollback

No se migran documentos con este cambio. Operaciones futuras deben enumerar
legacy sin `tenantId/projectId`, asignar ownership con evidencia y validar dos
tenants antes de hacerlos visibles. No se debe rellenar stamps por inferencia
client-side.

Rollback técnico: revertir la rule/hook/index reabre el riesgo de lectura
cross-tenant y no es un workaround aceptable en producción. Si el deploy falla,
se debe mantener el deny-by-default y corregir índices/claims; no volver a
`allow read: if isEmailVerified()`.

## Verification gates

- [x] Hook scoped query/limit/filter tests: 5/5.
- [x] Watcher scope/no-overlay tests: incluidos en 5/5.
- [x] Firestore Emulator member/outsider/no-auth/admin/spoof matrix: 13/13.
- [x] `npm run typecheck`, lint, i18n, conventions y router ratchet locales.
- [x] Threat model entry TM-T07 y index JSON validado.
- [ ] CI required checks verdes y Stryker Linux antes de merge.
- [ ] Deploy controlado con dos tenants/Auth claims reales.
- [ ] Inventario/migración de legacy y writer server-side identificado.
- [ ] Daniel aprueba elevar esta ADR a `Accepted`.

## Consequences

Positivas: se elimina el full collection read del cliente, rules y query
comparten boundary, el UI falla cerrado y la autorización queda auditable.

Negativas: usuarios sin claim tenant o proyectos no seleccionados dejan de ver
cápsulas; legacy sin stamps requiere migración; aparece un índice adicional y
los writers futuros deben respetar el contrato.

## Files and contracts affected

- `src/hooks/useWisdomCapsules.ts`
- `src/components/shared/WisdomCapsuleWatcher.tsx`
- `firestore.rules`
- `firestore.indexes.json`
- `src/hooks/useWisdomCapsules.test.ts`
- `src/components/shared/WisdomCapsuleWatcher.test.tsx`
- `src/rules-tests/wisdomCapsules.rules.test.ts`
- `docs/security/THREAT_MODEL.md`
- `docs/security/STRIDE_findings.md`

## References

- Notion ticket `3cdaa66d-73fe-819f-8944-d54f9416a259` (live status `Spec'd`).
- `C:/Users/Usuario/Obsidian/Segundo-Cerebro/01-Guardian/04-BARRIDO-BACKEND/Barrido-E7c-Wisdom-Capsules-2026-08-31.md`.
- `src/server/auth/projectMembership.ts`.
- `firestore.rules` helpers `projectTenantId` and
  `isProjectMemberTenantScoped`.
