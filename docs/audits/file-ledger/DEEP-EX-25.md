# DEEP — Lote EX-25 · B10-EPP (FEAT) · 2026-06-03

**Atestación: 7/7 archivos leídos línea por línea.**
DERIVA: `ledger.json` filtrado por `category` startsWith `"FEAT"` &&
`block === "B10-EPP"` (62 matches), ordenado por `path`, slice `[55:62]` → 7
archivos. Lista exacta verificada vía Python contra el ledger:

1. `src/services/maintenance/horometerEngine.ts`
2. `src/services/maintenance/maintenanceScheduler.ts`
3. `src/services/signaletics/signageValidator.ts`
4. `src/services/zettelkasten/bernoulli/hazmatPipePressure.ts`
5. `src/services/zettelkasten/families/assetsFaenaNodeRegistry.ts`
6. `src/services/zettelkasten/flows/eppInventoryPurchaseFlow.ts`
7. `src/services/zettelkasten/flows/horometroMaintenanceFlow.ts`

> Nota: `DEEP-EX-24.md` **no existe** en `docs/audits/file-ledger/` (la serie EX
> llega hasta EX-20). No hay nada que "no repetir" de EX-24; me ciño a no
> repetir `DEEP-B10-EPP.md`, que ya cubrió: directiva no-push (header + footer +
> `pushedToSupplier:false`), no-bloqueo en `horometroService`/`equipmentQr`/
> `horometro.ts`, el engine paralelo `horometerEngine` con vocabulario
> "bloquear" (⚠️), ids deterministas idempotentes del scheduler, UI huérfana de
> toda la familia activos, `pendingOrders` en memoria, TODO de re-validación
> WebAuthn server-side, y el catálogo `assetsFaenaNodeRegistry`. Aquí solo
> hallazgos NUEVOS hallados en la lectura línea-por-línea de estos 7 archivos.

---

## Hallazgos NUEVOS

### 🟡 N1 — `horometerEngine.ts`: la directiva "nunca bloquear maquinaria" no solo aparece en copy, está cableada en la lógica de propuesta de calendario
`DEEP-B10-EPP.md` ya marcó el vocabulario "Bloquear operación"
(`horometerEngine.ts:69`), `blockOnMandatory:true` (`:72`) y `shouldBlock`
(`:117`). NUEVO en lectura fina: el flag `shouldBlock` **no es decorativo** —
`proposeCalendarTask` lo ramifica explícitamente (`horometerEngine.ts:181-184`)
para forzar `daysAhead=0`, `priority:'critical'`, `kind:'mandatory_block_resolution'`
y el título `URGENTE: Mantención obligatoria` (`:205`); `buildFleetReport` mantiene
un contador `blocked` dedicado (`:226,:242`). Es decir, el modelo de dominio del
engine **codifica un estado de bloqueo** (no solo lo nombra). Confirmado por grep
que el ÚNICO consumidor sigue siendo `HorometerStatusCard.tsx:63,119`
(`status.shouldBlock &&`), que NO está montada en ninguna ruta → sin impacto en
producción HOY, pero la violación de la directiva del fundador es estructural, no
de copy. Recomendado: si la card se monta alguna vez, alinear a la semántica
`restringido`/`RECOMENDAMOS detener` de `equipmentQrService` (que jamás pone flag
`blocked`), o retirar el engine. `buildDefaultPolicy` hardcodea `blockOnMandatory:
true` (`:72`) como default, así que cualquier consumidor nuevo hereda el bloqueo.

### 🟡 N2 — `completeMaintenanceTask`: read-modify-write sin `runTransaction` → doble cierre / pérdida de write (directiva #19)
`maintenanceScheduler.completeMaintenanceTask` (`:259-290`) hace un
`store.getTaskById(...)` (`:263`), deriva el estado con
`deriveStatusFromCompletion` (que rechaza re-completar — `:194`), y luego
`store.saveTask(updated)` (`:288`). El adapter Firestore real
(`src/server/routes/horometro.ts:163-175`) implementa `getTaskById` como `.get()`
y `saveTask` como `.set(..., {merge:true})` **sobre el mismo doc**, SIN
`db.runTransaction`. El guard `TASK_ALREADY_COMPLETED` vive en memoria entre el
read y el write: dos requests concurrentes de cierre (doble-tap, retry offline)
ambos leen `status!=='completed'`, ambos pasan el guard, y ambos escriben su
propia `completion` → el segundo `completedByUid`/`biometricSignatureHash`
**pisa** al primero, sin error. El scheduler NO está en la lista nominal de
candidatos de la directiva #19 (`incidentTrends`, `visitors`, `apprenticeship`,
`culturePulse`, `cphsMinute`, `knowledgeBase`), pero cumple exactamente el patrón
(≥1 `get()` + ≥1 `set()` sobre el mismo path) y debería añadirse. Bajo a medio
impacto: la firma biométrica del técnico es prueba de cierre y una carrera la
sobrescribe silenciosamente.

