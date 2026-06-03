# DEEP-EX #5 — B7-Salud [55:110] · 2026-06-02

**Atestación:** leídos 55/55 línea por línea (salud + datos sensibles, máximo
cuidado). Derivación: `ledger.json` filtrado `category^="FEAT" && block=="B7-Salud"`,
ordenado por `path`, slice `[55:110]` → 55 archivos (hooks 8, pages 13, routes 12,
job 1, trigger 1, services 18, route-group 1, hook-readiness 1). Cruzado contra
`DEEP-B7-Salud.md` para no repetir; sólo hallazgos NUEVOS abajo.

## Hallazgos NUEVOS (no en DEEP-B7)

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| src/pages/Hygiene.tsx:138, 173-190 | 🟡 | **Stub disfrazado de dato real (viola #13).** El gráfico "Tendencias mensuales" usa el array literal `[40,65,45,80,55,70,90,60,45,75,50,65]` y la tarjeta "Salud ocupacional" muestra **"Exámenes médicos 92%"** y **"Vacunación 78%"** HARD-CODEADOS, presentados al usuario como métricas reales sin etiqueta "demo"/feature-flag/503. No hay `// TODO(sprint-N)`, no está en `docs/stubs-inventory.md`, no hay test que fije la forma. DEEP-B7 lo marcó ✅ "página wireada" sin detectar el mock. | `[40,65,...]` en `.map`; `92%`/`78%` literales en JSX |
| src/server/routes/medicalAptitude.ts:200-207, 228 | 🟡 | **Stub no-registrado (viola #13).** `defaultConsumeChallenge`/`defaultVerifyAssertion` retornan `false`; el endpoint `/aptitude-cert/sign` responde **503 `signer_not_configured`** si no se inyectan deps. Está 503-gated (invisible, ✅ parte de #13) PERO: sin `// TODO(sprint-N): <owner>` (sólo "Production wiring lands when WebAuthn verifier ships" :201), **no está en `docs/stubs-inventory.md`** (grep=0). Firma biométrica de certificado de aptitud médica permanentemente inoperante en prod hasta que alguien inyecte deps. | `:203` `return false`; `:228` `503` |
| src/pages/AnnualReview.tsx:220 | 🔵 | **`Math.random()` en generación de ID (roza #15).** `id: \`obj_${Date.now()}_${Math.random().toString(36).slice(2,8)}\``. La regla #15 prohíbe `Math.random()` en `src/server/` **y en cualquier código de generación de ID**; esto es cliente (el ESLint server-rule no lo atrapa) pero ES ID-gen. Sólo ~6 chars base36 de entropía → colisión/predecibilidad. Debería usar `randomId()` de `src/utils/randomId.ts`. | línea 220 |
| src/server/routes/telemetry.ts:185-196 | 🔵 | **Ingesta IoT sin audit_logs (roza #3).** `POST /api/telemetry/ingest` escribe `telemetry_events` (state-changing) pero NO emite `auditServerEvent`. Es webhook firmado HMAC (excepción documentable por #6), pero #3 exige audit en toda mutación; al menos la rotación de secreto (`:240`) sí audita. Considerar audit ligero o documentar la exclusión inline. | `db.collection('telemetry_events').add(...)` sin audit |
| firestore.rules:505-506 + src/pages/Telemetry.tsx:135-138 | 🔵 | **Lectura cross-tenant de telemetría.** La regla `telemetry_events` permite `read: if isAdmin() || isSupervisor()` SIN filtro de tenant/proyecto; `Telemetry.tsx` lee `useFirestoreCollection('telemetry_events', [orderBy('timestamp'), limit(10)])` sin scope. Un supervisor del tenant A puede leer eventos del tenant B. (Create ya está `false` correctamente — server-only HMAC.) | rule `:506`; query `:137` |
| firestore.rules:799-808 + src/pages/SunTracker.tsx:96-107 | 🔵 | **`userEmail` no pineado en write cliente-directo.** `SunTracker` escribe `uv_exposures/{uid}_{iso}` desde el cliente con `userEmail: user.email` libre; la regla `:800` pinea `userId==auth.uid` y `date is string` pero NO `userEmail` → un cliente puede escribir cualquier email en el doc. Además el audit (`logAuditAction` cliente) sólo dispara con `uv>=8` (`SunTracker:108`), exposiciones normales sin rastro. Baja sensibilidad (auto-reporte propio) pero gap de integridad PII. | rule `:799-808`; write `:97-107` |
| src/pages/HealthVaultViewer.tsx:215-224 | 🔵 | **`fileUri` crudo servido al viewer público.** El endpoint público `/view/:id/:secret` devuelve `record.fileUri` y el viewer (sin login) lo renderiza como `<a href>` abierto. Si `fileUri` es signed-URL de Storage con TTL propio, sigue accesible aun tras revocar el share (la URL no está atada al token). El trabajador eligió compartir, mitigante; conviene proxiar la descarga por el endpoint con re-chequeo del token. | viewer `:215`; route `healthVault.ts:255-267` |
| src/server/routes/healthVault.ts:5, 62-118, 187-192, 302-304 | 🔵 | **Mojibake UTF-8 en comentarios (doc-drift cosmético).** `DUEÃ‘O ABSOLUTO` (:5), `PÃšBLICO` (:191) y todas las líneas de caja `â”€â”€â”€` están corruptas (doble-encode). No afecta runtime (sólo comentarios) pero indica un archivo que pasó por un re-encode mal hecho; al re-tocar, normalizar a UTF-8. | bytes corruptos en comentarios |

## Confirmaciones relevantes (breve)
- **HealthVaultShare.tsx:60** lee `health_vault_shares` directo vía Firestore client
  SDK → default-deny lo bloquea. Confirma DEEP-B7 §2 (pantalla de gestión rota +
  sin reglas para `health_vault*`). El `useEffect` soft-falla en silencio (`:78`).
- **Medicine.tsx:26-31, 134-141** cablea `MedicalAnalyzer`/`DifferentialDiagnosis`/
  `DrugInteractions` (acciones de-whitelisted → 403). Confirma DEEP-B7 §2 hallazgo 3
  (UI médica diagnóstica muerta + contra-ADR 0012). Sí renderiza `<MedicalDisclaimer/>`
  (:69), cumpliendo el guard.
- **occupationalContext.ts (888 LOC):** ejemplar — pura, envelope-encrypt KMS,
  ZIP store-mode determinista, disclaimer literal-type, `triggeredByWork` preservado.
  `exportOccupationalBundle` escribe `tenants/{tid}/vaultRecords` (sin audit propio,
  pero el contrato delega audit al orquestador caller, como vaultRecord.ts).
- **Cadena de motores puros** (fatigueMonitor, circadianRhythmService, metabolicRate,
  thermalStressCalculator, exposureRegistry, documentHygieneEngine): deterministas,
  sin I/O, anclados a norma chilena (DS 594/NIOSH/ACGIH), nunca bloquean maquinaria
  (sólo `shouldRestrictCritical`/`blockCriticalOps` advisory).
- **Adapters de salud nativos** (healthConnect, healthKit, healthFacadeNative,
  nativeHealthAdapter): biometría 100% on-device, sin `fetch`, shift-window guard
  (ADR 0010). `googleFitAdapter` es el único con egress (`/api/fitness/sync`,
  server-mediado, `@deprecated` sunset 2026) — ya en DEEP-B7.
- **Rutas Sprint-K** (fatigue, circadian, hygiene, mentalLoad, returnToWork,
  workerHistory, medicalCatalogs, aggregateTelemetry, workerReadiness): patrón
  uniforme `verifyAuth + assertProjectMember/guard + zod validate + motor puro`,
  500 genérico (`internal_error`, cumple #8), `workerUid` forzado al caller donde
  aplica. medicalAptitude audita con `await` + try/catch + Sentry (#14 ✅).
- **MyData.tsx, WorkerReadiness.tsx, WearablesIntegration.tsx:** limpias —
  server-mediadas, Ley 19.628 / no-bloqueante / biometría on-device, disclaimers
  presentes.
- **telemetry_events / uv_exposures** SÍ tienen reglas Firestore (create cliente
  `false` para telemetry; create owner-pinned para uv) — contrasta con
  `health_vault*` que NO las tiene (DEEP-B7 §2, 🔴 ya abierto).

## Archivos limpios: 46
(De los 55: 8 hooks, los 18 services, los 11 routes core y job/trigger sin hallazgo
de seguridad propio; las 7 incidencias arriba tocan 8 archivos —
Hygiene/medicalAptitude/AnnualReview/telemetry(route+page)/SunTracker/HealthVaultViewer/
healthVault— y otras 3 son confirmaciones de hallazgos ya abiertos en DEEP-B7
—HealthVaultShare/Medicine— no recontadas como limpias.)
