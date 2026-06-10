# Roadmap de cumplimiento — Ley 21.719 (Datos Personales, Chile)

Estado: **borrador para revisión legal** · Última verificación de código: 2026-06-10
Responsable: fundador (pendiente designar encargado/DPO — ver gap G-7).

## 1. Marco

La **Ley 21.719** (publicada 13-12-2024) reforma la Ley 19.628 y crea la
**Agencia de Protección de Datos Personales**. **Plena vigencia:
01-12-2026** — quedan ~6 meses. Exigencias centrales para Praeventio Guard:

1. **EIPD/DPIA** para tratamientos de alto riesgo.
2. **Registro de actividades de tratamiento** (RAT).
3. **Notificación de brechas** a la Agencia (el runbook del repo adopta 72h
   como estándar operacional; ver §4 por la discrepancia de citación).
4. **Derechos ARCO + portabilidad** (acceso, rectificación, cancelación,
   oposición; plazo de respuesta 30 días).
5. **Límite a decisiones exclusivamente automatizadas** con efectos
   jurídicos o significativos.
6. Deber de seguridad, consentimiento por finalidad, transferencias
   internacionales, gobernanza.

Praeventio trata **datos sensibles** (salud ocupacional, biometría de pose,
geolocalización de trabajadores) → caemos de lleno en el régimen de alto
riesgo. Regla de este documento: **ningún "ya cubierto" sin `file:line`
verificado**; lo que falta se declara sin eufemismos.

## 2. Mapa exigencia → estado del repo

| # | Exigencia | Estado | Evidencia / gap |
|---|---|---|---|
| 1 | EIPD/DPIA alto riesgo | 🟡 Parcial | Generador PDF existe pero está **huérfano**; no existe NINGUNA EIPD completada (§3) |
| 2 | RAT | 🟢 Mayormente | `PROCESSING_ACTIVITIES` + endpoint público (§5); faltan actividades (bóveda médica, WebAuthn) |
| 3 | Notificación de brechas | 🟡 Parcial | Runbook manual con 72h; sin workflow ni plantilla a la Agencia; citaciones inconsistentes (§4) |
| 4 | ARCO + portabilidad | 🟢 Mayormente | Solicitudes + export self-service operativos; borrado y procesamiento de acceso cableados a rutas admin (`compliance.ts:390,440`, G-8 resuelto); falta job de plazo 30 días (§6) |
| 5 | Decisiones automatizadas | 🟢 De facto | Patrón "nunca bloquear, solo recomendar" en todo el server; falta política formal (§7) |
| 6 | Deber de seguridad | 🟢 Fuerte | Default-deny, bóveda médica, audit inmutable, SQLCipher, KMS, biometría on-device (§8) |
| 7 | Consentimiento | 🟢 Mayormente | ConsentBanner montado + registros versionados (§9) |
| 8 | Gobernanza / transferencias | 🔴 Falta | Sin DPO, sin mecanismo documentado de transferencia internacional (§10) |

## 3. EIPD / DPIA (alto riesgo) — 🟡

**Qué exige:** evaluación de impacto previa cuando el tratamiento implique
alto riesgo (datos sensibles a gran escala, biometría, geolocalización
sistemática de trabajadores).

**Qué tenemos (verificado):**

- Generador PDF de DPIA/EIPD multi-régimen que cita explícitamente
  *"Ley 21.719 (CL) — Evaluación de Impacto en Protección de Datos"*:
  `src/services/privacy/dpiaTemplate.ts:1-15` (tipos `DpiaInput`,
  `DpiaDataFlow`, `DpiaMitigation`), con tests en
  `src/services/privacy/dpiaTemplate.test.ts:52`.
- El régimen chileno declara `dpiaRequired: true`:
  `src/services/privacy/regimes/ley19628.ts:43`.

**Gaps (honestos):**

- **G-1 (P0):** `generateDpiaPdf` es **código huérfano** — grep 2026-06-10:
  ningún archivo en `src/server/` ni `src/pages/` lo importa; solo su test.
  El comentario `dpiaTemplate.ts:10-12` dice que el route layer haría el
  tier-gating, pero ese route no existe.
