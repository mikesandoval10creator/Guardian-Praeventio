# Fase 3 — Reconciliación auditoría ↔ TODO.md + backlog priorizado

**Fecha:** 2026-06-02 · **Rama:** `claude/technical-debt-review-e2e-87kVX`
**Insumo:** 25× `DEEP-*.md` + `INDEX-CONSOLIDADO.md` (hallazgos verificados `file:line`)
vs `TODO.md` (2.174 líneas, 166 ✅ / 14 🟡 / 20 🔴).
**Regla de oro (TODO.md Rule #1):** nada ✅ sin `file:line` que se sostenga en el
código. Esta fase audita los ✅ y mapea la deuda real. **Doc-only: no se corrigió
código ni se editó `TODO.md` todavía.**

---

## A. ✅ de `TODO.md` que el barrido CONTRADICE o matiza (Rule #1)

| # | TODO.md dice | Realidad (barrido, `file:line`) | Veredicto |
|---|---|---|---|
| A1 | **§2.29** "Audit trail rule #3 — CERRADO `rule3_pending=0`" (`TODO.md:789`) | Cierre **real pero solo server-side** (`src/server/routes/`, ratchet `convention-guard-baseline.json`). El bypass **client-side** (`createProjectScopedStore.save/patch:190-215` + `EmergencyContext.triggerEmergency`, `ProjectContext`, `UniversalKnowledgeContext`) escribe a Firestore sin `auditServerEvent` y **no está en el ratchet** | ✅ válido para server · **brecha nueva no trackeada** (cliente) |
| A2 | **§2.29** exime `loto` como "read-only/pure-compute/infra" (`TODO.md:~800`) | Correcto que es read-only — pero eso **es justo el problema de vida**: `loto.ts:55` solo `GET`, no hay endpoint para aplicar candado/cero-energía/liberar; `LotoAdapter`/`applyFullRelease` muertos | Exención válida técnicamente, **oculta una brecha 🛟** |
| A3 | **§2.1** Biometría WebAuthn 🟢 "verificación CBOR server-side" (`TODO.md:88`) | Cierto para el **setup MFA** (`useBiometricAuth.register()`). Pero **`Login.tsx:10` usa el helper débil** `utils/biometrics.ts:88` que retorna `true` client-side sin verificación de firma | ✅ parcial · **ruta de login no cubierta** |
| A4 | **§16.2.2** `conflict_queue` ✅ "construido" (`TODO.md:1432`) — y a la vez 🔴 CRÍTICA "Grep NO encuentra" (`TODO.md:1463`) | **`TODO.md` se contradice solo.** Real: `conflictQueue.ts` (238 LOC, tested) **existe pero está muerto** (0 consumers) y **sin reglas** para una colección `conflict_queue` | **Inconsistencia interna** · engine sí, feature no |
| A5 | **§1** Mesh BLE 70% "falta consumer en src/" (`TODO.md:~60`) | El consumer **existe y está cableado**: `MeshProvider.tsx:110` (`registerMeshTransport`) montado en `AppProviders.tsx:139`. Plugin nativo real (Kotlin 552 + Swift 350) | **Desactualizado** (subestima) |
| A6 | **§2.11** "Tests verde 100%" (`TODO.md:222`) vs **§1** "8040 passing / **394 failing** (exit 0 silencia)" (`TODO.md:~70`) | El mapa de tests confirma 20 skip/fixme; cobertura co-located 54%. La cifra "100%" y "394 failing" no pueden ambas ser ciertas | **Inconsistencia interna** |
| A7 | **§1** Health Vault 85% (`TODO.md:~62`) | `health_vault`/`health_vault_shares` **sin reglas Firestore** (grep=0); colección médica más sensible. El % no refleja la brecha Regla #4 | **% optimista** · brecha 🔐 no trackeada |
| A8 | **§2.13** "IAP SKU per tier wired" ✅ / **§1** Billing "falta MP IPN HMAC" | IAP **sí valida receipt server-to-server** (`googlePlayValidator`/`appleTransactionValidator`) y MP IPN **sí** verifica HMAC (`mercadoPagoIpn.ts:248`). La nota "falta MP IPN HMAC" en §1 está **desactualizada** | ✅ correcto · §1 stale |

---

## B. Hallazgos verificados AUSENTES de `TODO.md` (deuda no trackeada)

> La mayoría de la deuda de **vida/privacidad** no figura en `TODO.md`. Grep en
> `TODO.md` = 0 hits para: `LOTO`, `health_vault`, `site_book`/`libro de obra`,
> `comite_actas`, `external audit portal`/`auditor externo`, `assertProjectMember`,
> `tier-gating` por-feature, `allowbackup`/`stub-guard`, `createProjectScopedStore`.

| # | Brecha (no en TODO.md) | Evidencia | Sev |
|---|---|---|---|
| B1 | **ManDown no hace push** al supervisor | `useManDownDetection` escribe Firestore, sin `triggerEmergency`/FCM; §16.6.2 TODO solo lista "UI completa" como MEDIA, no el gap de push | 🛟 P0 |
| B2 | **LOTO read-only** (no aplica candado) | `loto.ts:55` solo GET; `LotoAdapter`/`applyFullRelease` muertos; `LotoStatusPanel` huérfano | 🛟 P0 |
| B3 | **Libro de obras firmado MUTABLE + test falso verde** | `firestore.rules:414,422` chequea `signedAt` top-level; firma escribe `signature.signedAt` (`siteBookSigning.ts:247`); test siembra `signedAt` sintético (`projectScopedStores.rules.test.ts:181`) | 🔐 P1 |
| B4 | **`health_vault` sin reglas** | grep=0 en `firestore.rules`; writes por Admin SDK; incumple Regla #4 | 🔐 P1 |
| B5 | **External Audit Portal sin gate de rol** | `externalAuditPortal.ts:234,306,355,428` solo `verifyAuth`, sin `assertProjectMember`/`isAdmin` → cualquier member emite token auditor cross-proyecto | 🔐 P1 ALTO |
| B6 | **`visitors.ts` sin `assertProjectMember`** | `:112,119` solo `verifyAuth`+`tenantIdFor` → escritura cross-proyecto (#6) | 🔐 P1 |
| B7 | **Biometría de login débil** | `utils/biometrics.ts:88` retorna `true` sin verificación server-side; usado por `Login.tsx:10` | 🔐 P1 |
| B8 | **Medicine.tsx UI de diagnóstico** | `MedicalAnalyzer/DifferentialDiagnosis/DrugInteractions` (`:134,137,141`) → acciones Gemini no whitelisted (403) + contra ADR 0012 | 🔐 P1 |
| B9 | **AIPostureAnalysisModal sube foto** | fallback Gemini Vision (`:206-210` → `gemini/vision.ts`) sube foto del trabajador | 🔐 P2 |
| B10 | **`comite_actas` sin regla de write** | `ComiteParitario.tsx:73` escribe → default-deny prod; duplica `cphs_meetings` | 🟡 P2 |
| B11 | **Bypass de auditoría client-side** (sistémico) | `createProjectScopedStore` + 4 contextos; MOC/CPHS/SiteBook/Stoppage | 🔐 P1 |
| B12 | **Gamificación auto-otorga puntos** | `gamification.ts:35` toma `amount` del cliente sin cota; `gamificationService.ts:34` | 🟡 P2 |
| B13 | **Tier-gating por-feature solo client-side** | `SubscriptionContext.tsx:64-68`; sin middleware server (#11 parcial) | 🟡 P2 |
| B14 | **PDCA flow no crea edges** | `incidentFlow.ts:77-84` solo `writeNodes` → grafo ZK desconectado | 🟡 P2 |
| B15 | **Reglas: `site_book_counters`, `documents_for_read`(authorUid), `lone_worker` update, `root_cause_analyses`** | threads Codex #650; varios default-deny / ownership | 🔐 P2 |
| B16 | **Guards #13/#17 no-wired** | `.husky/pre-commit` no llama stub/allowbackup guards; CLAUDE.md dice "Enforced" | 🟡 P2 |
| B17 | **AlertScheduler probes vacíos** | `RootLayout.tsx:467` `probes={[]}` → predictivo dormido | 🟡 P2 |
| B18 | **mesh `unsigned-dev` + `encryptData`=base64 web + `conflict_queue` muerto** | `meshPacket.ts:237`; `offlineStorage.ts`; B16 | 🟡 P2 |
| B19 | **86 UI huérfanas + euler 4.053 LOC + subsistemas muertos** | DEEP-NH-ui / knowledge | 🔵 P3 |

---

## C. Backlog priorizado (vida → privacidad → integridad → limpieza)

> Cada ítem es candidato a TDD estricto (RED→GREEN). **No empezar sin tu OK**
> explícito por ítem (tocan rutas de vida/privacidad). Orden sugerido:

### P0 — Vida (🛟) — empezar aquí
1. **ManDown push** (B1): cablear `useManDownDetection` → `triggerEmergency` + trigger server `mandown_events` → FCM supervisor. Test: detección dispara push. _Nota: el usuario pidió dejarlo **documentado**; confirmar si ya se aborda._
2. **LOTO write-path** (B2): endpoints `apply-lock`/`verify-zero-energy`/`release` + `LotoAdapter` + audit + montar `LotoStatusPanel`. Test: 401/200/403 + no-energización.
3. **AlertScheduler probes** (B17): poblar `probes` con fuentes reales o documentar/desmontar honestamente.

### P1 — Privacidad / cumplimiento (🔐)
4. **External Audit Portal authz** (B5): añadir `assertProjectMember(scopeProjectIds)` + `isAdmin/isSupervisor` a los 4 endpoints admin. Test: 403 non-admin/non-member.
5. **`health_vault` reglas** (B4): reglas explícitas + ≥5 rules-tests + entrada `security_spec` + KMS.
6. **Libro de obras inmutable** (B3): corregir gate a `signature.signedAt` (o estampar top-level) + arreglar el test falso-verde + unificar paths SiteBook.
7. **`visitors.ts` membership** (B6): `assertProjectMember` en check-in/out/ack.
8. **Biometría login** (B7): migrar `Login.tsx` a `useBiometricAuth` (verificación server-side) y retirar el helper débil.
9. **Medicine diagnóstico** (B8): retirar/feature-flag componentes; alinear ADR 0012.
10. **Audit bypass client-side** (B11): decisión arquitectónica — trigger server vs re-cablear UI a endpoints auditados.

### P2 — Integridad / robustez
11. Gamificación cota server-side (B12) · Tier-gating server por-feature (B13) · PDCA edges (B14) · reglas #650 (B15) · guards #13/#17 wire (B16) · mesh firma + encryptData real + conflict_queue (B18) · comite_actas regla (B10) · AIPosture foto (B9).

### P3 — Limpieza / huérfanos
12. Decidir montar-o-borrar 86 UI + euler 4.053 LOC + subsistemas muertos · consolidar duplicados (MQTT/DS76/PDF SUSESO/changeMgmt) · crear bloque B-DigitalTwin.

---

## D. Correcciones propuestas a `TODO.md` (para tu visto bueno)
1. Resolver inconsistencia **conflict_queue** (1432 vs 1463): marcar 🟡 "engine existe, no wired, sin reglas".
2. Resolver **tests 100% vs 394 failing** (§2.11 vs §1): una sola cifra verificada.
3. Actualizar **§1**: Mesh "consumer cableado" (no "falta"); Billing quitar "falta MP IPN HMAC".
4. **Añadir** los B1-B18 ausentes a una nueva sección "§2.32 Deuda barrido archivo-por-archivo 2026-06-02" con `file:line`.
5. Acotar **§2.29** ✅ a "server-side"; abrir sub-ítem para el bypass client-side.

---

## E. Siguiente paso
Necesito tu decisión para continuar (ver pregunta asociada): **(a)** qué P0/P1
empezar a corregir con TDD, y **(b)** si aplico las correcciones a `TODO.md`
(sección D) ahora o las dejo solo propuestas. Todo lo demás queda anotado.
