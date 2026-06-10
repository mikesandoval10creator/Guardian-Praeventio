# Revisión de la Auditoría Técnica Externa — 2026-06-10

> Contraste, corrección y ampliación del informe externo "Auditoría Técnica
> Integral — Guardian / Praeventio Guard" recibido el 2026-06-10, verificado
> línea por línea contra el código en `main` (post-merge de los PRs #820 y
> #821 del mismo día). Toda cifra de este documento fue medida sobre el repo,
> no estimada.

## Veredicto sobre el informe externo

**El informe es serio y acierta en la dirección general** — su tesis central
("arquitectónicamente sólido, muy superior a un prototipo, pero por debajo de
lo que su propia documentación declara") coincide con la auditoría interna
exhaustiva de 2026-06 (`docs/audits/file-ledger/AUDIT-2026-06-FULL.md`).
Sin embargo, **trabaja sobre una foto vieja del repo** (aprox. estado
2026-05-04, el `STATE_OF_FUNCTIONALITY` que cita) y por eso falla en una
docena de hechos verificables, algunos a favor del proyecto y otros en
contra. Y desconoce por completo las dos olas de remediación mergeadas el
2026-06-10.

## A. Errores de hecho del informe (verificados contra el código)

| # | Afirmación del informe | Realidad medida (2026-06-10) |
|---|---|---|
| 1 | "`firestore.rules` (281 líneas)" | **1.762 líneas**, default-deny, con validadores de esquema por colección y rules-tests dedicados (`src/rules-tests/`). |
| 2 | "~23 routers" | **198 archivos de ruta** en `src/server/routes/` (sin contar tests). |
| 3 | "866 tests" | **1.311 archivos de test** (vitest + playwright + rules-tests); la suite CI corre en ~6 min. |
| 4 | "87 vs 219 páginas (inconsistencia)" | La inconsistencia documental existió; el número real hoy es **224 páginas** en `src/pages/`. La regla #20 de CLAUDE.md existe precisamente para este tipo de drift. |
| 5 | "Khipu **no existe en código**" | **Falso**: `src/services/billing/khipuAdapter.ts` existe con su test (`khipuAdapter.test.ts`). Lo que falta son credenciales reales, no código. |
| 6 | "MFA declarado pero sin evidencia de implementación" | **Falso**: TOTP completo con enrolamiento y códigos de recuperación (`src/services/auth/totp.ts`, `totpEnrollment.ts`, ambos testeados) + WebAuthn/passkeys para firmas (sitebook, currículum, DTE). |
| 7 | "Bluetooth Mesh sigue siendo exploración pendiente" | **Desactualizado**: existe BLE GATT nativo real en Kotlin (`packages/capacitor-mesh/android/.../MeshPlugin.kt`) y desde el PR #820 el plugin está **dentro del build Android** (era el hallazgo: estaba escrito pero fuera del APK). Pendiente: el pod iOS. |
| 8 | "modelo `gemini-3.1-pro-preview` hardcodeado en server.ts" | Parcial: hay **mezcla de modelos** server-side (37 usos de `gemini-3-flash-preview`, 21 de `gemini-3.1-pro-preview`, 4 variantes image/flash). Correcto en lo esencial: la clave vive solo en el server y el cliente pasa por la whitelist `/api/gemini`. |
| 9 | "README cita los derogados DS 40 y DS 54" | **Mitad cierto**: el README **no** cita DS 40 como vigente (dice "DS 54, DS 44/2024, Ley 16.744"). Pero **sí presenta DS 54 como marco vigente, y eso es un error real**: el DS 44/2024 derogó **ambos** (DS 40 y DS 54) desde el 01-02-2025. Corregido en este mismo PR (README + anotación en el pack normativo CL). |
| 10 | "Pinecone planificado pero sin key → fallback in-memory" | Correcto, y la auditoría interna lo cuantificó: el RAG efectivo era ~17 chunks bag-of-words. El 2026-06-10 se sumaron DS 132/76/67/148 + Ley 19.628 al corpus con URLs verificadas contra BCN; el pipeline de ingesta de texto completo sigue pendiente (tracker B22). |
| 11 | "NO hay envío real a SUSESO/SISESAT" | Cierto como hecho, **pero el informe lo lee como deuda olvidada y es una directiva de diseño**: "nunca push a APIs externas" (documentada en código, p. ej. `src/server/routes/incidentFlow.ts`). La app genera los documentos legales (DIAT/DIEP/PDF) para presentación manual. Integrar SISESAT (web services + XML firmado + CUN) requeriría revertir esa directiva explícitamente — decisión de producto, no bug. |
| 12 | "SLM on-device vs Gemini cloud" | **Matiz importante**: el razonamiento LLM hoy es 100% cloud (cierto), pero el SLM on-device **no es solo narrativa**: existe la infraestructura (orquestador 5-tier, worker ONNX, verificación de integridad SHA-256 de pesos `slmIntegrityCheck.ts`, prepackaging script) con la inferencia ONNX como **stub documentado e inventariado** (`docs/stubs-inventory.md`), gateado para no ser visible al usuario. Es un workstream trackeado, no humo — pero el informe acierta en que hoy no opera. |

## B. Lo que el informe no pudo ver: estado real post 2026-06-10 (PRs #820, #821)

El mismo día del informe se mergearon dos olas de remediación que cambian
varias de sus notas por pilar:

1. **Producción estaba literalmente caída desde el 2026-06-08** (crash de
   boot por `useProject()` fuera de provider — todo visitante veía "Sistema
   Interrumpido"). Diagnosticado por bisect del CI, corregido y verificado
   e2e 9/9. Ironía relevante para el informe: su sección de "madurez
   operativa" no detectó que la app ni siquiera bootaba.
2. **Cero crons corrían en producción** (mismatch OIDC vs secret) y la
   escalación de trabajador solitario **jamás se aprovisionó**. Corregidos y
   aprovisionados.
3. **Push FCM de incidentes críticos roto en móvil** (campo `fcmToken`
   singular vs `fcmTokens[]`). Corregido.
4. **GPS del SOS, QR y BLE muertos en el APK** (permisos ausentes del
   Manifest + plugins fuera de `capacitor.settings.gradle`). Corregidos.
5. Cuatro flujos Firestore muertos re-cableados (findings, documents_for_read,
   firma WebAuthn del SiteBook, health-check).
6. Gobernanza: repo a **0 errores ESLint** + gate CI nuevo; SIGTERM con
   drain; ratchet i18n (3.151 claves sin declarar, congeladas y bajando);
   módulos vida-seguridad ya traducidos a en/pt-BR (paridad pt-BR = 0).

## C. Correcciones a los porcentajes por pilar

La metodología del informe es razonable, pero sus números heredan la foto
vieja. Ajustes con evidencia:

| Pilar | Informe | Revisado | Por qué |
|---|---|---|---|
| Auth/roles/seguridad | 85% | **85%** | Coincide. TOTP+WebAuthn existen (el informe los negaba), pero KMS prod y SSO corporativo siguen pendientes. |
| Emergencias/crisis | 55% | **70%** | SOS e2e ✓, escalación lone-worker ahora aprovisionada ✓, FCM móvil ✓, brigada/evacuación traducidos ✓. Resta: mesh iOS, hardware DEA real en terreno. |
| Offline/Capacitor | 50% | **60%** | Mesh dentro del build Android + permisos corregidos + SQLite cifrado verificado real. Resta: build firmado en tiendas, pod iOS. |
| Reportabilidad DIAT/DIEP | 30% | **35%** | La generación documental es real; el 30% del informe castiga la falta de SISESAT, que es directiva de diseño (ver A.11). Si la decisión de producto cambia, este pilar es el de mayor esfuerzo. |
| Cumplimiento normativo | 40% | **55%** | El pack CL tiene DS 44 con derogación explícita del DS 40; hoy se corrige también la presentación del DS 54; corpus ampliado (DS 132/76/67/148, Ley 19.628). Resta: barrido de copy UI que cite DS 54 como vigente, Ley 21.719 (ver D). |
| IA/RAG | 65% | **65%** | Coincide. Pipeline de ingesta y embeddings reales siguen pendientes. |
| Mantenimiento general | — | — | El informe no pondera CI/CD: hoy 20/20 checks verdes, mutation testing en CI, 5 guards pre-commit. |

El "50-55% de madurez como producto comercializable" del informe era una
foto justa **antes** del 2026-06-10; la madurez de cableado subió
materialmente con las olas 1-2, pero la madurez **de producto** sigue
gateada por lo que el informe bien señala: secretos/infra reales, builds
firmados en tiendas, decisión SISESAT y barrido normativo de copy.

## D. Aportes del informe que se incorporan al roadmap (aciertos)

1. **DS 44 derogó también al DS 54** (vigente 01-02-2025, elecciones CPHS
   con voto secreto/auditable). → Corregido README y pack CL en este PR;
   queda en tracker el barrido del copy UI que cite DS 54 como marco
   vigente (`PHASE5-REMEDIATION.md`).
2. **Ley 21.719** (plena vigencia 2026-12-01): DPIA para biometría y
   geolocalización, registro de actividades de tratamiento, notificación de
   brechas en 72h, derechos ARCO+portabilidad. La base del repo es favorable
   (bóveda médica, default-deny, audit trail inmutable, biometría on-device
   por directiva #12), pero falta el artefacto de cumplimiento formal. →
   Nuevo ítem de tracker.
3. **SISESAT/CUN**: documentar la directiva "nunca push a APIs externas"
   como ADR formal, para que la decisión sea visible y reversible
   conscientemente (hoy vive en comentarios de código). → Nuevo ítem.
4. La advertencia sobre geolocalización 24/7 de trabajadores (Art. 22) como
   zona de alto riesgo regulatorio es correcta y debe entrar en la DPIA.

## E. Corrección de posicionamiento (contexto del fundador)

El informe presenta "open-source en TypeScript" como diferenciador
estructural #1. **Eso no aplica**: el repositorio es público por razones
operativas (plan de GitHub durante el desarrollo) y **pasará a privado para
el lanzamiento** en Google Play, App Store y praeventio.net. Los
diferenciadores defendibles reales son los otros que el propio informe
identifica:

- **Mobile-first + offline real** (IndexedDB/SQLite cifrado + mesh BLE) para
  faena sin señal — el punto ciego de los EHS enterprise.
- **Vida-seguridad gratis en todo tier** (ADR 0021): SOS, hombre-caído,
  evacuación, DEA, reporte de incidentes — sin paywall, por diseño.
- **Currículum preventivo portable del trabajador** (claims + WebAuthn +
  árbitro), que el informe correctamente destaca como de lo más completo.
- **Multi-jurisdicción por country packs** con citas legales verificables
  (BCN por idNorma).
- **Precio/segmento**: pymes y faenas chicas que el DS 44 ahora obliga a
  gestionar prevención, fuera del alcance de Cority/Enablon/Sphera.

## F. Síntesis

El informe externo es **útil y mayormente honesto**: su tesis macro es
correcta y sus dos mejores aportes (DS 54 derogado en el copy; Ley 21.719)
ya están incorporados al roadmap. Sus debilidades son la foto desactualizada
(metría 10-50× por debajo de lo real en rules/routers/tests; Khipu y MFA
negados existiendo; mesh "exploración" cuando hay Kotlin real), no haber
detectado que producción estaba caída, y leer como deuda una directiva de
diseño (SISESAT). Para decisiones de inversión o priorización, úsese este
documento + `AUDIT-2026-06-FULL.md` + `PHASE5-REMEDIATION.md` como fuente,
no el informe externo en bruto.
