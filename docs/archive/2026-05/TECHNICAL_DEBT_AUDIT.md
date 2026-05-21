# Auditoría de Deuda Técnica — Guardian Praeventio
**Fecha:** 2026-05-07 | **Rama auditada:** `claude/technical-debt-documentation-pd2gN`  
**Metodología:** Verificación directa de código fuente (grep, lectura de archivos). Cada hallazgo incluye la ruta y línea exacta.

---

> **Cómo leer este documento**
> - `[CONFIRMADO]` — El problema existe en el código exactamente donde se describe.
> - `[PARCIAL]` — La infraestructura base existe, pero la integración o el despliegue está incompleto.
> - `[RECTIFICADO]` — El reporte original era incorrecto; la funcionalidad ya está implementada.
> - **Prioridad**: `CRÍTICO` → `ALTO` → `MEDIO` → `BAJO`

---

## 1. Seguridad y Autenticación

### 1.1 KMS en Memoria (Dev) — Producción sin Cifrado Real
**Prioridad: CRÍTICO** | `[CONFIRMADO]`

```
src/services/security/kmsAdapter.ts:57–77
```

El sistema usa una clave de encriptación derivada de la string hardcodeada `'praeventio-in-memory-kms-dev-kek-v1'` (SHA-256 determinístico). El adaptador `in-memory-dev` es el comportamiento por defecto cuando `KMS_ADAPTER=cloud-kms` no está configurado en el entorno. Si la variable de entorno falla en producción, el PII de los trabajadores queda cifrado con una clave conocida y embebida en el código fuente.

**Qué falta:** Configurar la variable `KMS_ADAPTER=cloud-kms` en Cloud Run + `@google-cloud/kms` integrado con rotación automática de 90 días (ver `KMS_ROTATION.md`).

---

### 1.2 WebAuthn — Registro sin Verificación de Firma en Servidor
**Prioridad: CRÍTICO** | `[CONFIRMADO]`

```
src/server/routes/curriculum.ts:688
src/hooks/useBiometricAuth.ts:58
src/__tests__/server/webauthnVerify.test.ts:179
```

El endpoint `POST /api/auth/webauthn/register` no existe (TODO Round 20+). El cliente verifica la huella localmente, pero el servidor nunca valida la firma CBOR criptográfica. Una petición modificada en el cliente puede saltarse la autenticación biométrica.

**Qué falta:** Implementar el endpoint + integrar `@simplewebauthn/server` para verificación CBOR server-side.

---

### 1.3 Recibos de Pago In-App sin Validación
**Prioridad: CRÍTICO** | `[CONFIRMADO]`

```
src/server/routes/billing.ts:1467  — Google Play
src/server/routes/billing.ts:1527  — Apple App Store
src/server/routes/billing.ts:125   — @ts-ignore en playAuth.scopes
```

Ambas validaciones de recibos retornan `true` sin consultar los servidores de Google o Apple. Es posible inyectar un recibo falso y obtener acceso a niveles de pago sin haber pagado.

**Qué falta:** Integrar Google Play Developer API v3 (`purchases.subscriptions.get`) y Apple App Store Server API para verificación real.

---

### 1.4 Webhook IPN de MercadoPago sin Conectar
**Prioridad: ALTO** | `[CONFIRMADO]`

```
src/services/billing/mercadoPagoAdapter.ts:24
src/services/billing/mercadoPagoIpn.ts:35
```

El archivo `mercadoPagoIpn.ts` existe y procesa el payload, pero el endpoint que lo expone vía `POST /api/billing/webhook/mercadopago` no está montado en `server.ts`. Los pagos de MercadoPago no actualizan el tier del usuario en Firestore automáticamente.

**Qué falta:** Registrar el router IPN en `server.ts` y conectarlo al Firestore tier update.

---

### 1.5 `@ts-ignore` en Código de Producción Crítico
**Prioridad: ALTO** | `[CONFIRMADO]`

Los siguientes archivos usan `@ts-ignore` para silenciar errores del compilador en lógica de negocio (no en tests):

| Archivo | Línea | Motivo declarado |
|---|---|---|
| `src/components/ai/GuardianVoiceAssistant.tsx` | 14 | `window.webkitSpeechRecognition` no en tipos DOM |
| `src/server/routes/billing.ts` | 125 | `playAuth.scopes` — gap de tipos |
| `src/services/billingService.ts` | 45 | Sin comentario explicativo |
| `src/services/adService.ts` | 78 | Capacitor global en web puro |

