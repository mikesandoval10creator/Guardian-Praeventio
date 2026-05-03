# PLAN PARTE 2 — Prototipo 1 (praevium-guard): Hallazgos y Recuperación

> Documento actualizado: 2026-05-03 | Verificación post-Sprint 5
> Fuente Proto 1: https://github.com/mikesandoval10creator/praevium-guard
> 580 commits | Stack: Vite + React + Supabase + Capacitor | 98.1% TypeScript

---

## 1. RESUMEN EJECUTIVO

La gran mayoría de las "joyas" de Proto 1 están integradas en GP actual. Quedan tres pendientes con valor real (GeminiChat especializado, ManDown UI completa, Geofence con UX visual) y tres decisiones de abandono **formal** (blockchain, AutoCAD, easter eggs). El resto fue verificado en el repo y migrado.

---

## 2. ARQUITECTURA DEL PROTOTIPO 1 vs. GP ACTUAL

| Aspecto | Proto 1 | GP Actual |
|---------|---------|-----------|
| Backend | Supabase (PostgreSQL) | Firebase (Firestore) |
| Auth | Supabase Auth | Firebase Auth + custom claims RBAC |
| AI | Gemini Pro (GeminiChat) | Gemini 3.1 + Claude vía /api/ask-guardian |
| Mobile | Capacitor (Android/iOS) | Capacitor (mismo) |
| Routing | React Router + 44 rutas | React Router + 68 rutas activas |
| Providers | 9 (NormativeProvider, ISOProvider, UniversalKnowledgeProvider…) | 9 contextos activos en `[src/contexts/](src/contexts/)` |

---

## 3. ESTADO DE INTEGRACIÓN — FEATURES POR FEATURE

### 3.1 Boletín climático con dark/light cross-inversion ✅

| Feature Proto 1 | Archivo GP | Estado |
|-----------------|------------|--------|
| `WeatherBulletin.tsx` | `src/components/WeatherBulletin.tsx` | ✅ integrado con Open-Meteo + altitud-tier |
| `SunTrackerContainer.tsx` | `src/components/SunTrackerContainer.tsx` | ✅ con cross-inversion light↔night y dark↔day |
| `SunTracker.tsx` (24 estados horarios + 8 fases lunares) | `src/pages/SunTracker.tsx` | ✅ algoritmos astronómicos completos |
| `ThemeContext.isDayTime` | `[ThemeContext.tsx](src/contexts/ThemeContext.tsx)` | ✅ presente |
| `useWeather.ts` (Open-Meteo + AQI) | `src/hooks/useWeather.ts` | ✅ con auto-refresh 600s |
| `WeatherSafetyRecommendations.tsx` (altitud 0/500/1500/2400m) | `src/components/WeatherSafetyRecommendations.tsx` | ✅ |
| `NativeCompass.tsx` (calibración figura 8) | `src/components/NativeCompass.tsx` | ✅ |

**Mejora aplicada en GP:** Framer Motion en transiciones, AQI real desde OpenWeatherMap, modo "faena minera" con umbral de altitud por proyecto.

### 3.2 NormativeContext (15 normativas + 5 protocolos) ✅

`[NormativeContext.tsx](src/contexts/NormativeContext.tsx)` integrado y exporta `getComprehensiveNormativeContext()`. **Pero:** la inyección automática en `/api/ask-guardian` es la brecha B-PERS-04 documentada en PARTE1. La función está disponible pero el endpoint la ignora.

### 3.3 EmergencyContext ✅ (verificado contra hallazgo de Explore)

Existe en `[src/contexts/EmergencyContext.tsx](src/contexts/EmergencyContext.tsx)` con persistencia real a Firestore. La afirmación de un Explore agent de que faltaba era incorrecta: el archivo escribe a `projects/{id}/emergency_events`, mantiene `activeEventRef` para cerrar el ciclo y captura errores con `captureEmergencyError`.

```typescript
// EmergencyContext.tsx:22-40 (resumen)
const triggerEmergency = async (type, projectId) => {
  setEmergencyType(type); setIsEmergencyActive(true);
  if (!projectId) return;
  const docRef = await addDoc(
    collection(db, `projects/${projectId}/emergency_events`),
    { type, triggeredBy: user.uid, status: 'active', createdAt: serverTimestamp() }
  );
  activeEventRef.current = { projectId, docId: docRef.id };
};
```