- **G-2 (P0 — el de mayor riesgo de todo el roadmap):** **no existe ninguna
  EIPD completada para los tratamientos propios de Praeventio**, en
  particular: (a) biometría de pose para REBA/RULA
  (`src/hooks/useMediaPipePose.ts:1-18` — aunque sea on-device, el
  tratamiento existe y la EIPD debe documentar por qué el riesgo residual es
  bajo), (b) **geolocalización de trabajadores** (SOS, lone-worker, zonas —
  RAT `geolocation_telemetry` en `src/services/compliance/ley19628.ts:145-159`,
  posiciones en `src/server/routes/firstResponderMap.ts:227-230`),
  (c) bóveda médica (`firestore.rules:329`). No hay ningún documento EIPD en
  `docs/` (grep "DPIA|EIPD|evaluación de impacto" solo encuentra el
  generador).
- **G-3 (P2):** la retención del RAT declara *"indefinido para alertas SOS"*
  e *"indefinido para agregados anónimos"*
  (`src/services/compliance/ley19628.ts:153,189`) — "indefinido" requiere
  justificación de proporcionalidad en la EIPD o un plazo.

## 4. Notificación de brechas — 🟡

**Qué tenemos (verificado):**

- `docs/runbooks/INCIDENT_RESPONSE.md:180` — *"Ley 21.719 art. 50: reporte a
  ANPD dentro de 72h si hay brecha de datos personales"*; tabla de contactos
  en `:390` (responsable: Daho, 72h); severidad P0 incluye *"brecha de
  seguridad activa con datos personales expuestos"* con notificación a
  usuarios < 24h (`:25`); postmortem dentro de 72h (`:113`).
- El spec de régimen codifica honestamente la ausencia de cap horario en el
  texto legal: `src/services/privacy/regimes/ley19628.ts:17-19,44`
  (`breachNotificationDeadlineHours: null`, *"tan pronto como sea posible"*).

**Gaps:**

- **G-4 (P0):** discrepancia doc-vs-código que la revisión legal debe
  zanjar: el runbook cita "art. 50" y "72h"; el spec de régimen cita art. 31
  sin cap horario. Además el runbook llama **"ANPD"** a la autoridad chilena
  — ANPD es la autoridad de **Brasil**; la chilena es la **Agencia de
  Protección de Datos Personales** (nombre correcto ya usado en
  `src/services/privacy/regimes/ley19628.ts:29`). Corregir cita + nombre;
  mantener 72h como estándar operacional interno (más estricto) es válido,
  pero hay que documentarlo como decisión, no como cita legal.
- **G-5 (P1):** no existe workflow ejecutable de notificación: ni plantilla
  de reporte a la Agencia, ni registro estructurado de brechas (colección +
  `audit_logs`), ni clasificador "¿afecta datos personales? → arranca reloj".
  Hoy todo es prosa del runbook.

## 5. Registro de actividades de tratamiento (RAT) — 🟢

**Qué tenemos (verificado):**

- Catálogo `PROCESSING_ACTIVITIES` con 6 actividades (finalidad, base de
  licitud, categorías, destinatarios, transferencia internacional,
  retención, medidas técnicas): `src/services/compliance/ley19628.ts:117-219`
  (`core_safety_data`, `geolocation_telemetry`, `identity_authentication`,
  `gamification_engagement`, `billing_subscription`, `observability_errors`).
- Expuesto **públicamente** sin auth (cualquier titular o fiscalizador lo
  puede auditar): `GET /api/compliance/processing-activities` —
  `src/server/routes/compliance.ts:74-79`.
- El régimen CL marca `recordOfProcessingRequired: true`:
  `src/services/privacy/regimes/ley19628.ts:45`.

**Gaps:**

- **G-6 (P1):** el RAT no cubre todos los tratamientos reales: faltan al
  menos (a) **bóveda médica** `health_vault` con cifrado KMS-envelope
  (`firestore.rules:320-331`), (b) firma biométrica WebAuthn de documentos
  regulatorios (ADR 0017/0022), (c) exámenes médicos `medical_exams`
  (`firestore.rules:289`) como actividad separada de `core_safety_data`,
  (d) mesh relay (`packages/capacitor-mesh/`). Revisar inventario Firestore
  de `ARCHITECTURE.md` contra el RAT.

