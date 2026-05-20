# ADR 0020 — Peer-to-peer heavy compute intra-tenant vía Google Drive

* **Status:** Accepted (idea founder 2026-05-19, codificada misma sesión)
* **Date:** 2026-05-19
* **Deciders:** Daho Sandoval (founder — propuso el patrón)
* **Related:** ADR 0019 (Google ecosystem foundation), ADR 0005 v3 (photogrammetry pipeline — Fase C3 nueva), ADR 0011 (Digital Twin triple-gate auth), ADR 0013 (Mesh information relay — pattern similar de offload).

## Context

ADR 0005 v3 establece **Fase C1 on-device WASM** como meta principal para photogrammetry (procesamiento en el mismo teléfono que grabó el video, 15-30 min en background, $0 cloud). Pero hay un problema real:

**No todos los teléfonos del trabajador soportan WASM SfM**. Dispositivos con <2 GB RAM, sin WebGPU, batería baja, o Android <8 quedan fuera del path C1. La fallback original era C2 (Cloud Run COLMAP, ~$5/mes a 50 capturas) — Google ecosystem pero con costo cloud.

El founder propuso una alternativa brillante 2026-05-19:

> "En el caso de que no se soporte en algunos dispositivos lo que se puede hacer es que el usuario lo suba al drive de la empresa por ejemplo o a Youtube, lo descarga otro usuario que sí pueda usar su dispositivo con la potencia necesaria y wala se genera el mapa 3D de digital twin. Lo ideal es manejar esto como corresponde por proyecto, si un usuario externo quisiera hacer este proceso mágico no debería poder."

Patrón: **crowdsourced peer-to-peer compute scoped al tenant/project**. El video se mueve por Google Drive (que ya está en el ecosistema + ya tenemos OAuth scope `drive.file`); otro miembro del proyecto con dispositivo capaz lo procesa.

## Decision

### Pipeline: peer-to-peer photogrammetry intra-tenant

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│ User A (weak    │  upload │ Google Drive del │  notify │ User B (capable  │
│ device, captura │ ──────► │ proyecto + meta- │ ──────► │ device, mismo    │
│ video 30s)      │         │ data en Firestore│   FCM   │ proyecto)        │
└─────────────────┘         └──────────────────┘         └─────────┬────────┘
                                     ▲                              │
                                     │                              │ download
                                     │ result upload                │ + process
                                     │                              │ WASM C1
                                     │                              ▼
                            ┌────────┴─────────┐         ┌──────────────────┐
                            │ mesh .glb en     │         │ procesamiento on-│
                            │ Firebase Storage │ ◄────── │ device (15-30 min│
                            │ + ZK node update │  upload │ background)      │
                            └──────────────────┘         └──────────────────┘
```

### Componentes

1. **Upload del video (User A)**
   - Opción primaria: Google Drive del proyecto (folder `Praeventio Guard / Proyectos / <projectName> / Photogrammetry-Pending/`).
   - OAuth scope: `https://www.googleapis.com/auth/drive.file` (ya existe).
   - Metadata adicional en Firestore `tenants/{tenantId}/projects/{projectId}/photogrammetry_jobs/{jobId}`:
     - `videoSource: 'drive'`
     - `driveFileId: <id>` (NO la URL — el fileId es el handle estable)
     - `submittedBy: uid`
     - `submittedAt: serverTimestamp`
     - `siteId: <id>` (contexto en el ZK)
     - `status: 'pending'`
     - `claimedBy: null`
     - `expiresAt: serverTimestamp + 7 días` (purga si nadie procesa)

2. **Notification fanout (Cloud Function trigger)**
   - Cloud Function `onPhotogrammetryJobCreated` corre al insertarse el doc Firestore.
   - Identifica miembros del proyecto con `device_capability_score >= threshold` (ver §"Capability detection" abajo).
   - Publica a FCM topic `tenants/{tenantId}/projects/{projectId}/photogrammetry-capable`.
   - Notification copy: "Hay un video pendiente para reconstrucción 3D del sitio X. Tu teléfono puede procesarlo (~25 min en background). ¿Aceptar?"

3. **Claim del job (User B)**
   - User B abre la notification → la app intenta `runTransaction` Firestore para setear `claimedBy: B.uid` + `status: 'claimed'` SI `claimedBy === null` (optimistic concurrency).
   - Si la transaction falla (otro user claimed primero), la UI muestra "Otro miembro del equipo ya está procesando, gracias".
   - El claim tiene TTL de 1 hora — si User B no transitiona a `'processing'` o `'completed'` en 1 hora, el job vuelve a `pending` y se re-notifica.

