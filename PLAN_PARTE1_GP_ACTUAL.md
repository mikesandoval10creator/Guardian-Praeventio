# PLAN PARTE 1 — Guardian-Praeventio: Estado Actual y Brechas

> Documento generado: 2026-04-30 | Auditoría exhaustiva del codebase actual

---

## 1. ESTADO GENERAL DEL PROYECTO

| Métrica | Valor |
|---------|-------|
| Páginas totales | 87 |
| Páginas con ruta activa | 86 (SunTracker.tsx sin ruta) |
| Servicios totales | 30+ |
| Servicios sin callers (muertos) | 7 |
| Hooks totales | 27+ |
| Hooks con ≤1 consumidor | 11 |
| TODO.md items pendientes | 2 (SSO + ERP API) |
| Build TypeScript | ✅ 0 errores en producción |
| Carpetas de respaldo | 0 (no existe _respaldo en ningún repo) |

---

## 2. LO QUE FUNCIONA DE EXTREMO A EXTREMO ✅

| Sistema | Evidencia de funcionamiento real |
|---------|----------------------------------|
| Man Down detection | Alarma offline-first ≥30s, jerk-based, escribe Firestore + black box |
| Evacuation routes | Google Maps DirectionsService + Gemini AI + guarda en emergency_plans |
| Geolocation tracking | Capacitor GPS, respeta Art. 22, filtra accuracy <50m, escribe Firestore |
| Bluetooth mesh | BLE scan real, guarda IndexedDB con GPS (timeout 8s + fallback) |
| Push notifications FCM | sendEachForMulticast() dispara en onSnapshot de incidentes críticos |
| Offline sync | IndexedDB (web) + Capacitor SQLite (nativo), conflict detection via localUpdatedAt |
| RBAC | Dual-capa: Firestore rules + Firebase Admin custom claims |
| Gemini AI (90+ acciones) | Proxy real /api/gemini, rate-limited, sin respuestas hardcodeadas |
| CPHS / Comité Paritario | CRUD completo de actas y acuerdos, alert emails via Resend |
| SUSESO/DIAT reports | Datos empresa dinámicos, PDF real via jsPDF |
| Session expiry | Turno máx 8h, checker cada 15min, logout + alerta |
| SafeDrivingMode dictación | SpeechRecognition → addDoc a driving_reports Firestore |
| Workers module | CRUD completo, importación masiva CSV/Excel, 8 modales |
| PTSGenerator | Gemini AI, guarda PDF + nodo en Risk Network, GPS geocoding |
| Training module | Firestore + IndexedDB offline, quiz IA, YouTube embeds, gamificación |
| Google Play Billing | /api/billing/verify + webhook reales |
| PDF generation | /api/reports/generate-pdf real (2MB limit) |
| Analytics | KPIs calculados desde Risk Network, Recharts, export PDF |
| Risk Engine | onSnapshot tiempo real, pending actions optimistas, embeddings async |
| Gamification | Points, medallas, confetti, todo en Firestore |
| ISOAudit | save con catch + toast de error + Retry |
| Geofence | TurfJS real, entrada/salida detectada, sin alarma repetida |
| Service worker PWA | Workbox caching, auto-update, offline-ready |

---

## 3. BRECHAS CRÍTICAS — SEGURIDAD LETAL 🔴

### BRECHA-00: EmergencyContext — Solo estado local, NO persiste
**Archivo:** `src/contexts/EmergencyContext.tsx`

El contexto solo gestiona estado local (useState). No escribe en Firestore, no llama APIs, no persiste nada. Un componente que llame `triggerEmergency()` creyendo que activa un protocolo real está equivocado — solo cambia una variable en memoria.

**Fix:**
```typescript
// En triggerEmergency(type):
await addDoc(collection(db, 'projects', projectId, 'emergency_events'), {
  type, triggeredBy: userId, timestamp: serverTimestamp(), status: 'active'
});
// En resolveEmergency():
await updateDoc(eventRef, { status: 'resolved', resolvedAt: serverTimestamp(), resolvedBy: userId });
```
**Tiempo estimado:** 20 min

---

### BRECHA-01: Botón SOS en SafeDrivingMode — STUB LETAL
**Archivo:** `src/pages/SafeDrivingMode.tsx`

Botón muestra "S.O.S. Enviado" pero solo llama `setIsEmergency(true)` y `navigator.vibrate()`. Cero escritura a Firestore. Cero notificación FCM. Un conductor accidentado presiona SOS → nadie recibe alerta.

**Fix:** Depende de BRECHA-00. Una vez real: llamar `triggerEmergency('driving_sos')`.
**Tiempo estimado:** 5 min (tras BRECHA-00)

---

### BRECHA-02: Botón "Base" en SafeDrivingMode — número vacío
**Archivo:** `src/pages/SafeDrivingMode.tsx`

`href="tel:"` sin número. Al presionar no pasa nada. El tipo Worker no tiene campo `emergencyContacts[]`.

