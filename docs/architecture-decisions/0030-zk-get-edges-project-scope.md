# ADR 0030 — Consulta project-scoped para ZK get-edges

- Status: Proposed
- Date: 2026-09-08
- Deciders: Daniel Sandoval (pending explicit approval)
- Related: Notion `3cdaa66d-73fe-81e3-bbdf-f11ee6ff1c58`, TM-T08,
  ADR-0029, `Barrido-E7d-Zettelkasten-Graph-Risk-2026-08-31.md`

## Context

`POST /api/zettelkasten/get-edges` autentica al caller y verifica membresía del
`projectId`, pero el adapter `buildEdgeStore(db)` resolvía el tenant y llamaba
`listByTenant(tenantId, limit)`. Esa consulta devuelve aristas de todos los
proyectos bajo el mismo tenant. La respuesta completa incluye pesos, validez y
decay, por lo que el endpoint podía revelar topología y señales de riesgo de un
proyecto vecino aunque no existiera un cross-tenant.

`ZkEdge.projectId` es opcional por compatibilidad con edges legacy y con edges
cuyos endpoints pueden cruzar proyectos. Esa compatibilidad no debe convertirse
en una autorización implícita para el endpoint project-scoped.

## Invariantes y drivers

1. El endpoint responde solo edges con `tenantId` resuelto del proyecto pedido y
   `projectId` exactamente igual al `projectId` autorizado.
2. Auth/membership sigue siendo la autoridad; el body no declara tenant.
3. El límite del request se conserva y el default también debe ser bounded.
4. Edges sin `projectId` no se inventan ni se asignan a un proyecto por sus
   endpoints; quedan fuera de esta respuesta hasta una migración con evidencia.
5. Un adapter que no puede demostrar consulta project-scoped debe fallar cerrado,
   no degradar a lectura tenant-wide.
6. Los callers de mantenimiento que necesitan tenant-wide conservan
   `listByTenant` explícito y separado.

## Options considered

### A. Filtrar `listByTenant` en memoria después de leer el tenant

Rechazada. El response quedaría filtrado, pero el server leería datos ajenos y
un futuro log/cache/error podría cruzar el boundary. Además escala con el
tenant completo y normaliza la degradación insegura.

### B. Cambiar `listByTenant` para aceptar `projectId` opcional

Rechazada. Mezcla semánticas tenant-wide/project-scoped en un método y permite
que callers existentes cambien accidentalmente su alcance.

### C. Hacer `listByProject` obligatorio en todos los mocks/implementers

No elegida como primer paso. Es más estricto, pero obliga a alterar stores de
prueba y callers no relacionados; el endpoint puede exigir la capacidad en su
boundary mientras el resto migra de forma explícita.

### D. Añadir `listByProject` y fallar cerrado si falta — propuesta

Elegida. El adapter Firestore consulta la subcolección tenant con
`where('projectId', '==', projectId)` y límite; `/get-edges` exige esa
capacidad y nunca usa `listByTenant` como fallback. `listByTenant` queda
disponible para operaciones declaradamente tenant-wide.

## Proposed decision

- Extender `EdgeStore` con `listByProject?(tenantId, projectId, limit)` para una
  migración compatible de implementers DI.
- Implementar el método en `edgeStoreFirestore.ts` con filtro Firestore antes
  de materializar documentos.
- En `/get-edges`, usar `limit ?? 2000`, requerir `listByProject` y devolver
  `500 internal_error` si el adapter no ofrece la capacidad.
- Mantener `assertProjectMember`, resolución server-side del tenant y shape
  completo requerido por `RiskNetworkHealth`.
- No incluir edges sin `projectId` en la respuesta project-scoped; no inferir
  ownership desde `fromNodeId`/`toNodeId`.

## Security impact

El boundary queda: `verifyAuth` → `assertProjectMember(projectId)` →
`projects/{projectId}.tenantId` → query tenant path + project equality → response.
La regla de no fallback protege contra regresiones de adapters de prueba o
futuros adapters incompletos.

Abuse cases cubiertos por el gate:

- member de proyecto A pide A y existe edge de B en el mismo tenant: solo A;
- caller no autenticado: 401;
- caller no miembro: 403;
- tenant distinto: no se resuelve/expone;
- limit 1/2000: bounded;
- legacy edge sin projectId: no se atribuye a A.

## Performance and operations

La consulta project-scoped evita descargar el conjunto completo del tenant y
usa el índice single-field automático de `projectId` en la subcolección. El
request continúa limitado a 2000 edges y el logger registra solo caller,
project, tenant y count; no se añaden payloads ni datos de riesgo al log.

## Migration and rollback

No se migran edges legacy con esta ADR. Un job futuro deberá inventariar edges
sin `projectId`, probar la relación de ambos nodos y asignar ownership con
backup/auditoría antes de hacerlos visibles por proyecto.

Rollback técnico: revertir el endpoint al tenant-wide query reabre TM-T08 y no
es un rollback operativo aceptable. Si el adapter project-scoped falla en
producción, la respuesta debe ser error cerrado y alertable, no una lectura
amplia. El método tenant-wide se conserva para jobs explícitos que no sirven a
usuarios de un proyecto.

## Verification gates

- [x] RED router test: dos proyectos en un tenant devolvieron 2 edges antes del
  fix.
- [x] GREEN router focal: 14/14.
- [x] Typecheck/lint/conventions/router ratchet locales.
- [x] TM-T08 queda en ambos threat models como `partial (PR pending)`.
- [ ] CI required checks y Stryker Linux verdes antes de merge.
- [ ] Dos proyectos desplegados del mismo tenant con Auth/membership reales.
- [ ] Inventario de edges legacy sin `projectId` y plan de migración aprobado.
- [ ] Daniel aprueba elevar esta ADR a `Accepted`.

## Consequences

Positivas: el endpoint ya no cruza proyectos del mismo tenant y el contrato
separa claramente mantenimiento tenant-wide de lectura de usuario.

Negativas: legacy edges sin stamp dejan de aparecer en `/get-edges`; adapters DI
incompletos devuelven 500; se requiere una query adicional y disciplina para
writers que deben estampar `projectId`.

## Files and contracts affected

- `src/server/routes/zettelkasten.ts`
- `src/services/zettelkasten/edgeStoreFirestore.ts`
- `src/services/zettelkasten/edges.ts`
- `src/server/routes/zettelkasten.getEdges.test.ts`
- `docs/security/THREAT_MODEL.md`
- `docs/security/STRIDE_findings.md`

## References

- Notion ticket `3cdaa66d-73fe-81e3-bbdf-f11ee6ff1c58` (live `Spec'd`).
- `src/services/zettelkasten/edges.ts:242-259`.
- `src/services/zettelkasten/edgeStoreFirestore.ts:43-49`.
- `src/server/routes/zettelkasten.ts:794-861`.
- `src/server/routes/zettelkasten.getEdges.test.ts` same-tenant isolation case.