4. **Descarga + procesamiento (User B)**
   - User B descarga el video usando `drive.files.get` con `alt=media` (autenticado con su token Drive).
   - Engine WASM (Fase C1 ADR 0005) corre en Web Worker.
   - Service Worker mantiene el job vivo aunque User B cierre la pestaña.
   - Mesh `.glb` se sube a Firebase Storage `digital_twin/{projectId}/{siteId}.glb` (NO a Drive — el mesh es asset del producto, no del usuario).

5. **Cierre del job + ZK update**
   - User B's app actualiza Firestore: `status: 'completed'`, `meshUri: 'gs://...'`, `completedBy: B.uid`, `completedAt: serverTimestamp`.
   - Cloud Function `onPhotogrammetryJobCompleted` crea/actualiza ZK node tipo `slam-mesh` con metadata.
   - User A recibe notification: "Tu reconstrucción 3D del sitio X está lista, generada por [User B]".

### Capability detection — quién es "device capable"

Score calculado en el cliente, cacheado en Firestore `users/{uid}.device_capability_score`:

```typescript
function calculateDeviceCapability(): number {
  let score = 0;
  if (navigator.hardwareConcurrency >= 6) score += 30;
  if ((navigator as any).deviceMemory >= 4) score += 30;
  if ('gpu' in navigator) score += 20; // WebGPU available
  if (window.WebAssembly && WebAssembly.validate) score += 10;
  // Battery threshold check at claim time (no en cálculo del score base)
  return score; // 0-90 max
}
```

Threshold para "capable": `score >= 70`. Refrescado en cada login (devices cambian).

### Decision tree del Fase C (con C3 incluida)

```
Usuario inicia captura video 30s
          │
          ▼
   ¿Tu device es capable (score >= 70)?
   │
   ├─ SÍ ─► Procesa local C1 WASM (15-30 min background) ─► mesh
   │
   └─ NO ─► ¿Hay otros miembros del proyecto con device capable?
            │
            ├─ SÍ ─► Sube video a Google Drive del proyecto (C3 peer-to-peer)
            │       │
            │       └─► User B capable claima + procesa C1
            │
            └─ NO ─► ¿Online?
                     │
                     ├─ SÍ ─► Cloud Run COLMAP C2 (~$5/mes, escape hatch)
                     │
                     └─ NO ─► UI: "Tu equipo no puede procesar esto offline.
                              Conéctate a red para usar Cloud Run." (degrade gracefully)
```

## Seguridad — gate intra-tenant

**Crítico**: el founder dijo "si un usuario externo quisiera hacer este proceso mágico no debería poder". Garantizar esto via:

1. **Firestore rules** sobre `tenants/{tenantId}/projects/{projectId}/photogrammetry_jobs/{jobId}`:
   ```js
   // pseudo-rules
   allow read: if request.auth.uid in projectMembers(tenantId, projectId);
   allow update (claim): if request.auth.uid in projectMembers(tenantId, projectId)
                     && resource.data.claimedBy == null
                     && request.resource.data.claimedBy == request.auth.uid;
   allow update (complete): if request.auth.uid == resource.data.claimedBy;
   allow delete: if false; // only TTL purges
   ```

2. **Drive folder permissions**: el folder `Praeventio Guard / Proyectos / <projectName> / Photogrammetry-Pending/` se crea al onboarding del proyecto con ACL restringida a miembros (Google Workspace lo enforza nativo).

3. **FCM topic subscription**: cliente verifica membership antes de subscribir al topic `tenants/{tenantId}/projects/{projectId}/photogrammetry-capable`. Server-side, el endpoint que registra el topic re-verifica `assertProjectMember`.

4. **Video download authorization**: User B descarga vía Drive API con SU token; si no es miembro del proyecto, Drive responde 403 — sin enforcement adicional en nuestra app.

5. **Mesh upload authorization**: User B sube el mesh a Firebase Storage path `digital_twin/{projectId}/{siteId}.glb` — Storage rules requieren `request.auth.uid in projectMembers(tenantId, projectId)`.

### YouTube como alternativa (descartada como primary)

El founder mencionó YouTube como opción ("o a YouTube"). Análisis:

| Aspecto | Google Drive | YouTube |
|---|---|---|
| Access control granular per-folder | ✅ ACL Drive nativo | ❌ Solo public/unlisted/private — sin permisos por usuario |
| Permanencia | ✅ Indefinido en plan Workspace | ⚠️ YouTube puede flagear video como "reused content" |
| API para download programmatic | ✅ `drive.files.get` con auth | ⚠️ `youtube-dl`-style (TOS gris) |
| Privacy del contenido faena | ✅ Solo miembros | ⚠️ "unlisted" no es privado realmente |
| Costo | $0 (Workspace) | $0 |
| Velocidad upload mobile | ✅ Drive app mobile optimizada | ⚠️ YouTube re-encoda |
| Cumplimiento ADR 0019 | ✅ Google ecosystem | ✅ Google ecosystem |

