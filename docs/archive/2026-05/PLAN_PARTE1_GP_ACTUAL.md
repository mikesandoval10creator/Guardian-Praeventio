# PLAN PARTE 1 — Guardian-Praeventio: Estado Actual y Brechas

> Documento actualizado: 2026-05-03 | Auditoría post-Sprint 5 + Color System
> Documento original: 2026-04-30 | Versión actual incorpora deltas de tres sprints completos.

---

## 1. ESTADO GENERAL DEL PROYECTO (delta vs. 2026-04-30)

| Métrica | 2026-04-30 | 2026-05-03 | Delta |
|---------|------------|------------|-------|
| Páginas totales | 87 | 98 | +11 |
| Rutas activas | 86 | 68 | -18 (pase de deprecación intencional) |
| Servicios totales | 30+ | 94 | +213% |
| Hooks totales | 27 | 33 | +6 |
| Hooks con ≤1 consumidor | 11 | 2 | -9 |
| TS errors producción | 0 | 0 | igual |
| Issues Sentry últimos 7d | n/a | 0 unresolved | sano o tráfico bajo |
| Carpetas `_respaldo` | 0 | 0 | igual |

> El crecimiento de servicios (de 30+ a 94) viene casi entero de Sprints 2 a 5: módulos físicos Bernoulli, sentinel de zettelkasten, integraciones Sentry, pipelines de hardening de seguridad y nuevo subsistema de tema 4-modo.

---

## 2. HITOS COMPLETADOS DESDE EL ÚLTIMO AUDIT (2026-04-30 → 2026-05-03)

### Sprint 2 — Hardening de seguridad backend
- Cross-tenant write en `accept-invitation` cerrado con transacción Firestore (commit `caef640`).
- Rate-limit del webhook Google Play (commit `4ccc17f`).
- ERP sync con Zod + whitelist + rate-limit (commit `42b6700`).
- 40 `alert()` reemplazados por `useToast` en 28 archivos (commits `7a0506f` + `adde942`).
- `Math.random()` reemplazado por `crypto.randomUUID()` en services (commit `2984576`).

### Sprint 3 — Tests + observabilidad
- Tests `oauthGoogle.test.ts` (5 casos) + telemetry HMAC depth (commit `9ea820f`).
- Reglas Firestore: `telemetry_events` (create:false), `isValidProject(hasOnly)` (commits `2a4b2f2` + `035bca5`).
- Stryker mutation threshold 65% → 70% (commit `d8304bf`).
- Smoke tests post-deploy en `deploy.yml` (commit `611edcf`).
- DSN Sentry scrub en `.env.example` (commit `e8d15de`); doc `VITE_SENTRY_DSN` (commit `d5e7a8e`).

### Sprint 4 — Bundle & performance
- `manualChunks` real en Vite: `vendor-react`, `vendor-firebase`, `vendor-three`, `vendor-mediapipe` (commit `a3c8cd4`).
- `size-limit` budgets ajustados a la nueva topología (commit `72bc809`).
- CSP: `script-src 'blob:'` para MediaPipe WASM workers (commit `1879a1c`).
- Lighthouse threshold 0.5 → 0.65 (commit `14ff0ed`).

### Sprint 5 — Bernoulli expandido (semilla → módulos reales)
- Motor `[bernoulliEngine.ts](src/services/physics/bernoulliEngine.ts)` con 6 funciones SI puras.
- `HazmatStorageDesigner` con `venturiFlowRate` para ductos (DS 594) — commit `9cbb4e8`.
- `VisionAnalyzer` calcula `respiratorPressureDrop` (NIOSH 42 CFR Part 84) — commit `afa8c08`.
- `BioAnalysis` con chequeo ergonómico pulmonar consciente de altitud — commit `5178149`.
- Nodos `venturi-warning` + `windload-warning` en `[climateRiskCoupling.ts](src/services/zettelkasten/climateRiskCoupling.ts)` — commit `0bf4620`.

### UX / branding (Sprint 5 final)
- `ErrorBoundary` categorizado con captura Sentry (commit `8b0e7b3`).
- Landing redesign alineado con praeventio.net (commit `ade4a54`).
- Sistema de color full teal/petroleum/gold scales 50–900 (commit `7c87869`).
- Reemplazo lime-green `#58D66D` → brand-teal en todo el codebase (commit `8a0a0df`).
- Acentos gold y petroleum en landing (commit `c19d3eb`).
- 4 modos de tema: `normal-light`, `normal-dark`, `driving`, `emergency` (commit `9a76556`).
- `AppModeContext` con persistencia y auto-expiry de modo emergencia (commit `f9cba6d`).
- `ModeSwitcher` flotante en `RootLayout` (commit `09e3317`).
- Documentación de teoría de color en `[BRAND.md](BRAND.md)` (commit `96d40f4`).