**Fix:**
1. Añadir `emergencyContacts?: { name: string; phone: string; relationship: string }[]` al tipo Worker
2. Leer `selectedProject.emergencyPhone` para el botón Base
3. Si no hay número: deshabilitar con tooltip explicativo

**Tiempo estimado:** 15 min

---

### BRECHA-03: Man Down — sin confirmación de supervisor en Firestore
**Archivo:** `src/hooks/useManDownDetection.ts`

`acknowledgeAlert()` es local — detiene el audio pero no queda rastro en Firestore de quién vio la alerta ni cuándo.

**Fix:**
1. Al disparar alerta: escribir doc en `projects/{id}/mandown_events` con estado `pending`
2. `acknowledgeAlert()`: hacer updateDoc con `{ acknowledgedBy, acknowledgedAt, status: 'acknowledged' }`
3. Si nadie acknowledges en 10 min → servidor re-dispara FCM a nivel gerente

**Tiempo estimado:** 30 min

---

### BRECHA-04: Geofence — violación de zona no notifica al supervisor
**Archivo:** `src/hooks/useGeofence.ts`

Al entrar a zona peligrosa solo suena alarma local. El supervisor no recibe ninguna notificación. No queda registro en Firestore.

**Fix:** Al detectar entrada: `addDoc(collection(db, 'projects', projectId, 'zone_violations'), { workerId, zoneId, timestamp })`

**Tiempo estimado:** 15 min

---

## 4. BRECHAS IMPORTANTES — Afectan operación ⚠️

### BRECHA-05: Man Down — sin re-escalación si sigue inmóvil
Si alguien silencia la alarma sin ayudar, no hay re-alerta. Añadir job en server.ts: si `mandown_events` tiene `status: 'acknowledged'` pero `resolvedAt: null` después de 5 min → re-disparar.
**Tiempo:** 20 min

### BRECHA-06: Morning Check-in — no sincroniza a Firestore
Solo guarda en IndexedDB. Los check-ins no son visibles para supervisores ni compliance audits.
**Fix:** Tras IndexedDB, llamar `addDoc(collection(db, 'projects', projectId, 'morning_checkins'), {...})`
**Tiempo:** 10 min

### BRECHA-07: Evacuation — alarma manual sin feedback ni audit trail
Botón "Activar Alarma Manual" no muestra confirmación ni guarda timestamp.
**Fix:** Toast con timestamp + addDoc a emergency_messages.
**Tiempo:** 10 min

### BRECHA-08: Training — certificado importado pero sin botón
`generateTrainingCertificate` importado en línea 25 pero nunca se llama.
**Fix:** Añadir botón "Descargar Certificado" en card de sesión completada.
**Tiempo:** 10 min

### BRECHA-09: ISOAudit — sin lógica condicional de preguntas
Muestra todas las preguntas sin ocultar según respuestas previas.
**Fix:** Añadir `dependsOn` en estructura de preguntas, filtrar render según respuestas activas.
**Tiempo:** 45 min

### BRECHA-10: Seismic monitor — detecta pero no actúa
Detecta sismos ≥4.5 a ≤500km pero solo actualiza estado local.
**Fix:** Si `criticalAlert == true` → llamar `triggerEmergency('sismo')` + escribir a emergency_messages.
**Tiempo:** 15 min

---

## 5. BRECHAS MENORES 🟡

| # | Problema | Archivo | Fix |
|---|---------|---------|-----|
| M1 | BiometricAuth local-only | useBiometricAuth.ts | Validar credential en servidor para ISO 27001 |
| M2 | RESEND_API_KEY vacío | .env / deploy | Sin esta key, emails CPHS y alertas críticas fallan silenciosamente |
| M3 | WEBHOOK_SECRET vacío | .env / deploy | Sin esta key, webhook Google Play rechaza todo. Billing roto en producción |
| M4 | Gemini sin rate-limit por función | geminiService.ts | 90+ funciones sin presupuesto por tipo. Añadir token budget |
| M5 | ERP sync validación mínima | server.ts | Añadir schema validation (zod) en payload |
| M6 | 1 error TypeScript en test | src/types/roles.test.ts | npm install vitest o eliminar el test |

---

## 6. SERVICIOS BACKEND SIN CALLERS (Muertos)

| Servicio | Ruta server.ts disponible | Acción |
|---------|--------------------------|--------|
| coachBackend | /api/coach/chat | Conectar desde AsesorChat modo coach |
| gamificationBackend | /api/gamification/points, /leaderboard, /check-medals | Conectar desde MedalSystem.tsx y WallyGame.tsx |
| safetyEngineBackend | /api/ask-guardian | Conectar desde SafetyForecast.tsx y PredictiveAnalysis.tsx |
| environmentBackend | /api/telemetry/ingest | Conectar desde Telemetry.tsx |
| dataSeedService | /api/seed-data | Solo admin — exponer en Diagnostico.tsx |
| oauthTokenStore | N/A | Evaluar eliminación o wiring a OAuth flow |
| seedBackend | /api/seed-glossary | Exponer en Settings admin |