**Decisión:** Drive es primary. YouTube se descarta — los riesgos de TOS + privacy + re-encoding superan la ventaja de tenerlo como opción. Si Drive falla por cuota (improbable para video 30s típico ~10 MB), la fallback es C2 Cloud Run COLMAP directo.

## Consequences

**Positive:**

- **$0 cloud cost** para el path peer-to-peer (Drive ya está en Workspace plan, mesh upload a Firebase Storage <8 MB).
- **Scales con team size**: equipos con 5+ miembros tienen alta probabilidad de tener al menos 1 device capable.
- **Privacy intra-tenant**: video nunca sale del proyecto, leverages Google ACL existente.
- **UX colaborativa**: refuerza sentido de equipo (User B "ayuda" a User A) — aliñeado con la cultura prevencionista chilena (comité paritario, cuadrilla).
- **Cumple ADR 0019 fully**: Google Drive + Firebase + FCM = ecosistema. WASM SfM = OSS on-device. Cero third-party.
- **Sin GPU externa**: ningún path requiere GPU rental.

**Negative:**

- **Coordinación de equipo necesaria**: si nadie del proyecto tiene device capable y no hay red, el job queda pendiente indefinidamente (TTL 7 días → purga).
- **User B "consume" su batería + tiempo de cómputo del teléfono**. Mitigación: opt-in explícito ("¿aceptar?"), umbral de batería >50%, default a "no notify si en background app".
- **Latencia de procesamiento depende del miembro disponible**: no hay SLA garantizado. Aceptable porque prevención no es real-time (un mesh del sitio se necesita días/semanas, no minutos).
- **Complexity adicional**: claim transactions, FCM topic management, capability score caching, TTL purge — más superficie a testear.

**Operational:**

- Onboarding de proyecto debe crear el folder Drive `Photogrammetry-Pending/` automáticamente al crear el proyecto (Cloud Function trigger en `onProjectCreated`).
- Métricas a trackear: `photogrammetry_jobs_pending_count`, `photogrammetry_jobs_claimed_to_completed_avg_minutes`, `photogrammetry_jobs_expired_count`.
- Sentry span per claim transaction para debugging conflicts.
- Documentar en UI: "Esta función usa Google Drive del proyecto y otros teléfonos del equipo para procesar reconstrucciones 3D. Los videos nunca salen de tu proyecto."

## Estado de implementación

**NO IMPLEMENTADA** al 2026-05-19. Trabajo pendiente:

| Sub-tarea | Esfuerzo estimado | Dependencias |
|---|---|---|
| Capability detection score + caching | 1 día | — |
| Firestore schema `photogrammetry_jobs` + rules | 2 días | — |
| Cloud Function `onPhotogrammetryJobCreated` (FCM fanout) | 1 día | Schema |
| Cliente upload video → Drive del proyecto | 2 días | OAuth Drive scope (ya existe) |
| Cliente claim + descarga + procesa (asume C1 WASM listo) | 3 días | **ADR 0005 v3 C1 implementada** (research task #12) |
| Cliente completion → mesh upload → ZK node update | 1 día | Schema |
| UI flow: capture → "no puedo, ¿subir?" → notify peer → status tracking | 3 días | — |
| Tests integration (firebase-emulator + 2 user mocks) | 2 días | — |
| **Total** | **~15 días-persona (3 sprints)** | C1 desbloqueado |

Esta feature **depende de C1 implementada** (no tiene sentido peer-to-peer si nadie puede procesar). Por eso ADR 0020 está aceptada como pattern pero su implementación se programa **post-ADR 0005 v3 Fase C1**.

## Alternatives considered

* **YouTube como storage intermedio** — descartado (privacy + TOS + re-encoding).
* **WebRTC peer-to-peer directo entre 2 teléfonos** — descartado por complejidad NAT traversal + no resuelve el caso async (User A graba, User B procesa horas después).
* **BitTorrent / IPFS** — descartado por fuera de Google ecosystem + complejidad legal.
* **Cloud Run COLMAP siempre como C2** — válida pero costea ($5-$25/mes). Peer-to-peer C3 evita ese costo cuando el equipo tiene devices capables.

## References

* ADR 0019 — Google ecosystem foundation (raíz).
* ADR 0005 v3 — Photogrammetry pipeline (C3 es la sub-fase nueva, complementa C1 + C2).
* `DIGITAL_TWIN_GPU_FREE_PLAN.md` (2026-05-03) — análisis original photogrammetry sin GPU.
* ADR 0011 — Digital Twin triple-gate auth.
* ADR 0013 — Mesh information relay (pattern offline-sync similar).

## Changelog

* **2026-05-19 v1:** Captura idea founder (peer-to-peer intra-tenant vía Drive). YouTube descartado como alternativa. Implementación depende de ADR 0005 v3 Fase C1.