---

## 3. LO QUE FUNCIONA DE EXTREMO A EXTREMO ✅ (verificado 2026-05-03)

| Sistema | Evidencia de funcionamiento real |
|---------|----------------------------------|
| Man Down detection | Alarma offline-first ≥30s, jerk-based, escribe Firestore + black box |
| EmergencyContext (BRECHA-00 cerrada) | `[EmergencyContext.tsx:22-40](src/contexts/EmergencyContext.tsx)` escribe a `projects/{id}/emergency_events`, mantiene ref del docId para resolveEmergency |
| Evacuation routes | Google Maps DirectionsService + Gemini AI + guarda en emergency_plans |
| Geolocation tracking | Capacitor GPS, respeta Art. 22, filtra accuracy <50m, escribe Firestore |
| Bluetooth mesh | BLE scan real, guarda IndexedDB con GPS (timeout 8s + fallback) |
| Push notifications FCM | sendEachForMulticast() dispara en onSnapshot de incidentes críticos |
| Offline sync | IndexedDB (web) + Capacitor SQLite (nativo), conflict detection vía localUpdatedAt |
| RBAC dual-capa | Firestore rules + Firebase Auth custom claims (verificado en `firestore.rules` 678 líneas) |
| Gemini AI (90+ acciones) | Proxy real /api/gemini, rate-limited, sin respuestas hardcodeadas |
| CPHS / Comité Paritario | CRUD completo de actas y acuerdos, alert emails vía Resend |
| SUSESO/DIAT reports | Datos empresa dinámicos, PDF real vía jsPDF |
| SafeDrivingMode dictación | SpeechRecognition → addDoc a driving_reports Firestore |
| PTSGenerator | Gemini AI, guarda PDF + nodo en Risk Network, GPS geocoding |
| Training module | Firestore + IndexedDB offline, quiz IA, YouTube embeds, gamificación |
| Google Play Billing | /api/billing/verify + webhook reales (rate-limited Sprint 2) |
| PDF generation | /api/reports/generate-pdf real (2MB limit) |
| Risk Engine | onSnapshot tiempo real, pending actions optimistas, embeddings async |
| Geofence | TurfJS real, entrada/salida detectada, sin alarma repetida |
| Service worker PWA | Workbox caching, auto-update, offline-ready |
| Bernoulli engine | 6 funciones SI puras + 4 wirings reales (Hazmat, Vision, Bio, Structural) |
| Color system 4-mode | Driving (alto contraste tipografía bold), Emergency (rojo crítico), normal-light/dark |
| Sentry pipeline | Org `praeventio` + project `guardian-praeventio` con DSN frontend y backend |

---

## 4. BRECHAS QUE PERSISTEN

### B-PERS-01: `useProjectCapacity` — 1 solo consumidor
Hook que calcula la capacidad operativa de proyecto pero solo se usa en una página. Debería alimentar el dashboard ejecutivo, el módulo CPHS y el motor de risk-scoring. **Esfuerzo:** ~2h (cablear 2-3 nuevos consumers).

### B-PERS-02: `useSubmit` — 0 consumidores
Hook genérico de envío de formularios sin uso en producción. Decisión: **eliminar** o adoptarlo en los formularios pesados (Worker import, PTS, ISOAudit) — ya hay 6 lugares con código duplicado para manejar pending/error toast. **Esfuerzo:** ~3h (adoptar) o ~10min (eliminar).

### B-PERS-03: `workbox-build` deps incompletos local
Build local rompe en `npm run build` por dependencias transitivas faltantes de `workbox-build`. CI lo soluciona porque tiene network limpio, pero el dev loop local es frágil. **Esfuerzo:** 30min (pin de versiones + npm dedupe).

### B-PERS-04: `/api/ask-guardian` no inyecta contexto ambiental
Endpoint en `[gemini.ts:124-191](src/server/routes/gemini.ts)` solo usa `searchRelevantContext` (RAG sobre cuerpo legal). No llama a `fetchEnvironmentContext` aunque la función ya existe en `orchestratorService`. Resultado: el Asesor responde sin saber temperatura, viento, sismicidad, UV o altitud — exactamente lo que PARTE3 (Gran Maestro) exigía. **Detalle de fix en PARTE3 §3.** **Esfuerzo:** 4h.

---

## 5. BRECHAS NUEVAS DETECTADAS

### B-NEW-01: AppModeContext sin documentación de transitions
El nuevo `AppModeContext` (4 modos) tiene auto-expiry de emergency pero la matriz exacta de transiciones permitidas no está documentada en BRAND.md. Operadores pueden activar `driving` desde `emergency` y eso bloquea el SOS visual. **Esfuerzo:** 1h (doc + test de transiciones).

