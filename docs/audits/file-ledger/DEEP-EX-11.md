# DEEP-EX #11 — B5-Cumplimiento [0:55] · 2026-06-02

**Atestación:** leídos 55/55 línea por línea.

Lote derivado de `ledger.json` (`category` empieza con "FEAT" && `block==="B5-Cumplimiento"`,
ordenado por `path`, slice [0:55]). El bloque completo tiene 154 archivos FEAT.
Foco: hallazgos NUEVOS no cubiertos por `DEEP-B5-Cumplimiento.md`.

## Hallazgos NUEVOS

| Archivo:línea | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| `firestore.rules` (~251-478) + `components/documents/AddDocumentModal.tsx:121`, `EditDocumentModal.tsx:74-78`, `pages/Documents.tsx:77,85-87` | 🔴 | **Subcolección `projects/{pid}/documents` escrita client-side SIN regla de write** (patrón "client-SDK store sin regla" confirmado, mismo que el HALLAZGO CRÍTICO Sprint-K — pero `documents` NO fue arreglado). El master-gate `{subCollection=**}` (rules:258) solo da READ. `addDoc`/`updateDoc`/`deleteDoc` a esta subcolección → **default-deny en producción**. Toda la página Documentos (subir/editar/borrar) está rota en prod. | No existe `match /documents/{docId}` bajo `projects/{projectId}`; las únicas reglas son `project_documents` (top-level, rules:637) e `iso_documents` (rules:346). |
| `components/projects/ProjectDocuments.tsx:67-70,103` vs `pages/Documents.tsx:85-87` | 🟡 | **Split-brain de almacenamiento documental**: `ProjectDocuments` usa colección top-level `project_documents` (CON regla, funciona); `Documents`/Add/Edit usan subcolección `projects/{pid}/documents` (SIN regla, rota). Dos stores paralelos para "documentos del proyecto", uno inutilizable en prod. | Schemas distintos (`uploadedBy`/`size` vs `category`/`version`/`status`). |
| `components/workers/DocsModal.tsx:129,166` | 🔴 | **`addDoc`/`deleteDoc` a subcolección anidada `projects/{pid}/workers/{wid}/documents` SIN regla de write.** `workers/{workerId}` solo tiene regla top-level (rules:328); la subcolección anidada solo hereda READ del master-gate → escritura **default-deny en prod**. | rules:328 cubre `/workers/{workerId}` pero no `/workers/{wid}/documents/{docId}`. |
| `components/workers/DocsModal.tsx:120-127` vs `:61` | 🟡 | **Bug de listener invisible**: el query filtra `where('archived','==',false)` pero el doc creado en `newDoc` NO setea `archived:false`. El comentario (línea 60) reconoce que "doc creation must set archived=false" pero el código no lo hace → documentos recién subidos nunca aparecen en la lista (incluso si la regla permitiera el write). | `newDoc` (líneas 120-127) carece de campo `archived`. |
| `pages/SusesoReports.tsx:128,139-148` | 🔴 | **False-success en documento legal**: `handleShareDocument` ("Guardar en Drive") escribe a `projects/{pid}/documents` (subcolección sin regla → deny). El `addDoc` está en un try/catch interno (139) que traga el error; el flujo externo setea `savedToDrive=true` (143) **independientemente** del resultado del write. El usuario ve "Guardado en Drive ✓" aunque el metadata no se persistió. | El catch interno (139) no propaga; `setSavedToDrive(true)` corre siempre. |
| `pages/SusesoReports.tsx:419,423,448` | 🔴 | **Datos fabricados en PDF DIAT/DIEP legal**: el preview legacy (vía html2canvas → PDF descargable) sustituye **RUT falso `12.345.678-9`** cuando falta el RUT del trabajador, además de `'Operario'` (rol) y `'Instalaciones de la empresa'` (lugar). Genera un documento que aparenta ser DIAT/DIEP oficial con datos inventados. | `selectedIncident.metadata?.workerRut \|\| '12.345.678-9'`. |
| `pages/SusesoReports.tsx:68-93,316-347,363` | 🟡 | **Ruta legacy DIAT/DIEP no-conforme coexiste con el builder real**: `handleExportPDF`/`handleShareDocument` producen un "DIAT" vía screenshot sin folio atómico, sin firma WebAuthn, sin hash (usa `incident.id.substring(0,8)` como "Folio Interno"). El `SusesoFormBuilder` (correcto) está arriba en la misma página; el preview legacy puede descargar un PDF que parece oficial pero no lo es. | Folio = `selectedIncident.id.substring(0, 8).toUpperCase()` (línea 363). |
| `pages/Normatives.tsx:120-126` | 🟡 | **Mismatch de contenido legal en seed data**: entrada con `title: 'Decreto Supremo 40: Reglamento sobre Prevención de Riesgos Profesionales'` pero `code: 'DS 44/2024'`. DS 40 fue derogado/reemplazado por DS 44/2024 — título y código describen decretos distintos. Se siembra a la biblioteca global. | Objeto en `initialNormatives` (líneas 119-126). |
| `pages/LegalCalendar.tsx:98-116` | 🟡 | **Cambio de estado de cumplimiento sin audit_log**: "Marcar cumplida" hace read-modify-write client-side (`advanceObligation(entry)` → `saveObligation`) directo a Firestore, **bypasseando** la ruta server `/api/sprint-k/.../legal-calendar/acknowledge` (que sí escribe audit + es idempotente). Viola invariante audit-log (#3) para una obligación legal. Dual-impl: store client vs ruta server con `useLegalObligations`. | `handleMarkComplete` (98-116) usa `legalCalendarStore`, no el hook server-routed. |
| `server/jobs/runLegalCalendarReminders.ts:7,114-134` | 🟡 | **Cron emite recordatorio legal sin escribir audit_log**, pese a que el header (línea 7) afirma "emite reminder (FCM + audit_log)". La función no tiene ninguna escritura a `audit_logs` (a diferencia del hermano `sendSusesoReminders.ts:276` que sí lo hace). Doc-drift + gap de auditoría en evento de cumplimiento (DS 54 / Ley 16.744 plazos). | Sin `audit_logs` en todo el archivo; sí marca `reminders_sent` (127). |
| `components/compliance/ConsentBanner.tsx:95-104` | 🟡 | **Consentimiento Ley 19.628 con write no verificado**: el loop POST a `/api/compliance/consent` (4 finalidades) NO chequea `res.ok` ni captura errores por-item. Si el servidor rechaza una finalidad, el banner igual setea `localStorage` dismissed y cierra → el registro de consentimiento (fuente de verdad legal) puede quedar incompleto sin que el usuario lo sepa. | `for (const s of submissions) { await fetch(...) }` sin verificación de respuesta. |
| `pages/ImmutableRender.tsx:115` | 🟡 | **`tenantId: 'demo-tenant'` hardcodeado** en el artifact PDF + hash de un "certificado de cumplimiento". El comentario dice "En productivo viene del contexto Project/Tenant" pero no se cablea; el SHA-256 se computa sobre bytes que incluyen el tenant falso. Gated tras tier Diamante (`PremiumFeatureGuard`), pero igual envía a usuarios un certificado con tenant inválido. | `tenantId: 'demo-tenant', // En productivo viene del contexto`. |
| `components/suseso/SusesoFormBuilder.tsx:14-19,74-79`; `components/compliance/Ds67Builder.tsx:5-6,51-54`; `Ds76Builder.tsx:50-64` | 🔵 | **Doc-drift "(stub) WebAuthn / placeholder signature"**: los comentarios dicen que la firma es un stub que devuelve firma placeholder, pero `services/auth/webauthnComplianceSign.ts` ES la ceremonia completa endurecida (challenge single-use + verify cripto + counter). Comentarios obsoletos en flujos de firma legal. | `webauthnComplianceSign.ts:1-19` ("Full client ceremony for the HARDENED server sign flow"). |
| `pages/Reglamentos.tsx:23`; `pages/SusesoReports.tsx:536` | 🔵 | **Placeholders en datos de firmante legal**: `tenantId ?? 'praeventio'` (Reglamentos) y `rut: ''` hardcodeado vacío para el firmante SUSESO. Si el perfil no cargó, DS67/DS76/SUSESO se generan con tenant placeholder / RUT vacío. | `Reglamentos.tsx:23`, `SusesoReports.tsx:536`. |
| `pages/DocumentOCRManager.tsx:59` | 🔵 | **Regex OCR no soporta acentos**: `(?:nombre\|trabajador\|solicitante)[\s:]+([A-Za-z\s]+)` no captura `á/é/í/ó/ú/ñ`, truncando nombres chilenos (José, Muñoz). Afecta exactitud de extracción del nombre del trabajador en permisos digitalizados. | `text.match(/...([A-Za-z\s]+)/i)`. |
| `pages/Normatives.tsx:166` | 🔵 | **Seed client-side a colección global `normatives`** (`addDoc`). La regla permite lectura anónima pública (rules:543); verificar que el write esté gated por rol — cualquier miembro podría sembrar/contaminar la biblioteca normativa compartida entre tenants. | `addDoc(collection(db,'normatives'), norm)` tras dedupe por `code`. |

## Archivos limpios: 39

Sin hallazgos nuevos (presentacionales puros, hooks server-routed correctos, o ya
cubiertos por el doc previo):

- Componentes presentacionales: `ComplianceTrafficLight`, `PrivacyComplianceMatrix`,
  `ConsistencyAuditCard`, `ComplianceCard`, `ComplianceModal`, `DataQualityCard`,
  `NormativaWarningsBanner`, `IndustryNormsSummary`, `IndustryPresetCard`,
  `CookieConsent`, `LegalCalendarView`, `LegalObligationCard`, `NonConformityListPanel`,
  `NormativaSwitch`, `PrivacyRegimeCard`, `Iso45001Catalog`, `RegulatoryCitation`,
  `SusesoDeadlineBadge`, `ComplianceAuditor` (usa compliance-AI, no diagnosis).
- Hooks server-routed (todos `apiAuthHeaders` + `/api/sprint-k/...`, manejo de error
  sin filtrar internals, `res.json().catch(()=>({}))`): `useConsistency`, `useDataQuality`,
  `useDocumentVersioning`, `useIndustryRules`, `useLegalCalendar`, `useLegalObligations`,
  `useNonConformity`, `usePrivacyRetention`, `usePrivacyShield`, `useRegulatoryFramework`,
  `useRetaliationProtection`.
- Pages/otros: `ConsistencyAudit` (read-only Firestore), `DocumentViewer` (read-only,
  master-gate cubre lectura), `MinsalProtocols` (Gemini compliance, tier-gated),
  `NormativeDetail` (read-only + idb-keyval), `PrivacyPolicy`, `Terms`,
  `ComplianceRoutes` (wiring lazy), `sendSusesoReminders` (cron robusto, audit+idempotencia
  correctos).

## Notas de severidad

- 🔴 (5): 3 colecciones/subcolecciones escritas client-side sin regla Firestore
  (`projects/{pid}/documents`, `workers/{wid}/documents`) → escrituras default-deny en
  prod; false-success "Guardado en Drive"; RUT fabricado en PDF DIAT/DIEP legal.
- 🟡 (8): split-brain documental, listener invisible, ruta SUSESO legacy no-conforme,
  mismatch DS 40/DS 44 en seed, audit-log faltante (calendar acknowledge + reminder cron),
  consentimiento 19.628 sin verificación de write, tenant demo hardcodeado.
- 🔵 (4): doc-drift "stub WebAuthn", placeholders firmante, regex OCR sin acentos, seed
  normativas global.

## Resumen (6-10 líneas)

Leídos 55/55 archivos línea por línea. El hallazgo dominante es **el patrón confirmado
de subcolecciones escritas client-side sin regla Firestore de write**, extendido a DOS
nuevas colecciones que el fix Sprint-K NO cubrió: `projects/{pid}/documents` (toda la
página Documentos + Add/Edit + el "Guardar en Drive" de SUSESO) y `projects/{pid}/workers/
{wid}/documents` (DocsModal). Ambas quedan en default-deny en producción — feature rota
y silenciosa. Agravante 🔴: `SusesoReports.handleShareDocument` muestra "Guardado en Drive ✓"
aunque el write se denegó (false-success), y el preview legacy DIAT/DIEP fabrica un **RUT
falso `12.345.678-9`** en un documento legal. Hay además split-brain documental
(`project_documents` top-level funciona vs subcolección rota) y dual-impl en el calendario
legal donde "Marcar cumplida" bypassa el server y omite el audit_log (viola invariante #3).
El cron `runLegalCalendarReminders` no escribe audit_log pese a afirmarlo el comentario,
y el consentimiento Ley 19.628 se registra sin verificar `res.ok`. Mismatch de contenido
legal en el seed (DS 40 etiquetado DS 44/2024). Doc-only, sin git commit.