Los casos de test usan `@ts-expect-error` correctamente (intencional). Los 4 de producción son deuda real.

---

## 2. Plataforma Móvil

### 2.1 Directorio Android Inexistente
**Prioridad: ALTO** | `[CONFIRMADO]`

```
capacitor.config.ts: "Native folders (android/, ios/) are NOT generated yet"
```

El directorio `android/` no existe. `ios/` sí existe. El comando `npx cap add android` no se ha ejecutado. La app no puede compilarse para Android Play Store.

**Qué falta:** Ejecutar `npx cap add android` en entorno local con JDK 17 + Android SDK (ver `docs/mobile-build-runbook.md`).

---

### 2.2 `assetlinks.json` con Placeholder de SHA256
**Prioridad: ALTO** | `[CONFIRMADO]`

```
public/.well-known/assetlinks.json:7
"sha256_cert_fingerprints": ["REPLACE_WITH_REAL_SHA256_BEFORE_STORE_BUILD"]
```

Los Android App Links no funcionan hasta reemplazar este valor con el fingerprint real del keystore de producción.

---

### 2.3 `apple-app-site-association` — TEAM_ID por Confirmar
**Prioridad: ALTO** | `[CONFIRMADO]`

```
public/.well-known/apple-app-site-association
```

El archivo existe pero el `TEAM_ID` (10 caracteres) debe ser actualizado con el ID real de la cuenta Apple Developer. Universal Links de iOS no funcionarán hasta este paso.

---

## 3. Inteligencia Artificial y ML

### 3.1 Vertex AI Trainer — Stub Intencional
**Prioridad: ALTO** | `[CONFIRMADO]`

```
src/services/ml/vertexTrainer.ts:126–131
// TODO Sprint 33: replace this throw with the real Vertex AI training call
throw new VertexTrainerError('NOT_ENABLED', ...)
```

El entrenamiento de modelos predictivos personalizados (accidentes laborales) no existe. El stub lanza error inmediatamente para evitar cargos accidentales en Vertex AI.

**Sprint asignado:** 33.

---

### 3.2 URLs de Modelos ONNX (SLM) sin Confirmar
**Prioridad: ALTO** | `[CONFIRMADO]`

```
src/services/slm/registry.ts:44  — Phi / AutoTokenizer
src/services/slm/registry.ts:61  — Qwen (URL incierta)
src/services/slm/registry.ts:76  — Gemma (URL incierta)
```

Las URLs de HuggingFace para descargar los modelos ONNX al dispositivo tienen comentarios explícitos de `// TODO: confirm URL`. Si las URLs son incorrectas, el SLM offline colapsará silenciosamente en el primer intento de descarga.

---

### 3.3 SLM Worker — Manejo de Errores Tipado Incompleto
**Prioridad: MEDIO** | `[CONFIRMADO]`

```
src/services/slm/worker/slmWorker.ts:18,185,267,464
// TODO T-1.3.2: improve error recovery — propagate a typed failure reason
```

4 puntos donde los errores de inferencia retornan mensajes genéricos en lugar de códigos estructurados. Si la inferencia offline falla por falta de memoria en el dispositivo, el error es opaco.

**Sprint asignado:** T-1.3.2.

---

### 3.4 MediaPipe — Descarga desde CDN Externo (Privacidad)
**Prioridad: MEDIO** | `[CONFIRMADO]`

```
src/hooks/useMediaPipePose.ts:61–64
```

Las URLs de WASM y modelo de MediaPipe apuntan a `cdn.jsdelivr.net` y Google Storage. En faenas sin internet o en entornos con Ley 19.628 (Chile) que prohíben tráfico externo, la evaluación ergonómica en tiempo real fallaría o filtraría metadata al exterior.

**Qué falta:** Empaquetar los modelos WASM localmente en `public/models/mediapipe/`.

---

## 4. Firebase y Despliegue de Infraestructura

### 4.1 `firebase.json` sin Hosting, Functions ni Storage
**Prioridad: ALTO** | `[CONFIRMADO]`

```json
// firebase.json — solo contiene:
{ "firestore": {...}, "emulators": {...} }
```

