# NlQueryPanel — Aislamiento de contexto (proyecto / identidad / sesión)

Ticket: `3ebaa66d-73fe-8180-ad86-d56163a28784` ([P1][Frontend/ZK] NlQueryPanel conserva
incidentes del proyecto anterior y aplica respuestas tardías).
Rama: `a41/nlquery-context-m31` · Base: `18acc961945a0c3d8e96e7554b044d53bfb7d31d`.

Este documento fija el **contrato observable** del panel, **qué** lo cubre cada prueba y
**qué NO** cubren. Es documentación de frontend con dobles de test; no certifica el
aislamiento real del servidor.

---

## 1. Contrato

### 1.1 Estado local y epoch de contexto

`NlQueryPanel` mantiene `results`, `citations`, `matches`, `structuredSearched`, `error` y
`loading` en estado local (`PanelState`). Ese estado está atado a un **token de contexto**:

```
contextToken = `${projectId ?? ''}|${identityUid}|${identityPresent ? '1' : '0'}|${isAuthReady ? '1' : '0'}`
```

Cuando el token cambia, se abre un **epoch** nuevo (`epoch++`, monotónico) y el panel se
vacía (`EMPTY_PANEL`). Consecuencias garantizadas:

| Transición | Efecto |
|---|---|
| proyecto A → B | se descartan results/citations/matches/error de A |
| A → B → A | volver a A **no** revive los resultados de A (el epoch sigue creciendo) |
| A → null → B | nada de A sobrevive al hueco de sesión |
| logout (user → null) | se descartan resultados, coincidencias y **borradores** |
| login con otra uid | se descartan resultados y borradores; la petición en vuelo se aborta |

El epoch nunca baja. La identidad es la API real `useFirebase()`
(`src/contexts/FirebaseContext.tsx`): `user?.uid` + `isAuthReady`. **No** existe
`AuthContext` ni `sessionVersion`; no se inventaron.

### 1.2 Ciclo de vida de una petición

Cada consulta abre una `ActiveRequest` con:

- `id` (monotónico, marca `reqId` del estado),
- `epoch` (contexto en el que nació),
- `controller` (`AbortController`, expone `signal` al `fetch`),
- `timeoutId` (deadline de 20 s, `QUERY_TIMEOUT_MS`).

**Guardas de liveness.** `isLive(req)` es `mounted && !req.invalidated && activeReqRef === req`.
Se evalúa **después de cada await relevante**:

1. `await apiAuthHeader()` — si el contexto cambió mientras se esperaban credenciales,
   la petición **ni siquiera sale a la red** (no se llama `fetch`).
2. `await fetch(...)` — respuesta tardía ⇒ se descarta.
3. `await res.json()` (cuerpo de éxito) — cuerpo tardío ⇒ se descarta.
4. `await res.json()` (cuerpo de error) — error tardío ⇒ se descarta, **no** se muestra ni
   se loguea.

Un transporte que **ignora** `abort` tampoco puede aplicar un success/error/finally viejo,
porque el guard de liveness es independiente del `AbortController`. Un `AbortError` producido
por el abort del propio panel no se muestra como error al usuario.

**Spinner y `finally`.** El estado de carga va marcado por `reqId`, no por un booleano
global: el `finally` de una petición invalidada no apaga el spinner de una petición más
nueva. `commit()` exige `prev.epoch === req.epoch && prev.reqId === req.id`.

**Abort.** `invalidateRequest()` marca la petición inválida, **limpia el timer del deadline**
y aborta el `AbortController`. Se llama al: (a) cambiar el contexto, (b) desmontar el panel,
(c) abrir una petición más nueva. Un unmount con el transporte colgado deja **0 timers
vivos**.

### 1.3 Modo estructurado

`Enter` en el input de patrón respeta el mismo `disabled` que el botón: con una consulta en
curso no se abre una segunda petición. El estado `matches` es tan local como `results` y se
invalida con el mismo epoch.

### 1.4 Privacidad del rótulo de contexto

El rótulo `data-testid="nl-query-context"` muestra `Contexto: <nombre> (<id>)` del proyecto
seleccionado **solo con identidad válida**. Sin identidad (`user === null` o
`isAuthReady === false`) muestra `Contexto: Sesión no válida` y **no** expone ni el nombre
ni el id del proyecto: tras un logout el panel no puede delatar el proyecto de la sesión
anterior. El rótulo nunca afirma membresías, roles ni permisos.