### 🔵 N3 — `horometroMaintenanceFlow`: nodos ZK del horómetro nunca se sellan inmutables ni escriben `audit_logs`
El flow persiste vía `writeNodes` y `createEdge` inyectados (`horometroMaintenanceFlow.ts:523,561`).
Los nodos `maintenance-task-completed` registran `completedByUid` y
`hasBiometricSignature` (`:289,:291`) desde el `completion` que llega del caller —
NO se re-verifica que `completedByUid === caller`. El flow es puro/DI, así que la
responsabilidad de estampar identidad y de auditar (`audit_logs`, invariante #3/#14)
recae 100% en `horometro.ts`; `DEEP-B10-EPP.md` confirmó que la route SÍ audita
(`horometro.ts:306,418`). NUEVO: los nodos ZK en sí no son inmutables — el
`writeNode`/idempotencyKey hace upsert (`set merge`), así que un re-run con el
mismo `(equipo, ciclo, multiplier, completedAt)` **sobrescribe** el nodo de
cierre. Para mantenimiento es aceptable (no es un acto firmado legalmente como el
libro de obra), pero conviene documentar que la traza forense del cierre vive en
`audit_logs` y en la tarea, no en el nodo ZK mutable.

### 🔵 N4 — `eppInventoryPurchaseFlow`: el `signerUid` del nodo firmado proviene del input, no se reafirma == caller en la capa pura
`createPurchaseOrderSignedNode` (`:383`) escribe `signerUid: signature.signerUid`
crudo desde `PurchaseOrderSignatureInput`. La verificación de que el firmante es
el caller vive en la route (`eppFlow.ts:406`, confirmado en `DEEP-B10-EPP.md`),
no aquí. Honesto y bien separado (factory pura), pero anoto la dependencia: si una
route nueva reusa `persistSignedNode`/`createPurchaseOrderSignedNode` sin replicar
el chequeo `signerUid === uid`, se puede sellar una OC atribuida a otro admin. La
directiva no-push está triple-reforzada en este archivo (`pushedToSupplier:false`
`:443` con comentario "nunca true", disclaimer footer PDF `:846-854`, y texto en
el nodo firmado `:393-394`) — sin hallazgo ahí.

### 🔵 N5 — `eppInventoryPurchaseFlow.renderPurchaseOrderPdf`: importa `pdfkit` con `await import` dentro de un servicio "puro"; sin `companyName`/`projectName` resueltos
`renderPurchaseOrderPdf` (`:749`) hace `await import('pdfkit')` (lazy, OK por peso)
pero introduce IO/efecto en un módulo cuyo encabezado se describe como factory
puro; la función es el único punto impuro del archivo y depende de que el caller
pase `companyName` (en `DEEP-B10-EPP.md` se vio `companyName:'Empresa'` hardcoded
en `eppFlow.ts:505`). Además el PDF imprime `supplierId` y `signerRut` en claro
(`:793,:819`) — son datos de negocio, no PII sensible de salud, pero el RUT del
firmante queda embebido en el documento descargable. Bajo impacto; anoto para
trazabilidad de superficie de datos.

### 🔵 N6 — `hazmatPipePressure`: nodo solo se emite en condición de riesgo (early-return `null` en operación normal) — sin telemetría de "OK"
`generateHazmatPipeNode` (`:36`) devuelve `null` si `densityKgM3<=0` (`:41`) y
también si NO cavita y `downstreamPa>0` (`:48`). Diseño correcto (no genera ruido
de nodos), pero significa que un tramo sano **no deja rastro** en el grafo: no se
puede distinguir "no evaluado" de "evaluado y seguro". Para una auditoría DS
43/NFPA 30 puede convenir un nodo `info` de constancia. Cálculo Bernoulli puro,
determinista, sin IO ni tenant data — sin riesgo de seguridad.

### 🔵 N7 — `assetsFaenaNodeRegistry` / `signageValidator`: catálogos estáticos correctos; doc-drift menor de conteo
`assetsFaenaNodeRegistry.ts` declara "80 nodes" en el comentario de cabecera
(`:2`) y `DEEP-B10-EPP.md` lo cita como "80 nodos"; el array real
(`ASSETS_FAENA_NODES`) suma **77** entradas (4 grúas + 3 andamios + 3 plataformas
+ 4 PCI + 3 tanques + 2 cilindros + 3 tubería + 3 bombas + 3 tableros + 3
transformación + 3 camiones + 3 mov.tierra + 3 minería + 3 soldadura + 3
herramientas + 16 sensores + 2 beacons + 16 sites). Los comentarios de sección
("gruas (4)", "sites (16)") sí cuadran con el array, pero el total de cabecera
(80) está 3 de más → doc-drift trivial intra-archivo (directiva #20, sub-50-LOC,
informativo). `signageValidator.ts` (`auditZoneSignage`, `findEvacuationPaths`
BFS) es puro determinista ISO 7010/3864/NCh 1411, sin Firestore, sin
`Math.random`, sin stubs — limpio.

---

## Tabla por archivo (7/7)

| # | Archivo | LOC | Estado | Hallazgo / nota (file:line) |
|---|---|---|---|---|
| 55 | services/maintenance/horometerEngine.ts | 268 | 🟡 | N1 `shouldBlock` cableado en proposeCalendarTask `:181-184`; `blockOnMandatory:true` default `:72`. Único consumidor huérfano (HorometerStatusCard). |
| 56 | services/maintenance/maintenanceScheduler.ts | 310 | 🟡 | N2 completeMaintenanceTask get+set sin runTransaction `:263,:288` (adapter horometro.ts:163-175). Builders puros idempotentes OK. |
| 57 | services/signaletics/signageValidator.ts | 463 | ✅ | N7 puro ISO 7010/NCh 1411; BFS evacuación; sin Firestore/random/stub. |
| 58 | services/zettelkasten/bernoulli/hazmatPipePressure.ts | 71 | ✅ | N6 Bernoulli puro; null en operación normal (sin nodo "OK") `:48`. |
| 59 | services/zettelkasten/families/assetsFaenaNodeRegistry.ts | 115 | 🔵 | N7 cabecera dice "80 nodes" `:2`; array real 77. Doc-drift intra-archivo. |
| 60 | services/zettelkasten/flows/eppInventoryPurchaseFlow.ts | 871 | ✅ | N4 signerUid del input (route reafirma); N5 pdfkit await-import + RUT en PDF `:819`. No-push triple-reforzado `:443,:846`. |
| 61 | services/zettelkasten/flows/horometroMaintenanceFlow.ts | 705 | ✅ | N3 nodos ZK mutables (upsert), completedByUid sin re-check en capa pura `:289`. Flow puro DI, ids deterministas. |

## Archivos limpios (sin hallazgo 🔴/🟡): 57, 58, 59, 60, 61 (5/7). Los 2 servicios `🟡` (55, 56) no tienen exploit en producción HOY (engine huérfano; carrera de cierre requiere concurrencia exacta).

---

## Resumen (6-10 líneas)

Lote EX-25 — 7/7 servicios B10-EPP leídos línea por línea (engines de
mantención, scheduler, validador de señalética, Bernoulli hazmat, registro de
activos, y los 2 flows ZK EPP/horómetro). Nota de partida: `DEEP-EX-24.md` no
existe (la serie llega a EX-20), así que la única base de no-repetición real es
`DEEP-B10-EPP.md`. Cero hallazgos 🔴. Dos 🟡: (N1) `horometerEngine` no solo usa
copy "Bloquear" sino que cablea el flag `shouldBlock` en `proposeCalendarTask` y
en el rollup de flota, con `blockOnMandatory:true` como default — viola
estructuralmente la directiva "nunca bloquear maquinaria", mitigado solo porque
su única consumidora (`HorometerStatusCard`) sigue huérfana; (N2)
`completeMaintenanceTask` hace get-then-set sobre el mismo doc de tarea sin
`runTransaction`, abriendo una carrera de doble-cierre que sobrescribe la firma
biométrica del técnico — debería sumarse a la lista de la directiva #19.
Hallazgos 🔵 menores: nodos ZK de horómetro/EPP son upsert mutables (la traza
forense vive en `audit_logs`, no en el nodo); `signerUid`/`completedByUid` se
toman del input en la capa pura y dependen de que la route reafirme `== caller`;
`hazmatPipePressure` no emite nodo de constancia "OK"; `renderPurchaseOrderPdf`
es el único punto impuro (await-import pdfkit) y embebe el RUT del firmante; y
`assetsFaenaNodeRegistry` declara "80 nodes" en cabecera cuando el array suma 77
(doc-drift trivial). La directiva no-push está triple-reforzada en
`eppInventoryPurchaseFlow` (`pushedToSupplier:false`, disclaimer PDF, texto del
nodo firmado). Doc-only, sin commit.