### 3.4 Ergonomic assessments ✅ (verificado contra hallazgo de Explore)

`src/services/safety/ergonomicAssessments.ts` existe (con `.test.ts` adyacente). El hallazgo del Explore agent fue incorrecto. Servicio activo, exporta evaluaciones según DS 594 y conecta con `BioAnalysis` (Sprint 5 wiring de Bernoulli).

### 3.5 Sistema Zettelkasten (climateRiskCoupling) ✅

`[climateRiskCoupling.ts](src/services/zettelkasten/climateRiskCoupling.ts)` integrado con nodos `CLIMATE_RISK`, `venturi-warning`, `windload-warning` (commit `0bf4620`). Conecta hooks meteorológicos con sistema de alertas. **Mejora pendiente:** los 5 smart actions tipados de Proto 1 (`create-worker-epp-connection`, `suggest-normatives-for-project`, etc.) aún no están en `useZettelkastenIntelligence`.

### 3.6 ManDown ⏳ (parcial)

Detección activa, alarma offline-first ≥30s, jerk-based, escribe Firestore. Pero la UI completa de Proto 1 (con timer visual de re-escalación, mapa de últimos eventos, badge de status del supervisor que ack) sigue pendiente. El backend sí registra; la UI no expone toda esa data. **Esfuerzo restante:** ~6h.

### 3.7 Geofence ⏳ (parcial)

Lógica TurfJS funcional, escribe `zone_violations` en Firestore. La visualización polígono-en-mapa con color por nivel de riesgo y tooltips de Proto 1 quedó como stub. **Esfuerzo restante:** ~4h.

### 3.8 SOS button + driving UI ⏳

`SafeDrivingMode` tiene SOS conectado a `triggerEmergency('driving_sos')` ✅. Falta la versión "driving UI real" con Maps SDK + speed-trigger automático (programada para Sprint 7 en PARTE4).

### 3.9 GeminiChat especializado ⏳

Proto 1 tenía un chat AI con persona "experto OHS Chile" diferente al Asesor general. GP usa el Asesor unificado. **Decisión:** mantener Asesor unificado pero añadir modo "Gemini técnico legal" como persona alternativa cuando la pregunta es 100% normativa. Esfuerzo: ~3h tras B-PERS-04 cerrada.

---

## 4. DECISIÓN: RATIONALE DOCUMENTADO PARA ABANDONOS

### ❌ Blockchain (Reagere, Token PRAEVENTIO PREV, ERC-20 Polygon)

**Por qué se abandonó:**
- Costo regulatorio chileno: emitir token con valor monetario implica registro CMF y obligaciones de PSAV (Proveedor de Servicios de Activos Virtuales). Fuera de scope.
- Volatilidad incompatible con producto B2B SaaS. Empresas no quieren su capacitación certificada en Polygon si la red cambia tarifa de gas.
- Cero demanda real de los design partners (3 mineras, 2 constructoras consultadas dic 2025).
- Implementación parcial en `lib/blockchain-config.ts` y `lib/reagere-config.ts` borrada en pase de deprecación pre-Sprint 2.

**Lo que sí se conserva:** la idea de **certificados verificables** se reemplaza por firma digital (SimpleWebAuthn — ver Sprint 14 en PARTE4) + audit_log inmutable (Firestore rules ya implementan `update: false`).

### ❌ AutoCAD Integration (Pizarra.tsx, AutoCADIntegration.tsx)

**Por qué se abandonó:**
- AutoCAD no tiene SDK web oficial para parsing DWG/DXF. Las librerías OSS (libredwg, dxf-parser) son frágiles con archivos reales del sector minero (40-200MB con XREFs).
- Casos de uso reales del cliente cubiertos por: (a) PDF render de planos vía pdf.js, (b) zonas peligrosas dibujadas manualmente sobre Google Maps, (c) SLAM open source (LingBot-Map) — ver Bernoulli Extension #13 en `[BERNOULLI_EXTENSIONS.md](BERNOULLI_EXTENSIONS.md)`.
- ROI negativo: 80h de integración para que ~5% de proyectos lo usen una vez al año.

**Lo que sí se conserva:** la página `Pizarra.tsx` como tablero colaborativo se reemplaza por integración con Excalidraw embed (Sprint 12 si hay demanda).