Los borradores (`query` / `pattern`) se limpian al cambiar la identidad, pero **no** al
cambiar sólo de proyecto: una búsqueda válida del mismo usuario sobrevive a un cambio de
proyecto (el epoch invalida los *resultados*, no la *intención*).

---

## 2. Qué prueba cada suite (y qué NO)

### 2.1 `src/components/zettelkasten/NlQueryPanel.context.test.tsx` — 33 tests, frontend

**Capa probada:** componente React en jsdom con **dobles de test**:
`ProjectContext` (proyecto), `FirebaseContext` (identidad), `lib/apiAuth` (credenciales) y
`fetch` global. `logger` también está mockeado.

**SÍ cubre:** contrato de epoch/liveness/abort/privacidad descrito arriba, en ambos modos
(semántico y estructurado).

**NO cubre (y no se afirma que cubra):**

- login real de Firebase ni obtención de token real — `apiAuthHeader` es un doble;
- reglas de Firestore / Realtime Database;
- aislamiento real del backend entre tenants;
- ACLs de `verifyAuth` / `assertProjectMember`;
- producción.

### 2.2 Suites backend (`npm run test:ci`, sin modificar)

| Suite | Capa real que prueba |
|---|---|
| `src/__tests__/server/zettelkastenNlQuery.test.ts` | Router Express **real** de `zettelkasten.ts` vía supertest + fakeFirestore. 401 sin token, 400 payload inválido, **403 no miembro (la búsqueda ni se intenta)**, scoping por `tenantId` resuelto desde `projects/{id}.tenantId` (no `projectId`), 404 sin tenantId. `verifyAuth` está mockeado por header `x-test-uid` ⇒ **no es login real**. |
| `src/__tests__/server/zettelkasten.structuredQuery.test.ts` | Router real. 401, 400 Zod, 400 `invalid_pattern`, 403 no miembro, 404 sin tenantId, y consultas 200 con filtrado por `severity`, dirección invertida y grafo vacío. `assertProjectMember` mockeado en parte ⇒ **no es ACL real**. |
| `src/services/auth/projectMembership.test.ts` | `assertProjectMember` contra fakeFirestore: miembro, `createdBy`, doc ausente, no miembro, `members` ausente, y propagación de errores de Firestore (fail-closed). |
| `src/server/middleware/verifyAuth.test.ts` | `verifyAuth`: guard de producción (NODE_ENV=production + E2E_MODE ⇒ throw), parsing `Bearer`, casos límite del header E2E, edad de sesión 8 h, `MAX_SESSION_HOURS`. Tokens sintéticos; **no hay verificación contra Firebase real**. |
| `src/server/routes/zettelkasten.getEdges.test.ts` | Ruta `/edges`: auth + pertenencia + scoping tenant. |
| `src/server/routes/incidentFlow.audienceMembership.test.ts` | Membresía/audiencia en el flujo de incidentes. |

**Reglas Firestore:** `src/rules-tests/**` queda **fuera** de `test:ci` (excluido por
config) y requiere `npm run test:rules` con emulador Firestore (JDK 21). No se ejecutó en
este slice: emuladores fuera de alcance.

---

## 3. Límites explícitos

- Nada de esto demuestra ni descarta un bypass de backend. `verifyAuth` y
  `assertProjectMember` son fronteras de autorización del servidor; las reglas
  controlan acceso cliente y no restringen las escrituras Admin SDK. Este slice
  no certifica el aislamiento global del backend.
- Los tests de frontend pasan con dobles: un doble mal escrito puede dar un falso GREEN.
- `isAuthReady` debe ser explícitamente `true` y existir usuario: un flag ausente
  falla cerrado, sin consultas ni rótulo privado. Ambos modos tienen regresión.
- El rótulo de contexto no sustituye a la auditoría de membresía: no afirma roles.

---

## 4. Comandos

```bash
# Frontend (focal)
npm run test:ci -- src/components/zettelkasten/NlQueryPanel.context.test.tsx

# Frontend (carpeta completa del panel)
npm run test:ci -- src/components/zettelkasten/

# Backend/auth/membership (sin modificar)
npm run test:ci -- \
  src/__tests__/server/zettelkastenNlQuery.test.ts \
  src/__tests__/server/zettelkasten.structuredQuery.test.ts \
  src/services/auth/projectMembership.test.ts \
  src/server/middleware/verifyAuth.test.ts \
  src/server/routes/zettelkasten.getEdges.test.ts \
  src/server/routes/incidentFlow.audienceMembership.test.ts
```

Node: `C:/Users/Usuario/AppData/Local/hermes/tools/node-26.12.1-win32-x64/node.exe` +
su `npm-cli.js`.