Falta configurar:
- `"hosting"` → La PWA no está conectada a la CDN de Firebase Hosting
- `"storage"` → Las reglas de Storage (fotos de lesiones, documentos) no están declaradas en el deploy
- `"functions"` → Cloud Functions no tienen configuración de deploy

Sin `hosting`, el comando `firebase deploy` no despliega la app web. Sin `storage.rules`, los archivos subidos por usuarios no tienen protección declarada a nivel de infraestructura.

---

### 4.2 Tests de Reglas Firestore con `ctx.skip()` Activo
**Prioridad: ALTO** | `[CONFIRMADO]`

```
src/rules-tests/firestore.rules.test.ts:153
src/rules-tests/dirtyDozen.test.ts:114
```

Los tests que validan que un usuario no pueda leer/borrar datos de otra empresa tienen `ctx.skip()`. Estos no son tests "graceful-degradation" — son validaciones de seguridad que se omiten cuando el emulador no está disponible en CI, lo que significa que la armadura de Firestore puede tener brechas sin que el pipeline de CI las detecte.

---

### 4.3 `Site25DPanel` — Tests del Gemelo Digital en `describe.skip`
**Prioridad: MEDIO** | `[CONFIRMADO]`

```
src/components/digital-twin/Site25DPanel.test.tsx:205
describe.skip('Site25DPanel (skipped — flaky CI mocks, see TODO)')
```

El componente central del Gemelo Digital 3D no tiene suite de tests activa. Regresiones en producción no serán detectadas por CI.

---

## 5. Componentes UI — Funcionalidades Shell (Cascarones)

### 5.1 Realidad Aumentada (WebXR) — Placeholder Explícito
**Prioridad: MEDIO** | `[CONFIRMADO]`

```
src/pages/DigitalTwinFaena.tsx:884
// Bucket J.5 — AR overlay (placeholder funcional, sesión WebXR real en Ola 4)
src/hooks/useArPlacement.ts:53
// marca la sesión como iniciada de forma simulada (placeholder)
```

El botón de superposición AR existe en la UI pero no conecta con la API WebXR Device del navegador. La sesión AR es simulada.

**Ola asignada:** Ola 4.

---

### 5.2 Análisis de Postura en Vivo — No Implementado
**Prioridad: MEDIO** | `[CONFIRMADO]`

```
src/components/ergonomics/AIPostureAnalysisModal.tsx:37
// TODO Bucket OO.4 (Sprint 25 ola siguiente): modo "Análisis en vivo"
```

El modal solo acepta videos pre-grabados. El análisis en tiempo real con la cámara del dispositivo (MediaPipe PoseNet en streaming) no está implementado.

---

### 5.3 Nodos BioAnalysis, HazmatStorage y StructuralCalc sin Persistir
**Prioridad: MEDIO** | `[CONFIRMADO]`

```
src/pages/BioAnalysis.tsx:68
// TODO Sprint 10+: persist this pulmonary-altitude node via addNode()

src/components/engineering/HazmatStorageDesigner.tsx:76
// TODO Sprint 10+: replace these console logs with addNode() calls into Firestore

src/components/engineering/StructuralCalculator.tsx:86
// TODO Sprint 10+: replace this console emission with addNode() into Firestore
```

Los cálculos se realizan y muestran en pantalla, pero los resultados se pierden: no se guardan como nodos en el Zettelkasten (Firestore). Al cerrar la pantalla, la información desaparece.

---

### 5.4 Internacionalización (i18n) Incompleta
**Prioridad: BAJO** | `[CONFIRMADO]`

```
src/pages/Calendar.tsx:28,31
// TODO(i18n): AddEventModal / EventDetailsModal — strings hardcodeados en español
```

Los sub-componentes modales del Calendario tienen strings en español hardcodeados. La infraestructura i18n existe (`src/services/i18n/`) pero la cobertura en componentes críticos es parcial.

---

## 6. Rectificaciones al Reporte Original

Las siguientes afirmaciones del reporte de deuda técnica original eran **incorrectas**. El código las implementa:

| Afirmación Original | Realidad |
|---|---|
| "Firebase Custom Claims no implementado" | `admin.ts:190` llama a `admin.auth().setCustomUserClaims()` ✅ |
| "Weekly Digest no existe" | `admin.ts:285` expone `POST /api/admin/jobs/weekly-digest` ✅ |
| "SII Adapter (`siiAdapter.ts`) no existe" | `src/services/sii/siiAdapter.ts` existe con tests ✅ |
| "Email templates no existen" | `src/services/email/templates.ts` existe ✅ |
| "No hay directorio iOS" | `ios/` existe en la raíz del proyecto ✅ |
| "Medical service sin tipos" | `src/services/medical/` tiene varios archivos implementados ✅ |

> Lo que aún falta en estos casos: **despliegue** (Cloud Scheduler para el weekly digest), **configuración de producción** (variables de entorno SII), y **cobertura de tests** adicional.

---

## 7. Resumen Ejecutivo de Prioridades

| # | Item | Prioridad | Sprint / Owner | Riesgo |
|---|---|---|---|---|
| 1 | KMS en memoria en producción | CRÍTICO | KMS_ROTATION.md | PII expuesto |
| 2 | WebAuthn sin firma de servidor | CRÍTICO | Round 20+ | Auth bypasseable |
| 3 | Recibos IAP sin validar | CRÍTICO | Billing backlog | Fraude de pagos |
| 4 | Webhook MercadoPago no montado | ALTO | Round 16 | Pagos sin activar |
| 5 | Android no compilable | ALTO | Mobile sprint | Play Store bloqueado |
| 6 | `assetlinks.json` placeholder | ALTO | Pre-store build | App Links rotos |
| 7 | `firebase.json` sin hosting/storage | ALTO | Infra sprint | App no desplegada en CDN |
| 8 | Tests Firestore con `ctx.skip()` | ALTO | CI sprint | Brechas sin detectar |
| 9 | Vertex AI stub | ALTO | Sprint 33 | ML no funcional |
| 10 | URLs ONNX sin confirmar | ALTO | T-1.2 | SLM offline roto |
| 11 | `@ts-ignore` en código de producción | ALTO | Continuo | Runtime errors silenciosos |
| 12 | MediaPipe CDN externo | MEDIO | Privacidad sprint | Ley 19.628 |
| 13 | SLM errores sin tipar | MEDIO | T-1.3.2 | Debugging opaco |
| 14 | WebXR como placeholder | MEDIO | Ola 4 | Feature faltante |
| 15 | Análisis postura en vivo | MEDIO | Sprint 25 | Feature faltante |
| 16 | 3 nodos sin persistir en Zettelkasten | MEDIO | Sprint 10+ | Pérdida de datos |
| 17 | `Site25DPanel.test.tsx` skipped | MEDIO | CI sprint | Regresiones no detectadas |
| 18 | i18n parcial en Calendar | BAJO | i18n sprint | UX solo ES |

---

## 8. Arquitectura: Los 3 Puentes Faltantes

Más allá de los items atómicos, hay 3 problemas arquitectónicos sistémicos:

### 8.1 Sin Event Bus Cliente (Sensores sordos entre sí)
Los 54 custom hooks (`useBluetoothMesh`, `useManDownDetection`, `useMediaPipePose`, `useZettelkastenIntelligence`) son independientes. No existe un bus de eventos global (Pub/Sub / Zustand store) que permita que la detección de un sensor BLE alimente al motor Zettelkasten en tiempo real sin pasar por React Context re-renders.

### 8.2 Sin Foreground Service Nativo (El Guardian duerme en el bolsillo)
iOS y Android matan procesos PWA cuando la pantalla se bloquea. `useManDownDetection` dejará de funcionar a los 5 minutos de que el minero guarde el teléfono. La solución real exige un Capacitor plugin con Android `ForegroundService` e iOS `Background Tasks` mostrando notificación persistente "Guardian Activo".

### 8.3 Sin Sincronización Predictiva por Topología de Grafo
`syncStateMachine.ts` es reactivo (guarda lo que el usuario cambia). Para que el modo offline sea genuinamente útil en minas, el sistema debe ser predictivo: si el calendario indica que el Trabajador A bajará al Túnel 4 a las 08:00, el sub-grafo Zettelkasten relevante (manual de la máquina, historial médico, riesgos del túnel) debe pre-descargarse a IndexedDB antes de que pierda señal.

---

*Documento generado por auditoría de código automatizada + revisión manual. Ver commits en rama `claude/technical-debt-documentation-pd2gN`.*