### ❌ Easter eggs (LanguageEasterEgg, gamificación contenido oculto)

**Por qué se abandonó:**
- Producto B2B-SaaS con SLA. Easter eggs activables por click-pattern son riesgo de soporte ("¿por qué mi pantalla se puso en chino?") y ruido de UX.
- Conflicto con accesibilidad: triple-click no es discoverable.
- Sistema de "modo admin supremo" con código `GUARDIAN2024` rompe RBAC formal — el path correcto es a través de claims, no localStorage.

**Lo que sí se conserva:** la gamificación de buena UX — medallas, leaderboards, rachas — vive en `MedalSystem.tsx` y `gamificationBackend`. El juego ClawMachine de premios virtuales se eliminó (no genera valor real al cliente B2B).

---

## 5. MEJORAS PROPUESTAS — APLICADAS Y PENDIENTES

| Feature Proto 1 | Mejora propuesta original | Estado |
|----------------|--------------------------|--------|
| WeatherBulletin básico | + AQI real + integración sísmica + faena minera | ✅ aplicada |
| NormativeContext estático | + bcnService.ts real + invalidación caché + inyección automática AI | 🔶 parcial: bcnService cableado, inyección AI pendiente (B-PERS-04) |
| useZettelkastenIntegration con URL | + persistencia Firestore + sugerencias predictivas | ⏳ pendiente |
| AfichesSeguridad con stub | + html2canvas+jsPDF + 14 templates por industria + QR | ⏳ pendiente Sprint 12 |
| GeminiChat en Asesor | Mantener Claude + inyectar NormativeContext + orquestador | 🔶 parcial: NormativeContext disponible pero no inyectado |
| PlanEmergencia 5 tabs | + activación real Firestore + FCM brigada + GPS tiempo real | ✅ aplicada |
| Gamificación básica | Cablear gamificationBackend | ✅ aplicada |
| Anatomía con AI | Conectar con ergonomía → rutinas preventivas | 🔶 parcial: HumanBodyViewer existe, rutinas auto-generadas pendientes |

---

## 6. PÁGINAS PROTO 1 — PRESENCIA EN GP ACTUAL

| Página Proto 1 | GP | Diferencia |
|---------------|----|------------|
| Asesor.tsx | ✅ AsesorChat | GP usa Gemini 3.1 + Claude. Falta WeatherBulletin embed + BCN card |
| PlanEmergencia.tsx | ✅ EmergenciaAvanzada.tsx | 5 tabs + brigadas con roles + 3 procedimientos |
| AfichesSeguridad.tsx | ✅ existe | Descarga real pendiente |
| RubrosChile.tsx | ✅ existe | 14 sectores con normativa específica |
| ISOManagement.tsx | ✅ Audits.tsx + ISOAudit | 6 módulos cableados |
| Pizarra.tsx | ❌ no existe | Decisión de abandono ver §4 |
| DEAZones.tsx | ✅ DEAZones | DEAZoneMap + DEAVerificationForm activos |
| CEODashboard | ✅ ExecutiveDashboard.tsx | conectado |
| PresentationMode | ✅ existe | datos reales conectados |
| VisionMision | ✅ existe | contenido vigente |
| HumanBodyViewer | ✅ existe | 7 regiones, Vertex AI por región |
| WallyGame, ClawMachine, PoolGame | 🔶 parcial | WallyGame y MedalSystem activos; ClawMachine eliminado (ver §4) |

---

## 7. VERIFICACIÓN — TESTS QUE PASAN ✅

| Test | Resultado |
|------|-----------|
| WeatherBulletin dark/light invierte aspecto según hora solar | ✅ |
| EmergencyContext escribe en Firestore | ✅ verificado en `EmergencyContext.tsx:29` |
| Smart actions Zettelkasten URL-based | ⏳ pendiente |
| Compliance scoring 0-100 | ⏳ pendiente |
| AfichesSeguridad descarga PDF | ⏳ pendiente |
| Bernoulli wiring StructuralCalculator NCh 432 | ✅ commit `71a87a8` |
| ergonomicAssessments con altitud | ✅ commit `5178149` |
| respiratorPressureDrop NIOSH | ✅ commit `afa8c08` |

---

> Próxima revisión: 2026-05-31 tras GeminiChat persona técnica + Geofence UI completa.
