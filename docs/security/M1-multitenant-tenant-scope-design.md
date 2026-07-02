# M-1 — Aislamiento multi-tenant del modelo `/projects` (diseño de seguridad)

**Fecha:** 2026-07-01 · **Estado:** FASE 1+2 IMPLEMENTADAS (esta rama / PR #1163) · fase 3 (enforcement de reglas) PENDIENTE.
**Fase 1** = stamping (onboarding/ProjectContext) + preservación de claims en set-role. **Fase 2** = backfill: `node scripts/backfill-project-tenantid.cjs` (dry-run por defecto; `--live` ejecuta) — estampa `tenantId=createdBy`, acuña el claim `tenantId=uid` preservando claims existentes, y sana los namespaces legacy `tenants/{projectId}` copiando sus subcolecciones al namespace definitivo. Convención confirmada por el fundador 2026-07-02: **tenantId = createdBy**. La fase 3 (endurecer get/list/update/delete + master gate + query admin del cliente + anti-spoof `incoming().tenantId == request.auth.uid`) se despliega DESPUÉS de correr el backfill en producción — ver §6.
**Vulnerabilidad:** fuga cross-tenant — roles GLOBALES admin/gerente/supervisor cruzan la frontera de tenant en `/projects/{id}` (get, list, update, delete y todas las subcolecciones vía el master gate).

---

## 0. El hallazgo decisivo

**Hoy la app es, de hecho, single-tenant-per-user.** `onboarding.ts:165` fija `const tenantId = uid` — **el tenant ES el uid del dueño**. Y **ningún usuario en producción tiene un claim `tenantId`** (grep de `setCustomUserClaims`: solo `{ role }`). La capa `/tenants/**` está bien aislada, pero el modelo operativo `/projects` es member-based y el rol global cruza todo.

**Implicancia:** M-1 no es "parchar una regla" — es **construir el aislamiento multi-tenant de verdad** (tenantId en proyectos + claims de tenant + reglas scoped). Es fundacional para el modelo SaaS compartido que confirmaste. Bien hecho, cada estado intermedio *falla cerrado* (nunca abre una fuga).

---

## 1. Dónde cruza el rol global (firestore.rules, bajo `match /projects/{projectId}`, L352+)

| Op | Línea | Fuga | Motivo |
|---|---|---|---|
| get | 364-369 | SÍ | `isAdmin()` / `isSupervisor()` globales |
| list | 376-379 | SÍ | `token.role in ['admin','gerente']` lista TODOS los proyectos de TODOS los tenants |
| update | 381 | SÍ | `isAdmin() || isSupervisor()` globales |
| delete | 382 | SÍ | `isAdmin()` global |
| subcolecciones (master gate) | 385-387 | SÍ | `isProjectMember` → ramas admin/supervisor globales → lee reports, safety_posts, mandown, PII médica de CUALQUIER tenant |
| attendance/reports/safety_posts | 398/403/408/412 | SÍ | `isSupervisor() || isAdmin()` explícitos globales |

Helpers ya existentes y correctos (reusar): `isMemberOfTenant(tid)` (L74), `isSupervisorOfTenant(tid)` (L83, incluye tier admin). El doc de `/projects` **hoy NO tiene `tenantId`** (`isValidProject` L190 no lo incluye → un write con tenantId sería rechazado).

---

## 2. El fix de reglas (mecánico — QUITA privilegio, preserva member/creator)

Nuevo helper (tras L129):
```
function projectTenantId(pid) {
  return get(/databases/$(database)/documents/projects/$(pid)).data.get('tenantId','');
}
function isProjectMemberTenantScoped(pid) {
  return isEmailVerified() && (
    request.auth.uid in get(/databases/$(database)/documents/projects/$(pid)).data.members ||
    isProjectCreator(pid) ||
    isSupervisorOfTenant(projectTenantId(pid))   // supervisor/admin DE ESTE tenant, no global
  );
}
```
- **get** (364): `uid in members || createdBy==uid || isSupervisorOfTenant(resource.data.tenantId)`.
- **update** (381): `(createdBy==uid || isSupervisorOfTenant(existing().tenantId)) && isValidProject(incoming()) && incoming().tenantId==existing().tenantId` (inmutable).
- **delete** (382): creator, o admin-tenant (`isSupervisorOfTenant + token.role in ['admin','gerente']`).
- **master gate** (386): `isProjectMemberTenantScoped(projectId)`.
- subcolecciones 398/403/408/412: cambiar `isSupervisor()||isAdmin()` global por `isSupervisorOfTenant(projectTenantId(projectId))`.

---

## 3. La parte DIFÍCIL — la regla `list` (L376)

Firestore evalúa `list` contra *constraints*, **no puede llamar get()**. El tenant debe venir del **token** y matchearse con un **filtro de query**:
```
allow list: if isEmailVerified() && (
  request.auth.uid in resource.data.members ||
  (request.auth.token.role in ['admin','gerente']
    && request.auth.token.tenantId is string
    && resource.data.tenantId == request.auth.token.tenantId)   // fuerza where('tenantId','==',claim)
);
```
**Cambio de cliente obligatorio** (`ProjectContext.tsx:276`): el branch admin pasa de `query(collection('projects'))` (cross-tenant, ahora DENEGADO) a `query(..., where('tenantId','==', tenantClaim ?? user.uid))`. Requiere índice single-field en `tenantId`.

**Límite honesto:** el claim multi-tenant (`token.tenants` map) NO se puede expresar en `list` (no indexás una key de map). Solo el claim single-tenant `token.tenantId` funciona para list. Como el modelo hoy es single-tenant-per-user, es aceptable — documentar como limitación conocida.

---

## 4. Schema + servidor + migración

- **Schema** (`isValidProject` L190): agregar `tenantId` a `hasOnly` + `hasAll`, validar `string, 1..128`.
- **create** (380): `incoming().tenantId == request.auth.uid` (con tenantId===uid, el cliente no puede forjar un tenant ajeno).
- **Servidor:** `onboarding.ts:249` agregar `tenantId: uid` (1 línea, el valor ya está en scope). `ProjectContext.tsx:225-230 y 211-217` agregar `tenantId: user.uid`.
- **admin.ts:353 (CRÍTICO):** hoy `setCustomUserClaims(uid,{role})` **PISA todos los claims**. Cambiar a `{...existingClaims, role}` — si no, un cambio de rol borra el `tenantId`.
- **Migración** (`scripts/backfill-project-tenantid.cjs`, Admin-SDK, idempotente, `--dry-run`, audit_log): `tenantId = createdBy` para cada doc sin tenantId (docs sin createdBy → reporte manual, no adivinar). + job para setear claim `tenantId=uid` a todos los usuarios.

---

## 5. Rules-tests (≥5, CLAUDE.md #4) — extender `projectsRead.rules.test.ts`

1. **CLAVE M-1:** admin con claim `tenantId:'t1'` es DENEGADO leyendo `projects/PROJECT_B` (tenant t2). *(Invierte el falso-positivo actual L125-127.)*
2. Creator lee su proyecto → allow.
3. Supervisor same-tenant (t1) lee PROJECT_A (t1) → allow.
4. Outsider (no member) → deny.
5. Create sin tenantId (o blank) → deny (schema).
6. Create con tenantId ajeno (≠ uid) → deny (anti-spoof).
7. Update cambiando tenantId t1→t2 → deny (inmutable).
8. **List:** admin t1 con query sin filtro → deny; con `where('tenantId','==','t1')` → allow.
9. Master-gate: admin t1 lee `projects/PROJECT_B/reports/r1` → deny.

+ entrada Dirty Dozen en `security_spec.md`.

---

## 6. Riesgo + orden de rollout (cada paso FALLA CERRADO)

**Blast radius grande:** toda subcolección pasa por el master gate. **Vida-crítico (ADR 0021):** SOS/emergencia/ManDown/evacuación deben seguir funcionando para MEMBERS — el fix preserva la rama `uid in members[]` primero, así que un member no se ve afectado; solo se quita el atajo de rol global. Verificar el E2E de SOS verde.

**Orden recomendado (prerequisitos, NO afterthoughts):**
1. **Fix `admin.ts` (preservar claims) + stampeo de `tenantId`** en onboarding/ProjectContext. Backward-compatible, no enforcea nada aún.
2. **Migración:** backfill de docs (`tenantId=createdBy`) + backfill de claim (`tenantId=uid`). Verificar lista needs-review vacía.
3. **Reglas endurecidas + cambio de query admin en ProjectContext + rules-tests**, desplegados JUNTOS, con emulador verde.
4. Monitorear `permission-denied` en `/projects` 24-48h.

**Riesgo #1 — el claim gap:** hoy ningún usuario tiene claim `tenantId`. Si la regla `list` se despliega ANTES del backfill de claims, la lista de todo admin vuelve vacía (cae al query member-scoped) — regresión de UX (no de seguridad, falla cerrado). Por eso claim-backfill + fix de admin.ts van PRIMERO.

---

## Bottom line
El cambio de reglas (§2) es de bajo riesgo porque *quita* privilegio preservando member/creator. Lo frágil es (1) la regla **list** (sin get(), solo claim single-tenant) y (2) el **claim gap** (nadie tiene claim tenantId hoy → backfill + fix admin.ts son prerequisitos). Con el orden de arriba, todo estado intermedio falla cerrado — cero fuga en cualquier punto.
