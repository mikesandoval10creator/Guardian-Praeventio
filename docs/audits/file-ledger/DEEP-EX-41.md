# DEEP-EX-41 — Pasada exhaustiva línea-por-línea (Lote #41, ÚLTIMO)

**Deriva:** `ledger.json` → `category` empieza con `FEAT` && `block === "CROSS"`,
ordenado por `path`, slice `[110:159]`.
**Universo:** 159 archivos `FEAT`/`CROSS`; este lote cubre el slice final
`[110:159]` (49 archivos): `migration/registry`, `mobile/foregroundServiceClient`,
`notifications/fcmAdapter`, el tridente `openapi/*` (bootstrap + registry +
specGenerator), todo `privacy/*` (dpiaTemplate, registry, types, 11 regímenes
`regimes/*`), `privacyShield/piiClassifier`, `proximitySensor/proximityModeDetector`,
`scheduler/distributedLease`, el clúster cripto `security/*` (browserEnvelope,
deviceKek, encryptedKvStore, kmsAdapter, kmsEnvelope), `seedBackend` + `seedService`,
y todo `systemEngine/*` (README + 9 adapters + decisionEngine, eventLog, eventTypes,
executor, 3 policies, subscriber) + `uxModes/uxModeAdapter`.
**Foco:** middleware con bypass, rateLimit evadible, cripto débil, privacy mal
mapeado, colecciones sin regla, tenantId del cliente sin token, secretos
hardcodeados, `Math.random` en server/IDs (#15), auth/audit faltante (#3/#14),
5xx-leak (#8), gemini-whitelist (#5), stubs (#13), promesas sin await, doc-drift.
**No repite:** `DEEP-NH-server.md` (systemEngineTrigger server `:1416`),
`DEEP-NH-services-infra.md` (privacy/registry 11 regímenes + `getMostStrictRegime`
merge-AND ✅; kmsAdapter CloudKMS real + "sin test"; browserEnvelope/deviceKek
✅🔑; POPIA/DPDP stubs `:54`), `DEEP-NH-services-knowledge.md` (eventLog 🔵
"FS+IDB outbox"; adapters no-op intencionales 🟡; executor fire-and-forget 🔵),
`DEEP-EX-39/40.md` (no existen aún — sólo hasta EX-35).

## Atestación 49/49

Los 49 archivos del slice fueron leídos completos línea-por-línea. El clúster
cripto (`browserEnvelope`, `deviceKek`, `encryptedKvStore`, `kmsAdapter`,
`kmsEnvelope`) leído íntegro incluyendo guards de IV/authTag/DEK-length. Los 11
`privacy/regimes/*` leídos uno por uno (deadlines, ageOfConsent, residency flags)
y cruzados con `privacy/registry.ts` + `types.ts`. El `systemEngine/*` completo,
cruzado con `firestore.rules` (matcher `tenants/{tid}/{subcoll}/{docId}` línea
958 + ausencia de `system_events`), `src/server/routes/systemEvents.ts` y el
README. Verificado: nombres de modelo Gemini (`gemini-3-flash-preview` 62×,
`gemini-3.1-pro-preview` 28× — ambos canónicos), consumidores de
`dataResidencyRequired` (sólo `PrivacyRegimeCard.tsx` UI + tests), y los dos
registries de privacidad paralelos (`services/privacy/` vs
`services/regulatory/privacyRegimes.ts`).

## Hallazgos

| # | Sev | Archivo:línea | Hallazgo |
|---|-----|---------------|----------|
| 1 | 🟡 | `src/services/systemEngine/eventLog.ts:142-170` (+ `:227-256` drainOutbox; `firestore.rules:958-963`) | **El online-path de `emit()` cliente está roto por las reglas — todo evento queda atrapado en el outbox IDB silenciosamente.** `eventLog.ts` es **código cliente** (importa `db, auth` de `'../firebase'`, SDK web). Su path online hace `setDoc(doc(db,`tenants/${tenantId}/system_events`, id), ...)` (`:144`). En `firestore.rules` la subcolección cae bajo el catchall `match /tenants/{tenantId}/{subcoll}/{docId}` (`:958`) que declara **`allow create, update, delete: if false`** — y NO existe ningún `match /system_events` explícito (grep confirma "NO explicit system_events rule anywhere"). Resultado: cada write online es `permission-denied`, capturado en el `catch` (`:159`) que lo re-encola en el outbox offline; `drainOutbox` (`:240`) **también** escribe cliente-side → también denegado → el outbox crece sin drenar jamás. El README (`:130-133`) y la ruta `systemEvents.ts` indican que los emits deberían ir por `POST /api/system-events/emit` (verifyAuth + token tenant), pero los call-sites vivos (`useGeofenceWithEvents`, adapters emergency/subscription) llaman al `emit()` cliente directo. Efecto neto: la persistencia Firestore del bus + el espejo a `audit_logs` (`:153`) son no-funcionales online; los eventos sólo alcanzan listeners in-process (`:125`). El base-doc marcó `eventLog.ts` 🔵 sin detectar la colisión regla↔write. |
| 2 | 🟡 | `src/services/privacy/types.ts:77-84` + `registry.ts:198-259` (consumidores: `components/privacy/PrivacyRegimeCard.tsx:34`) | **`dataResidencyRequired` es promesa-no-cumplida: el comentario exige rechazar flujos offshore, pero no hay enforcement.** `types.ts:81-83` documenta literalmente *"Las features de procesamiento offshore deben rechazar el flujo cuando este flag es `true`"* (152-FZ-RU art.18.5, PIPL-CN). Sin embargo: (a) `getMostStrictRegime`/`strictestDeadlineDays` (`registry.ts:198,254`) sólo combinan deadline + consentimiento — **ignoran `dataResidencyRequired`**, así que el "régimen más estricto" puede no preservar el flag de localización; (b) el único consumidor del flag en runtime es `PrivacyRegimeCard.tsx:34` (`regimes.some(...)` → badge UI), puramente cosmético. No existe ningún guard server-side que lea el flag y bloquee el procesamiento. Es un control declarativo presentado por el doc como obligación operativa — gap doc-vs-realidad con impacto de cumplimiento (datos de ciudadanos RU/CN podrían procesarse offshore sin que nada lo impida). El base-doc citó `getMostStrictRegime` como ✅ (merge-AND) sin notar la dimensión residency faltante. |
| 3 | 🔵 | `src/services/privacy/registry.ts:42-83` ↔ `src/services/regulatory/privacyRegimes.ts` | **Dos registries de privacidad paralelos con shapes divergentes.** `services/privacy/` (este lote, 11 regímenes, `PrivacyRegimeSpec` con `dataResidencyRequired` *opcional* sólo en RU/CN/stubs) coexiste con `services/regulatory/privacyRegimes.ts` (códigos distintos: `DPDP`, `PIPA-KR`, `GDPR` sin sufijo; `dataResidencyRequired` *obligatorio* en todos). Mismos conceptos, dos fuentes de verdad — riesgo de drift (p.ej. un régimen marcado residency-required en uno y no en el otro). Ninguno está cableado a rutas vía import directo detectable; conviene consolidar o documentar cuál es canónico. |
| 4 | 🔵 | `src/services/systemEngine/adapters/{appMode,language,normative,notification,project,sensor,theme,universalKnowledge}ContextAdapter.ts` (8 hooks no-op) | **8 adapters mount-point intencionalmente vacíos — documentados pero no en `docs/stubs-inventory.md`.** Cada uno es `export function useXAdapter(_opts){ /* Intentionally empty */ }` con header explicando el hook futuro. NO retornan datos mock ni son user-facing (son hooks de montaje), así que técnicamente quedan fuera del estricto #13 (que apunta a mock-data/`NotImplementedError` visibles). El base-doc ya los marcó 🟡 como "no-op intencionales". Se relista sólo para cerrar el slice: no llevan `// TODO(sprint-N)` ni entrada en stubs-inventory, recomendable para trazabilidad aunque su superficie de riesgo sea nula. |
| 5 | 🔵 | `src/services/seedBackend.ts:91-143` (`runSeed`/`cleanupUserApiKeys`/`generateInitialDataForIndustry`) | **Operación de seed sin audit-log (#3) y sin `verifyAuth` inline visible.** `runSeed` borra `user_gemini_api_key`/`geminiApiKey` de TODOS los `users` (`:104-117`) y escribe N docs a `community_glossary` (`:69-86`) sin emitir ningún `auditServerEvent`. Es un job admin/arranque (no una ruta HTTP per se — la ruta `/api/seed-glossary` que lo invoca sí está gated por verifyAuth según `seedService.ts:11-19`), por lo que el riesgo es bajo, pero un wipe masivo de campos de usuario + escritura de corpus sin rastro en `audit_logs` es una brecha del invariante de auditoría para una operación destructiva. `gemini-3.1-pro-preview` (`:57`) es canónico (28 usos), no es hallazgo. |

## Limpios (sin hallazgo material)

Los siguientes 44 archivos se leyeron completos y son sólidos: contratos
estrechos, errores tipados, sin secretos, sin `Math.random`, sin 5xx-leak,
sin tenantId-del-cliente:

- **`migration/registry.ts`** — migraciones idempotentes, `applyMigrations`
  nunca lanza (forward-gap → no-op), contrato de versión denso documentado.
- **`mobile/foregroundServiceClient.ts`** — platform-guard Android, plugin
  lazy-import dead-code-eliminado en web, no-op silencioso en iOS/web.
- **`notifications/fcmAdapter.ts`** — multicast ≤500, `failedTokens` por índice,
  `FcmAdapterError` distinguible, no-op en lista vacía.
- **`openapi/{bootstrap,registry,specGenerator}.ts`** — spec 3.1 auto-generada
  de Zod; spec público deliberado (B2D), `internalOnly` filtra admin/scheduler;
  `__resetRegistryForTests` marcado test-only.
- **`privacy/dpiaTemplate.ts`** — renderer PDF puro, tier-gating delegado al
  route (documentado).
- **`privacy/registry.ts` + `types.ts` + 11 `regimes/*`** — datos normativos
  honestos (deadlines/edad/breach citados art-por-art); POPIA/DPDP stubs
  declarados `:54`. (Gaps en hallazgos #2/#3.)
- **`privacyShield/piiClassifier.ts`** — clasificación determinística,
  retención por sensibilidad, `detectGaps` para special_category/judicial.
- **`proximitySensor/proximityModeDetector.ts`** — motor puro, DI del plugin,
  heurísticas con umbrales documentados.
- **`scheduler/distributedLease.ts`** — lease Firestore con `runTransaction`
  (cumple #19), nonce CSPRNG (`crypto.randomBytes`, cumple #15), nunca lanza,
  Sentry-swallow para no tumbar el cron, `withLease` libera en `finally`.
- **`security/browserEnvelope.ts`** — AES-256-GCM, DEK fresco per-record, IV
  random siempre, `validateEnvelope` type-guard, rewrap sin re-cifrar payload.
- **`security/deviceKek.ts`** — KEK `extractable=false` en IDB, rotación con
  re-wrap documentada.
- **`security/encryptedKvStore.ts`** — combina envelope+KEK, `clear`+`deleteKek`
  para logout, no descifra en `list`/`meta`.
- **`security/kmsAdapter.ts`** — CloudKMS real gated por `KMS_KEY_RESOURCE_NAME`,
  **no auto-fallback** a dev-KEK (`:197`, decisión de seguridad explícita),
  DEV_KEK derivado vía SHA-256 de label (no blob hardcodeado).
- **`security/kmsEnvelope.ts`** — un solo KMS round-trip por op, guards de
  longitud IV/authTag/DEK, `.final()` como verificación de integridad GCM.
- **`seedService.ts`** — `/api/seed-glossary` ahora adjunta `apiAuthHeader`
  (fix Round 14 A5), throw temprano si no hay user. (Gap de audit en seedBackend
  → hallazgo #5.)
- **`systemEngine/`**: `decisionEngine.ts` (allSettled aísla policies),
  `executor.ts` (audit-action SÍ `await`eado `:109`; `void emit` es cliente,
  fuera de #14), `eventTypes.ts` (Zod discriminated-union fail-closed),
  `subscriber.ts` (onSnapshot + onLocalEmit, cleanup), `policies/*`
  (tierChangeReactivity puro, PLAN_RANK), README fiel. (Gap de regla en
  eventLog → hallazgo #1.)
- **`uxModes/uxModeAdapter.ts`** — motor UI puro determinístico (batería/red/
  accesibilidad → tokens CSS), `diffProfiles` para transiciones.

## Resumen

Lote final #41 (49/49 leídos, infra transversal CROSS): clúster cripto, OpenAPI,
privacy multi-régimen y SystemEngine. El clúster de seguridad (envelope cliente
y server, deviceKek, kmsAdapter/kmsEnvelope) es de calidad alta — AES-256-GCM
correcto, IV random, guards de longitud, sin fallback inseguro, sin secretos
hardcodeados, sin `Math.random` (#15 OK). Dos hallazgos 🟡 nuevos: (1) el
`emit()` **cliente** de `systemEngine/eventLog.ts` colisiona con la regla
`tenants/{tid}/{subcoll}/{docId}` (`create:false`) — todo evento online es
denegado y atrapado para siempre en el outbox IDB, dejando la persistencia
Firestore + espejo audit_logs del bus no-funcionales (base-doc lo tenía 🔵);
(2) `dataResidencyRequired` es declarativo — `types.ts` ordena rechazar flujos
offshore pero ningún guard lo hace (sólo un badge UI lo lee), y
`getMostStrictRegime` ni siquiera propaga el flag. Tres 🔵: dos registries de
privacidad paralelos divergentes, 8 adapters no-op fuera de stubs-inventory, y
`runSeed` (wipe masivo de api-keys + escritura de corpus) sin audit-log. Cero
secretos, cero 5xx-leak, cero tenantId-del-cliente, cero gemini-whitelist roto
en este lote. Cierra la pasada exhaustiva del ledger.
