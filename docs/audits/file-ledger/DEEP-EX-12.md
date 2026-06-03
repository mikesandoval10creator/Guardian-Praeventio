# DEEP-EX #12 — B5-Cumplimiento [55:110] · 2026-06-03

**Atestación:** leídos 55/55 línea por línea (cumplimiento / SUSESO / DTE / firmas /
calendario legal / retención de datos).

Lote derivado de `ledger.json`: `category` empieza con "FEAT" && `block==="B5-Cumplimiento"`,
ordenado por `path`, slice `[55:110]` (55 archivos). Los docs previos `DEEP-B5-Cumplimiento.md`
y `DEEP-EX-11.md` (no existe aún) NO se solapan con lo aquí reportado; estos son hallazgos
NUEVOS de la lectura exhaustiva.

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `src/server/routes/suseso.ts:157,196,313,335` + `src/server/routes/ds67ds76.ts:186,225,273,356,390,436` | 🔴 | **`tenantId` controlado por el cliente sin `assertProjectMember` ni verificación de propiedad** en TODOS los endpoints de SUSESO (DIAT/DIEP) y DS-67/DS-76. El `tenantId` llega en body/query y se usa directo como segmento de path Firestore (`tenants/{tenantId}/suseso_forms`, `tenants/{tenantId}/ds67_forms`). Como las rutas usan Admin SDK (bypass de `firestore.rules`), **cualquier usuario autenticado puede crear/firmar/enviar/marcar formularios legales de accidentes (DIAT/DIEP) y reglamentos DS-67/DS-76 bajo el tenant de OTRA empresa**, fabricar folios e inyectar denuncias de accidentes en su árbol. Viola convención #6. | `suseso.ts:340 tenantId = (req.body?.tenantId ?? '')`; `ds67ds76.ts:226 tenantId = (req.query.tenantId ?? '')`; ningún `assertProjectMember`/ownership en el archivo. |
| `src/services/compliance/ds67/ds67Service.ts:253-309` + `ds76Service.ts:173-225` + `src/services/suseso/susesoService.ts signForm` | 🔴 | **Firma `kms-sign-rsa` persistida SIN verificación criptográfica.** `signForm` (las 3 variantes) solo valida la *forma* de la firma (presencia de `signerUid`/`signerRut`/`signatureB64` y que `payloadHashHex` sea hex de 64 chars). El route solo corre la ceremonia WebAuthn cuando `algorithm==='webauthn-ecdsa-p256'`; para `kms-sign-rsa` **no hay verificación alguna** ni check `signerUid===callerUid`. Un usuario autenticado POSTea `{algorithm:'kms-sign-rsa', signatureB64:<cualquier base64>, signerUid:<otro uid>}` y queda persistido como firma "válida" del reglamento legal. `kms-sign-rsa` está en el `z.enum` de ambos sign schemas (`ds67ds76.ts:159`, `suseso.ts:130`). | `ds67Service.ts:284-289` solo regex sobre `payloadHashHex`; `attachSignature` se llama sin verificar firma. |
| `src/server/routes/ds67ds76.ts:285-326` + `suseso.ts:209-259` (binding) | 🟡 | **El `payloadHashHex` de la firma NUNCA se ata criptográficamente al documento firmado.** Aun en el camino WebAuthn, `verifyWebAuthnAssertion` verifica que el usuario firmó el *challenge aleatorio del servidor* (`webauthnComplianceSign.ts:92-105`), no el hash del PDF. El `payloadHashHex` viene del cliente y no se compara contra el hash real del form almacenado (`signForm` solo valida que sea hex-shape). Resultado: la "firma" prueba "el usuario hizo un gesto biométrico en una sesión", no "aprobó ESTE documento". Para una firma legal DS/DIAT eso es un binding débil. | `requestComplianceSignature` firma `challengeBytes` (server-issued random), `signature.payloadHashHex` se transporta aparte sin re-verificar contra `existing` PDF hash. |
| `src/server/routes/suseso.ts:313-329` | 🟡 | **`POST /form/:id/submit` (registra envío a mutualidad) NO escribe `audit_logs`.** Es una operación que cambia estado (`submitToMutualidad`) pero no llama `auditServerEvent` — a diferencia de `form_created`, `form_signed`, `mark-submitted` que sí auditan. Viola invariante #3 (toda operación que cambia estado audita). | El handler retorna `{form: updated}` sin `auditServerEvent`. |
| `src/server/routes/legalObligations.ts:32-35,64,125-151` ↔ `src/services/legalCalendar/legalCalendarStore.ts:12` + `firestore.rules:470` | 🟡 | **Split-brain de colección: el servidor y el cliente escriben colecciones distintas.** La ruta lee/escribe la colección **top-level** `legal_obligations` filtrada por campo `projectId` (`db.collection('legal_obligations').where('projectId','==',...)`). El store cliente (`createProjectScopedStore('legal_obligations')`) y la regla Firestore (`:470`) usan la **subcolección** `projects/{projectId}/legal_obligations/{id}`. Son dos colecciones físicas diferentes → las obligaciones creadas por la UI son invisibles a los endpoints `upcoming/overdue/history` (y al cron) y viceversa. El comentario de la ruta afirma "project-scoped via projectId field" pero contradice rules+store. | `createProjectScopedStore.ts:149 return 'projects/${projectId}/${collectionName}'` vs `legalObligations.ts:128 .collection('legal_obligations').where('projectId','==',projectId)`. |
| `src/server/routes/dte.ts:367-379,384-394,415-428` | 🟡 | **Audit `auditServerEvent(...).then(...)` no-awaited (fire-and-forget) — patrón #14 prohibido.** Las 3 escrituras de audit (`dte.signed`, `dte.sign_failed`, `dte.generated`) usan `.then()` sin `await`, así que la respuesta HTTP se envía antes de que la fila de audit aterrice. Los routes hermanos `ds67ds76.ts`/`suseso.ts` SÍ hacen `const auditOk = await auditServerEvent(...)`. El comentario "auditServerEvent returns boolean (never throws)" no exime de #14, que exige `await` para no perder la traza de compliance ante fallo de Firestore. | `auditServerEvent(req,'dte.generated',...).then((ok)=>{...})` sin `await`, a diferencia del patrón `await` correcto en suseso/ds67. |
| `src/server/routes/dte.ts:342,395` + `complianceEmit.ts:170` + `bcn.ts:132-134` | 🟡 | **5xx/4xx filtran `err.message` interno al cliente (#8).** `dte.ts:342 res.status(422).json({...,message:(err as Error).message})` y `:395` (`dte_sign_failed`) devuelven el mensaje crudo del error. `complianceEmit.ts:168-171` devuelve `message: err.message` en el 500. `bcn.ts:129-135` devuelve `error.message` en el 500. Sin el guard `NODE_ENV==='production' ? 'Internal server error' : err.message` exigido por #8. | Literales en las líneas citadas. |
| `src/services/legalBackend.ts:89,137` | 🟡 | **`JSON.parse(response.text)` de respuesta Gemini SIN try/catch (#5).** `auditLegalGap` (`:89 const parsed = JSON.parse(response.text)`) y `evaluateNormativeImpact` (`:137 JSON.parse(response.text ?? '{}')`) parsean la salida del LLM sin envoltura try/catch ni fallback tipado/502. Una respuesta Gemini malformada lanza un parse error no-tipado que escala como 500. Viola directiva #5 (`Wrap JSON.parse(response.text) in try/catch with a typed fallback or 502`). | Líneas literales; sólo `:88` chequea `!response.text`, no el parseo. |
| `src/services/compliance/registry.ts:314-352` ↔ `src/server/routes/complianceEmit.ts:154-160` | 🟡 | **Generadores `committee_minutes` / `training_record` (y parcial `safety_inspection`/`occupational_injury`/`aptitude_cert`) son stubs disfrazados expuestos en `/api/compliance/emit`.** `clCommitteeMinutesAdapter.generate` y `clTrainingRecordAdapter.generate` solo hacen `return { json: { adapter:'...', ...payload } }` — eco del input, sin PDF. El route responde 200 con `formats: adapter.suggestedFormats` (`['application/pdf']`) y `citation` legal, dando la impresión de que se emitió un documento legal válido cuando no se generó nada. No hay feature-flag/503, ni `// TODO(sprint-N):<owner>`, ni entrada en `docs/stubs-inventory.md` (viola #13). Comentarios admiten "concrete generator is wired in Sprint 39". | `registry.ts:329-331,348-350`; `complianceEmit.ts:154-160 formats: adapter.suggestedFormats`. |
| `src/services/legal/legalRuleEngine.ts:80-81,95-96` | 🟡 | **Umbrales legales off-by-one en obligaciones críticas.** Regla `cphs_25_workers` usa `workersCount >= 25` pero la cita (DS 54 / Ley 16.744 art. 66) obliga CPHS con **"más de 25"** trabajadores (26+). Regla `prevention_dept_100_workers` usa `>= 100` cuando el Depto. de Prevención es obligatorio con **"más de 100"**. La regla emite `urgency:'critical'` y alimenta el semáforo F.2 a "rojo", por lo que en el borde exacto (25 / 100) marca incumplimiento donde la ley aún no exige el comité/depto. | `predicate: (p) => p.workersCount >= 25` / `>= 100`. |
| `src/server/routes/legalObligations.ts:284-310,361-390` | 🔵 | **Persistencia best-effort que diverge de la respuesta + audit.** En `acknowledge`/`snooze`, si el `db.set(...)` falla se traga en try/catch (`persist_failed`) pero el handler igual responde 200 con `{obligation: next}` Y escribe el audit con el nuevo `nextDueAt`. Resultado: audit+cliente afirman que la obligación rodó al siguiente ciclo aunque Firestore conserve la fecha vieja → divergencia silenciosa estado/traza. | `catch (persistErr) { logger.warn(...) }` seguido de `auditServerEvent(...)` y `res.json({obligation: next})`. |
| `src/services/compliance/ley19628.ts:512-561` | 🔵 | **`eraseUserData(uid,{keepLegalRecords:false})` borra `audit_logs`/`incidents`/`sos_alerts` vía Admin SDK**, contradiciendo el invariante append-only (#3, `delete:false` en rules). Está gated tras opt-in DPO (default `keepLegal=true`) y el route nunca lo invoca con `false`, pero el camino existe y destruiría la cadena de compliance + retención 7 años Ley 16.744/DS 594. | `:543-552 db.collection(collection).doc(doc.id).delete()` sobre `LEGAL_RETENTION_COLLECTIONS`. |
| `src/services/bcnService.ts:82` | 🔵 | **Posible `idNorma` legal incorrecto.** `CRITICAL_LAWS` mapea `{id:'25510', name:'DS 44/2024 (Prevención de Riesgos Profesionales)'}`. El idNorma real de DS 44/2024 en LeyChile no es `25510` (ese rango corresponde a normas mucho más antiguas), por lo que el snapshot BCN serviría el texto de una norma equivocada como "DS 44/2024". Verificar contra BCN antes de release. | Constante literal; el route `bcn.ts` la fetchea como ley crítica para distribución offline. |
| `src/services/dte/dteIssueQueue.ts:16,159-185` | 🔵 | **Doc-drift en backoff.** El comentario de cabecera dice "attempt ≥ 6 → permanent_failure" y describe un tramo "attempt 5 → 24 h", pero `MAX_ATTEMPTS = BACKOFF_SCHEDULE_MS.length = 5`, así que `markFailed` marca `permanent_failure` al fallar el **intento 5** y el tramo de 24 h nunca se usa. | `BACKOFF_SCHEDULE_MS` tiene 5 entradas; `if (attempts >= MAX_ATTEMPTS)` con `attempts===5`. |
| `src/server/routes/complianceEmit.ts:61-67` | 🔵 | **Role-gating sobre claim global `req.user.role`.** `getReqRole` lee `req.user.role` (claim global del ID token, poblado en `verifyAuth.ts:153`) sin scope por proyecto. Para `tax_invoice`/medical emit esto exige claim admin/doctor global; es consistente con el patrón del repo (mismo modelo señalado en EX-10 para `roleViews`/`projects`) y `/emit` no toca un `projectId`, pero el rol no está atado a tenant. By-design hoy, anotado por completitud. | `getReqRole` + `ROLE_ALLOWLIST[type]`; no hay `assertProjectMember`. |

## Archivos limpios: 39

Rutas con `verifyAuth` + `assertProjectMember` (guard correcto), engines puros, error
bodies sin internals, audit `await`-eado correctamente:
`annualReview.ts` (transacciones #19 correctas en objectives/evidence/conclude, audit
await, guard de membresía + tenant), `compliance.ts` (RAT público intencional, IDOR check
`request.uid!==uid`, audit await), `documentVersioning.ts` (guard + immutability 409 + audit
await), `expirations.ts`, `expressBundle.ts` (identidad `generatedBy.uid`/`generatedAt`
forzadas server-side), `industryRules.ts`, `nonConformity.ts`, `privacyRetention.ts`,
`regulatoryFramework.ts` (todas pure-compute project-gated).

Servicios calc/persistencia puros y correctos:
`annualSgiReview.ts` (progreso normalizado reduction/increase correcto), `annualReviewFirestoreAdapter.ts`,
`documentVersioningFirestoreAdapter.ts` (immutability create-once + terminal-state guards),
`expressBundleBuilder.ts` (PDF pdfkit puro), `trafficLightEngine.ts` (semáforo determinístico),
`ley19628.ts` (consent/RAT/export con `.where(uid)` belt-and-braces — salvo el erase opt-in
del 🔵), `normativeAuditLog.ts` (hash-chain SHA-256 real + verify), `registry.ts` (resolución
de adapter; salvo stubs CL del 🟡), `dteAutoIssueOrchestrator.ts` (RUT mod-11 DV correcto,
idempotencyKey sha256, decisión pura), `dteIssueQueue.ts` (backoff puro; salvo doc-drift 🔵),
`environmentalCompliance.ts` (manifiestos/huella/permisos puros), `expirationScanner.ts`,
`industryRuleEngine.ts`, `legalObligationsCalendar.ts` (recurrencias correctas),
`nonConformityEngine.ts` (lifecycle + bulk pattern puro), `countryPacks.ts`,
`locationNormativa.ts` (bbox + geocode con AbortError-propagation + URL hardening),
`legalCalendarStore.ts`, `calendar/legalObligations.ts`, `capacity/normativeAlerts.ts`,
`documents/documentVersioning.ts` (engine semver), `documents/legalDocTemplates.ts`,
`legal/termsContent.ts`, `webauthnComplianceSign.ts` (cliente; ceremonia con challenge
server-issued — pero binding del hash documentado como 🟡 arriba).

Adapters scaffold jurisdiccionales (`au/ca/in/jp/kr/uk/index.ts`) + `adapters/index.ts` +
`jurisdictionErrors.ts`: stubs CORRECTAMENTE documentados — lanzan
`AdapterNotImplementedError` (no devuelven mock disfrazado), con `ADAPTER_STATUS` explícito
`scaffold` y mensaje "pendiente Sprint X". `adapters/cl/index.ts` es re-export puro de los
servicios CL reales.

## Notas menores (no-finding)
- `ds67ds76.ts` / `suseso.ts`: para `kms-sign-rsa`, el route tampoco fuerza `signerUid===callerUid`
  (el check solo vive en la rama WebAuthn) — subsumido en el 🔴 de firma sin verificación.
- `legalBackend.ts:59,119`: usa `gemini-3.1-pro-preview` en `auditLegalGap` y `gemini-2.0-flash`
  en `evaluateNormativeImpact` — inconsistencia de modelo (posible modelo stale en el segundo).
- `documentVersioning.ts` route `setStatus`+`supersedeVersion` son 2 writes separados (no
  transacción) sobre docs distintos del mismo chain — borderline #19, bajo riesgo.
- `dte.ts:74` `context as any` en `dteSentryCapture` — cosmético.