---

## 7. HOOKS DE SEGURIDAD CRÍTICA CON 1 SOLO CONSUMIDOR

Estos hooks de seguridad vital están casi sin usar:

| Hook | Consumidores | Problema |
|------|-------------|---------|
| useAcousticSOS | 1 | Señal SOS acústica sin integración en emergencia |
| useManDownDetection | 1 | Solo en SafeDrivingMode — debería estar en Dashboard |
| useSurvivalPing | 1 | Ping de supervivencia sin escalación |
| useDeadReckoning | 1 | Navegación sin GPS solo en 1 lugar |
| useGeofence | 1 | Zonas peligrosas solo en 1 módulo |
| useZettelkastenIntelligence | 2 | Solo orphan detection, no URL context |
| useIndustryIntegration | 2 | Sin compliance scoring activo |

---

## 8. GAPS DE DISEÑO CONFIRMADOS (vs. Proto 1)

| Feature | Estado GP | Acción |
|---------|-----------|--------|
| WeatherBulletin con dark/light cross-inversion | ❌ No existe | Portar + mejorar desde proto 1 |
| SunTrackerContainer (tema vs. hora real) | ❌ No existe | Portar + mejorar desde proto 1 |
| ThemeContext.isDayTime | ❌ No existe | Portar desde proto 1 |
| NormativeContext (inyección AI) | ❌ No existe | Portar + integrar en Asesor |
| SmartConnectionsPanel flotante | ❌ No existe | Crear nuevo |
| Pizarra.tsx como página real | ❌ No existe (solo metáfora) | Crear nueva página |
| Orquestador → Asesor (contexto ambiental) | ❌ No conectado | Conectar orchestratorService a /api/ask-guardian |
| BCN link card en Asesor | ❌ No existe | Añadir affordance explícita |
| useZettelkastenIntegration URL-based | ❌ No existe (solo orphan) | Upgrade del hook actual |

---

## 9. INFRAESTRUCTURA CONFIRMADA ✅ (no requiere trabajo)

| Item | Estado |
|------|--------|
| 32 colecciones Firestore activamente escritas | ✅ |
| RBAC dual-capa (rules + custom claims) | ✅ |
| FCM multicast en onSnapshot de incidentes críticos | ✅ |
| Offline PWA (Workbox + IndexedDB + SQLite) | ✅ |
| 27+ endpoints backend con lógica real | ✅ |
| Helmet CSP + rate limiting 100 req/15min | ✅ |
| PDF generation (/api/reports/generate-pdf) | ✅ |
| Emails CPHS via Resend | ✅ |
| Google Play Billing | ✅ |
| orchestratorService (OpenWeatherMap + USGS live) | ✅ pero desconectado del Asesor |

---

## 10. ORDEN DE EJECUCIÓN RECOMENDADO

### Sprint A — Seguridad letal (antes de cualquier prueba de campo)
1. BRECHA-00: EmergencyContext → Firestore (20 min) — **prerequisito de todo lo demás**
2. BRECHA-01: SafeDrivingMode SOS (5 min)
3. BRECHA-02: SafeDrivingMode Base phone (15 min)
4. BRECHA-03: ManDown → mandown_events Firestore (30 min)
5. BRECHA-04: Geofence → zone_violations Firestore (15 min)
6. M2: Configurar RESEND_API_KEY
7. M3: Configurar WEBHOOK_SECRET

### Sprint B — Operación supervisada
8. BRECHA-05: ManDown re-escalación server job (20 min)
9. BRECHA-07: Evacuation alarma con feedback (10 min)
10. BRECHA-10: Seismic monitor dispara evacuación (15 min)
11. BRECHA-06: Morning check-in sync Firestore (10 min)

### Sprint C — Completitud de features
12. BRECHA-08: Training certificado botón (10 min)
13. BRECHA-09: ISOAudit preguntas condicionales (45 min)
14. Conectar 7 servicios muertos a sus rutas server.ts
15. Añadir ruta /sun-tracker en OperationsRoutes.tsx

---

## 11. VERIFICACIÓN POST-IMPLEMENTACIÓN

| Test | Condición de éxito |
|------|-------------------|
| SafeDrivingMode SOS | Presionar botón → doc en emergency_events Firestore en <2s |
| SafeDrivingMode Base | Presionar botón → inicia llamada con número configurado |
| ManDown acknowledge | Silenciar alarma → acknowledgedBy+at visible en mandown_events |
| Geofence breach | Entrar en zona → doc en zone_violations + supervisor notificado |
| Seismic critical | criticalAlert=true → modo evacuación activado |
| Morning check-in | Completar → doc visible en morning_checkins Firestore |
| npm run build | 0 errores TypeScript en producción |