## 6. Derechos ARCO + portabilidad — 🟢 mayormente

**Qué tenemos (verificado 2026-06-10):**

- Servicio completo de derechos del titular (consent + solicitudes
  access/rectification/erasure/portability):
  `src/services/compliance/ley19628.ts` — `recordConsent` (:292),
  `revokeConsent` (:314), `processDataAccessRequest` (:411),
  `exportUserData` (:484), `eraseUserData` (:514, con
  `keepLegalRecords: true` por la retención de 7 años Ley 16.744/DS 594,
  comentario :18-22).
- Rutas montadas: `src/server/routes/compliance.ts` — consent POST/DELETE/GET
  (:98, :146, :174), `POST /data-request` (:217), `GET /data-request/:id`
  (:278), `GET /data-export/:requestId` con descarga JSON inline del propio
  titular (:312, usa `exportUserData`).
- Procesamiento admin de solicitudes (cierra G-8):
  `POST /api/compliance/admin/data-request/:id/process` (compliance.ts:390)
  y `POST /api/compliance/admin/data-request/:id/erase` (compliance.ts:440),
  ambas con gate admin re-leído de Firebase Auth (compliance.ts:373) y
  audit_logs; tests `src/__tests__/server/complianceArco.test.ts`.
- Centro de control del titular en la UI: `src/pages/MyData.tsx:3,163-166`
  (*"consultar, rectificar, exportar o eliminar tus datos"*), montado en el
  sidebar (`src/components/layout/sidebarMenuGroups.ts:325`).
- Portabilidad del historial preventivo del trabajador con consent como
  hard-gate: `src/server/routes/portableHistory.ts:7,12,368` y página
  `src/pages/WorkerPortableHistory.tsx:23`.
- Plazo 30 días codificado: `src/services/privacy/regimes/ley19628.ts:39`.
- Revocación de acceso inmediata para desvinculados:
  `src/server/services/userLifecycle.ts` (`deactivateUser`, revoca refresh
  tokens + claim `inactive`).

**Gaps:**

- **G-8 (P0): ✅ RESUELTO 2026-06-10.** `processDataAccessRequest` y
  `eraseUserData` ya tienen superficie admin:
  `POST /api/compliance/admin/data-request/:id/process`
  (`src/server/routes/compliance.ts:390`, completa access/portability y
  apunta `exportedToUrl` al export self-service) y
  `POST /api/compliance/admin/data-request/:id/erase`
  (`src/server/routes/compliance.ts:440`, destructivo: exige body
  `{ confirm: requestId }`, borra con `keepLegalRecords: true` fijo, audita
  antes `arco_erasure_started` y después `arco_erasure_executed`). Gate
  admin con rol re-leído de Firebase Auth
  (`src/server/routes/compliance.ts:373`). Tests supertest con funciones
  reales de ley19628: `src/__tests__/server/complianceArco.test.ts` (14
  casos: 401/403/404/400-sin-confirm/200-happy/idempotencia). Pendiente
  derivado: rectification sigue sin apply automatizado (manual + audit) y
  el cierre dentro de 30 días depende del job G-9.
- **G-9 (P1):** sin tracking del plazo de 30 días (job que alerte
  solicitudes por vencer + escalamiento).
- **G-10 (P2):** el export inline es el *"simple-case fallback"* para
  payloads chicos (`compliance.ts:293-297`); el camino de export grande vía
  signed URL (`onExport`, `ley19628.ts:413-433`) no está cableado.
- **G-11 (P2):** la copy de `MyData.tsx:163` cita solo "Ley 19.628";
  actualizar a "Ley 19.628 modificada por Ley 21.719" (como ya hace
  `src/components/auditPortal/PortalPublicView.tsx:566`).

## 7. Decisiones exclusivamente automatizadas — 🟢 de facto

**Qué exige:** derecho a no ser objeto de decisiones basadas únicamente en
tratamiento automatizado que produzcan efectos jurídicos o significativos.