### B-NEW-02: ModeSwitcher en RootLayout — accesibilidad parcial
El componente flotante no tiene `aria-pressed` correcto y no responde a `Escape` para cerrar. **Esfuerzo:** 30min.

### B-NEW-03: Bernoulli wiring en HazmatStorageDesigner sin alerta UI
`venturiFlowRate` se calcula y se loguea, pero la UI no muestra el alert cuando v supera el umbral DS 594. La data fluye al zettelkasten (✅) pero el operador no ve nada. **Esfuerzo:** 2h.

### B-NEW-04: Tests de regresión de color tokens faltan
La migración lime → teal afectó 80+ archivos. No existe snapshot test que evite que un futuro PR re-introduzca lime en clases utilitarias. **Esfuerzo:** 2h (eslint rule custom + un snapshot CSS).

### B-NEW-05: 192 nodos del PLAN_MAESTRO sin definir
Documentado en PARTE3 §6: bloques V-VIII (nodos 321–512) son hoja en blanco. Decidir si construir o abandonar formalmente. **Esfuerzo:** workshop de scoping (~6h) antes de cualquier código.

---

## 6. SERVICIOS BACKEND SIN CALLERS (Muertos) — actualizado

De los 7 servicios huérfanos del audit anterior, los siguientes siguen sin uso:

| Servicio | Ruta server.ts | Estado |
|----------|---------------|--------|
| coachBackend | /api/coach/chat | huérfano (AsesorChat aún no tiene modo coach) |
| safetyEngineBackend | /api/ask-guardian | parcialmente cubierto, pero ver B-PERS-04 |
| dataSeedService | /api/seed-data | solo usable desde admin, sin UI expuesta |
| oauthTokenStore | n/a | sin OAuth flow real cableado |
| seedBackend | /api/seed-glossary | sin admin panel |

`gamificationBackend` y `environmentBackend` fueron cableados en sprints intermedios (revisar PR #14 y #15).

---

## 7. INFRAESTRUCTURA CONFIRMADA ✅

| Item | Estado |
|------|--------|
| 32+ colecciones Firestore activamente escritas | ✅ |
| RBAC dual-capa | ✅ |
| FCM multicast en onSnapshot | ✅ |
| Offline PWA | ✅ |
| 27+ endpoints backend con lógica real | ✅ |
| Helmet CSP + rate limiting + blob: para MediaPipe | ✅ |
| PDF generation | ✅ |
| Emails CPHS vía Resend | ✅ |
| Google Play Billing | ✅ |
| orchestratorService (OpenWeatherMap + USGS live) | ✅ pero ver B-PERS-04 |
| Sentry org+project con DSN documentado | ✅ |
| Bernoulli engine 6 funciones SI | ✅ |
| Color system 4-mode + AppModeContext | ✅ |
| 4 manualChunks Vite + size-limit + Lighthouse 0.65 | ✅ |

---

## 8. ORDEN DE EJECUCIÓN RECOMENDADO

Las brechas letales originales (BRECHA-00 a 04) están **todas cerradas** — referencia en PARTE4 §1.

### Próximas 2 semanas
1. B-PERS-04: env context en `/api/ask-guardian` (4h) — desbloquea valor del Asesor.
2. B-PERS-03: workbox-build deps locales (30min).
3. B-PERS-01: cablear `useProjectCapacity` (2h).
4. B-PERS-02: decisión sobre `useSubmit` (3h o 10min).

### Mes
5. Sprint 6 — Lime re-integration como acento de éxito (3 colores: teal=trust, lime=energy, gold=prestige).
6. Sprint 7 — Driving UI real con Maps SDK + speed-trigger.
7. Sprint 8 — Emergency UI real con DeviceMotion sismo.
8. Sprint 9 — Bernoulli extensions (15 use cases) — ver `[BERNOULLI_EXTENSIONS.md](BERNOULLI_EXTENSIONS.md)`.

---

## 9. VERIFICACIÓN POST-IMPLEMENTACIÓN

| Test | Condición de éxito |
|------|-------------------|
| `/api/ask-guardian` con env context | Respuesta menciona temperatura y sismicidad activa de la zona |
| `useProjectCapacity` | ≥3 consumidores en producción |
| `useSubmit` | 0 consumidores → eliminado, o ≥6 consumidores → adoptado |
| `npm run build` local | 0 errores y `workbox-build` resuelve |
| Snapshot de tokens lime | 0 ocurrencias en `src/**/*.tsx` |
| AppMode transitions | Driving y Emergency mutuamente excluyentes documentados |

---

> Próxima revisión: 2026-05-31 tras Sprint 6 (lime acento) y Sprint 9 (Bernoulli extensions).