**Qué tenemos (verificado):**

- El derecho está codificado: `'no_automated_decision'` en
  `src/services/privacy/regimes/ley19628.ts:36` y
  `src/services/privacy/types.ts:47`.
- La arquitectura cumple **por diseño** vía la directiva del fundador "nunca
  bloquear, solo recomendar": ningún motor automatizado bloquea maquinaria,
  acceso físico ni empleo — siempre hay humano que decide. Evidencia:
  `src/server/routes/equipmentQr.ts:17`, `src/server/routes/horometro.ts:13`,
  `src/server/routes/fatigue.ts:13` (*"NEVER blocks machinery — only flags"*),
  `src/server/routes/softBlocking.ts:15`,
  `src/server/routes/restrictedZones.ts:5,363` (*"log informed-entry event
  (NEVER blocks)"*), `src/server/routes/workPermits.ts:353` (override humano
  con razón documentada), `src/hooks/useRestrictedZones.ts:10`.
- ADR 0012 prohíbe diagnóstico automatizado de salud (hook pre-commit
  `scripts/precommit-medical-guard.cjs`).

**Gaps:**

- **G-12 (P2):** falta una **política formal publicada** que conecte ambos
  mundos: declarar que las salidas de IA (Gemini) y los motores de cálculo
  son recomendaciones revisadas por humanos, y citar la lista de evidencia
  anterior. Hoy el cumplimiento es real pero implícito.

## 8. Deber de seguridad — 🟢 fuerte

Todo verificado en código:

- **Firestore default-deny** (1k+ LOC, `firestore.rules`) con bóveda médica
  estricta: `medical_exams` solo titular o médico (`firestore.rules:289-292`),
  `health_vault` **denegado por completo al cliente** — solo server-side con
  KMS-envelope sobre los blobs (`firestore.rules:320-331`), tokens de
  compartición con hash SHA-256 y write-deny total
  (`firestore.rules:333-350`).
- **`audit_logs` inmutable y append-only por servidor**:
  `firestore.rules:999-1009` (`create: if false` cliente, `update, delete:
  if false`); invariante de auditoría en cada cambio de estado (CLAUDE.md
  convención #3).
- **Cifrado SQLite on-device (SQLCipher)**: `src/utils/sqliteEncryption.ts:1-35`
  (passphrase 256-bit en secure store nativo, nunca en preferences),
  aplicado en `src/utils/pwa-offline.ts:78` y
  `src/utils/offlineStorage.ts:92` (`encrypted: true`).
- **KMS envelope** para tokens OAuth y blobs médicos, default-ON:
  `KMS_ROTATION.md` §1 (raíz del repo; `OAUTH_ENVELOPE_ENABLED` por defecto
  desde B17 Fase 5; DEK AES-256-GCM por token + KEK en Cloud KMS).
- **Biometría 100% on-device** (CLAUDE.md directiva #12): MediaPipe Pose
  corre en el dispositivo (`src/hooks/useMediaPipePose.ts:1-18`); ningún
  frame de cámara ni frecuencia cardíaca sale del dispositivo.
- **Android `allowBackup="false"`** + guard pre-commit (CLAUDE.md #17).
- Acceso de auditores externos por token con scope y TTL (audit portals,
  `src/pages/AuditPortals.tsx:42`) en vez de cuentas permanentes.

**Gap menor — G-13 (P2):** el modelo `.task` de MediaPipe se sirve desde CDN
de Google (`useMediaPipePose.ts:8-9`) — no salen datos, pero la EIPD debe
mencionarlo y el bundle local ya está planificado ("Ola 5 Bucket O").

## 9. Consentimiento — 🟢 mayormente

- Banner de consentimiento por finalidad montado para todo usuario
  autenticado: `src/App.tsx:34,527`;
  `src/components/compliance/ConsentBanner.tsx:4-13`.
- Registros de consentimiento con base de licitud y **versión del texto**
  (`textVersion` para probar qué aceptó el usuario):
  `src/services/compliance/ley19628.ts:44-55`.
- Revocación por finalidad (`core_service` no revocable — se redirige al
  flujo de erasure, `ley19628.ts:318-321`).
- **Gap G-14 (P2):** edad de consentimiento 14 años codificada
  (`regimes/ley19628.ts:42`) pero sin flujo de verificación de
  representante legal para menores (relevante para aprendices/practicantes).

## 10. Gobernanza y transferencias — 🔴

- **G-7 (P1):** **no hay DPO/encargado de protección de datos designado**
  (grep "DPO|delegado de protección" 2026-06-10: cero resultados reales).
  Designar formalmente, publicar contacto en la política de privacidad y en
  el RAT.
- **G-15 (P1):** el RAT declara `internationalTransfer: true` (Firestore
  us-central1, Sentry — `ley19628.ts:135,158,165`) pero **no existe
  mecanismo documentado de transferencia** (cláusulas contractuales, análisis
  de nivel adecuado de protección bajo el régimen 21.719). Documentar antes
  de 12-2026.
- **G-16 (P2):** modelo de prevención de infracciones (atenuante de
  responsabilidad bajo la ley): evaluar certificación una vez que la Agencia
  publique el reglamento.

## 11. Checklist accionable (priorizada)

### P0 — antes de 09-2026 (buffer de 3 meses sobre la vigencia)

- [ ] **EIPD de geolocalización de trabajadores** (SOS/lone-worker/zonas):
      documento completo en `docs/compliance/`, usando `DpiaInput` de
      `src/services/privacy/dpiaTemplate.ts`. Mayor riesgo del roadmap (G-2).
- [ ] **EIPD de biometría de pose** (REBA/RULA on-device) + bóveda médica
      `health_vault` (G-2, G-13).
- [x] **Cablear el borrado**: ruta admin (con `verifyAuth` + `audit_logs`)
      que invoque `processDataAccessRequest`/`eraseUserData` con
      `keepLegalRecords: true` por defecto; TDD con tests 401/200/403 (G-8).
      ✅ 2026-06-10: `src/server/routes/compliance.ts:390,440` + tests
      `src/__tests__/server/complianceArco.test.ts`.
- [ ] **Corregir runbook de brechas**: nombre de la autoridad (Agencia de
      Protección de Datos Personales, no "ANPD"), citación legal verificada
      por counsel, 72h documentado como estándar interno (G-4).
- [ ] Montar el generador DPIA en una ruta o script reproducible para que
      deje de ser huérfano (G-1).

### P1 — antes de 12-2026 (vigencia plena)

- [ ] Workflow de brechas: colección + reglas + ≥5 rules-tests + plantilla
      de reporte a la Agencia + entrada Dirty Dozen (G-5).
- [ ] Completar RAT: `health_vault`, `medical_exams`, firma WebAuthn, mesh
      relay (G-6).
- [ ] Job de vencimiento de solicitudes ARCO (alerta a los 20 días, escala a
      los 25) (G-9).
- [ ] Designar DPO/encargado + publicar contacto (G-7).
- [ ] Documentar mecanismo de transferencias internacionales (G-15).

### P2 — mejora continua

- [ ] Export grande vía signed URL (`onExport`) (G-10).
- [ ] Actualizar copy "Ley 19.628" → "Ley 19.628 mod. Ley 21.719" en
      `MyData.tsx` (G-11).
- [ ] Política formal de decisiones automatizadas / IA como recomendación
      (G-12).
- [ ] Justificar o acotar retenciones "indefinido" del RAT (G-3).
- [ ] Flujo de consentimiento de representante legal para menores de 18 y
      mayores de 14 (G-14).
- [ ] Evaluar modelo de prevención de infracciones certificado (G-16).

## 12. Relación con otros documentos

- ADR 0022 (no push a APIs externas) — minimización de egress: refuerza el
  deber de seguridad.
- ADR 0012 (no diagnóstico) y ADR 0010 (privacy by design, no datos
  íntimos) — base de la postura de minimización.
- `security_spec.md` (Dirty Dozen) y `docs/runbooks/INCIDENT_RESPONSE.md` —
  destino de los fixes G-4/G-5.
- `KMS_ROTATION.md` — rotación de claves para colecciones PII/médicas
  (convención CLAUDE.md #4).
