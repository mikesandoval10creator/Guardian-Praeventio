# PLAN PARTE 2 — Prototipo 1 (praevium-guard): Hallazgos y Recuperación

> Fuente: https://github.com/mikesandoval10creator/praevium-guard
> 580 commits | Stack: Vite + React + Supabase + Capacitor | 98.1% TypeScript

---

## 1. ARQUITECTURA DEL PROTOTIPO 1

| Aspecto | Proto 1 | GP Actual |
|---------|---------|-----------|
| Backend | Supabase (PostgreSQL) | Firebase (Firestore) |
| Auth | Supabase Auth | Firebase Auth |
| AI | Gemini Pro (GeminiChat) | Claude (Anthropic) via /api/ask-guardian |
| Mobile | Capacitor (Android/iOS) | Capacitor (mismo) |
| Routing | React Router + 44+ rutas | React Router + 86 rutas |
| Providers | 9 (incluye NormativeProvider, ISOProvider, UniversalKnowledgeProvider) | 4 contextos activos |

---

## 2. LA JOYA PRINCIPAL: BOLETÍN CLIMÁTICO CON DARK/LIGHT CROSS-INVERSION

### Qué hace (y por qué es único)

El sistema de tema en Proto 1 no solo responde al modo claro/oscuro del usuario — también responde al **tiempo solar real** calculado astronómicamente. El resultado es una inversión cruzada:

```
Light mode + noche real    → fuerza dark (partículas de estrellas animadas)
Dark mode + día real       → fuerza light (resplandor ámbar)
Light mode + día real      → apariencia normal clara
Dark mode + noche real     → apariencia normal oscura
```

### Archivos a portar/mejorar

**`src/components/WeatherBulletin.tsx`** — NO EXISTE en GP actual
- Muestra: temperatura, UV, humedad, altitud, AQI, precipitación
- Layout dos columnas: izquierda (datos), derecha (SunTracker + Compass)
- Prioridad de iconos: UV≥8 > Lluvia > Día/Noche
- Sanitiza ubicación: elimina códigos postales, añade "Chile"
- Colores AQI: Buena/Moderada/Mala

**`src/components/SunTrackerContainer.tsx`** — NO EXISTE en GP actual
```typescript
// Lógica cross-inversion:
const shouldUseDarkStyle = (isLightTheme && !isDay) || (isDarkTheme && !isDay && !isDay)
const shouldUseLightStyle = (isDarkTheme && isDay)
// Re-chequea cada 10 minutos via useEffect + setInterval
```
- Dark styling: partículas de estrellas con animación staggered pulse
- Light styling: partículas amber con transition-all duration-700
- Calcula sunrise/sunset con declinación solar real

**`src/components/SunTracker.tsx`** — EXISTE como página pero sin lógica completa
```typescript
// Algoritmos astronómicos presentes en proto 1:
interface SunTimesData {
  sunrise: Date; sunset: Date;
  sunPosition: number; // 0-100%
  moonPhase: string;   // 8 fases
  moonIllumination: number;
  hourlyState: string; // 24 estados: "amanecer-dorado", "mediodia-pleno"...
  lunarDay: number;    // 0-27
}
// Solar declination: 23.45 * Math.sin((360 * (284 + dayOfYear) / 365)...)
// Lunar: referencia J2000.0 epoch, ciclo 29.530588853 días
// Hardcoded: UTC-3, longitud referencia -70° (Santiago)
```
- SVG con arco parabólico solar animado
- 24 estados horarios en español con luna

**`src/contexts/ThemeContext.tsx`** — NO EXISTE en GP actual
```typescript
// isDayTime: 6 AM a 8 PM → día; resto → noche
// Recalcula cada hora via setInterval(fn, 60000)
// Exporta: theme, toggleTheme(), setTheme(), isDayTime
// Persiste en localStorage
```

**`src/hooks/useWeather.ts`** — NO EXISTE en GP actual (orchestratorService.ts existe pero diferente)
- Open-Meteo API (meteorológica) + Open-Meteo air-quality endpoint
- Geolocation nativa, fallback a Santiago (-33.45, -70.6667)
- `mapAQIToLabel()`: AQI europeo → Buena/Moderada/Mala
- `adviceFrom()`: recomendaciones contextuales por UV, precipitación, hora
- Auto-refresh cada 600 segundos

**`src/components/WeatherSafetyRecommendations.tsx`** — NO EXISTE en GP actual
- Vertex AI / Gemini 2 para 3 recomendaciones dinámicas
- **Clasificación por altitud:**
  - 0–500m: Normal
  - 500–1500m: -5% oxígeno
  - 1500–2400m: -15% oxígeno
  - >2400m: -25% oxígeno (aclimatación obligatoria)
- Fallback a recomendaciones por regla si AI falla

**`src/components/NativeCompass.tsx`** — EXISTE como stub en GP actual
- SVG compass rose completo con 36 marcas de grado
- Capacitor Device API (magnetómetro)
- Calibración: movimiento figura 8
- Sin internet: badge "SIN INTERNET"
- Precisión color-coded: verde ≤10°, amarillo ≤20°, rojo >20°

### Mejoras propuestas sobre proto 1
- Añadir microanimaciones Framer Motion (ya disponible en GP) al cambio de estado solar
- Integrar datos de AQI reales de OpenWeatherMap (orchestratorService ya los tiene)
- Añadir modo "faena minera" con umbrales de altitud ajustables
- Conectar con `useSeismicMonitor` para mostrar actividad sísmica en el boletín

---

## 3. NORMATIVECONTEXT — BASE DE CONOCIMIENTO NORMATIVA

**`src/contexts/NormativeContext.tsx`** — NO EXISTE en GP actual

### Qué hace
Context provider que gestiona una base de conocimiento estática de normativa chilena OHS.

### Interface completa
```typescript
NormativeContextType {
  searchNormatives(query: string): Normative[]
  searchProtocols(query: string): Protocol[]
  getNormativeByCode(code: string): Normative | undefined
  getProtocolByCode(code: string): Protocol | undefined
  getNormativesByCategory(category: string): Normative[]
  getNormativesBySector(sector: string): Normative[]
  getRelatedNormatives(normativeId: string): Normative[]
  getComprehensiveNormativeContext(): string // ← LA FUNCIÓN CLAVE
  loading: boolean
}
```

### getComprehensiveNormativeContext() — La función más importante
Construye un dump estructurado del marco legal completo para **inyectar en el system prompt del Asesor AI**:
- Marco legal fundacional (Ley 16.744, DS 101/1968, DS 44/2021)
- Higiene industrial (DS 594/1999)
- Gestión de riesgos (DS 298/1994)
- Requisitos sectoriales (DS 132/2004 minería, DS 977 gastronomía)
- Protocolos MINSAL (PREXOR, TMERT, ISTAS21)

### Mejoras propuestas sobre proto 1
- Reemplazar datos estáticos con llamadas reales a bcnService.ts (ya existe en GP)
- Añadir invalidación de caché cuando bcnService detecta versión nueva de la ley
- Conectar directamente al Asesor: inyectar en `/api/ask-guardian` como sistema de contexto
- Mostrar tarjeta BCN con link directo a leychile.cl en respuestas del Asesor

---

## 4. SISTEMA ZETTELKASTEN — HOOKS DE PROTO 1

### useZettelkastenIntegration (proto 1) vs useZettelkastenIntelligence (GP actual)

**Proto 1 tenía:**
```typescript
// Detección de contexto automática por URL:
const context = detectContextFromURL(window.location.pathname)
// Retorna: 'projects' | 'workers' | 'epp' | 'regulations' | 'risks' | 'admin'

// 5 smart actions tipadas:
triggerSmartAction('create-worker-epp-connection')
triggerSmartAction('suggest-normatives-for-project')
triggerSmartAction('link-industry-to-project')
triggerSmartAction('suggest-epp-for-worker')
triggerSmartAction('auto-link-training-to-worker')

// Panel de recomendaciones contextual:
smartPanelVisible: boolean
getSmartRecommendations(): { relatedNodes, suggestedActions, suggestions }
```

**GP actual tiene (useZettelkastenIntelligence):**
```typescript
// Solo orphan detection:
// - Detecta Riesgos sin medidas de control
// - Detecta Trabajadores sin capacitación
// - Crea notificaciones en Firestore
// - Se ejecuta en RootLayout al montar
// NO tiene: URL context, smart actions, panel visible
```

**Upgrade necesario:** Añadir URL-based context detection y las 5 smart actions al hook actual.

### useIndustryIntegration — Compliance Scoring

**Proto 1 tenía:**
```typescript
interface IndustryConnection {
  type: 'epp' | 'normative' | 'risk' | 'training' | 'procedure'
  relatedItems: string[]
  priority: 'critical' | 'high' | 'medium' | 'low'
  complianceScore: number // 0-100 ← NO EXISTE EN GP
}
// Enriquece actividades SII con EPP, normativas, riesgos, procedimientos
// Los conecta como nodos en UniversalKnowledgeContext
```

**GP actual tiene:** Los diccionarios INDUSTRY_NORMATIVES, ROLE_EPP, INDUSTRY_TRAINING pero **sin compliance scoring 0-100**.

---

## 5. PÁGINAS PRESENTES EN PROTO 1

### Páginas con código real en proto 1 (muchas ya existen en GP)

| Página Proto 1 | Estado en GP | Diferencia |
|---------------|-------------|-----------|
| Asesor.tsx | ✅ AsesorChat (componente) | Proto 1 usaba Gemini, GP usa Claude. Sin BCN card ni WeatherBulletin |
| PlanEmergencia.tsx | ✅ EmergenciaAvanzada.tsx | Proto 1 tenía: 5 tabs, brigadas con roles, 3 procedimientos con severidad, activación por equipo |
| AfichesSeguridad.tsx | ✅ Existe en GP | La descarga era STUB en proto 1 también. Implementar html2canvas+jsPDF |
| RubrosChile.tsx | ✅ Existe en GP | Verificar 14 sectores con normativa específica |
| ISOManagement.tsx | ✅ Audits.tsx en GP | Proto 1: ISO 9001+45001 con 6 módulos, integración GCP |
| Pizarra.tsx | ❌ No existe en GP | Solo metáfora en AsesorChat. Crear página real |
| DEAZones.tsx | ✅ DEAZones existe en GP | Verificar DEAZoneMap + DEAVerificationForm presentes |
| CEODashboard | ✅ ExecutiveDashboard.tsx | Verificar completitud |
| PresentationMode | ✅ Existe con métricas ROI | Conectar a datos reales de proyectos |
| VisionMision | ✅ Módulo existe | Verificar contenido |

---

## 6. COMPONENTES EXTRAORDINARIOS DE PROTO 1

### Sistema de Easter Egg (LanguageEasterEgg.tsx)
```
5 clicks → selector de idioma
7 clicks → "Modo Multinacional" (localStorage)
10 clicks → código "GUARDIAN2024" → modo admin supremo
```
Despacha CustomEvents. `PrivateROIDashboard` con contraseña "guardian2025" y bloqueo a 3 intentos.

### Sistema de Filosofía
- `app-philosophy.ts`: 3 pilares con colores HSL
  1. Liderazgo y Determinación
  2. Preparación Estratégica
  3. Servicio y Disponibilidad
- `PhilosophyEngine.getContextualAdvice()`: consejo por sector (minería/construcción/pesquero)
- `usePhilosophyIntegration`: rotación cada 10s, mensajes de emergencia con estilo destructivo

### Gamificación Completa
- `WallyGame.tsx`: "Dónde está Waldo" con 9 industrias chilenas + mascota como Waldo
- `ClawMachine.tsx`: gacha de peluches de seguridad, 4 raridades, contenido generado por Gemini
- `PoolGame.tsx`: juego de física, 4 entornos, velocidad/fricción variables
- `MedalSystem.tsx`: liga Bronze→Obsidian, quiz, leaderboard nacional
- Todos accesibles desde `ArcadeGames.tsx` (ya existe en GP)

### Anatomía con AI
- `HumanBodyViewer.tsx`: 7 regiones corporales, Vertex AI por región, referencia D.S. 594
- `ProfessionalAnatomyViewer.tsx`: 6 sistemas anatómicos, análisis multimodal

### AutoCAD Integration
- `AutoCADIntegration.tsx`: importa DWG/DXF (50MB), visualiza zonas por nivel de riesgo, exporta PDF/DWG/PNG

### HistoryTimeline
- Carrusel auto-scroll desde Código de Hammurabi (1792 AC) hasta Ley Karin 2024
- Tarjetas de terremotos con `animate-bounce` on hover

### MuralDinamicoFirebase
- Red social corporativa de carteles de seguridad
- Patrón de pared de ladrillo en CSS
- Firestore `onSnapshot` en tiempo real
- Preguntas populares por frecuencia de interacción

### Blockchain en src/lib/
- `blockchain-config.ts`: Token PRAEVENTIO (PREV), ERC-20 en Polygon, 10M supply, 800 CLP/token, 12% APY staking, contrato Solidity completo
- `reagere-config.ts`: Token REAGERE en Shibarium, sistema de pensión 80% BTC + 20% SHIB, 1% ingresos → fondo pensión
- **Estado:** Pausado/Descartado por decisión del usuario

---

## 7. MEJORAS PROPUESTAS SOBRE PROTO 1

| Feature Proto 1 | Mejora para GP |
|----------------|----------------|
| WeatherBulletin básico | + Datos AQI reales de OpenWeatherMap + integración seísmica + modo faena minera |
| NormativeContext estático | + bcnService.ts real + invalidación de caché + inyección automática en AI |
| useZettelkastenIntegration con URL | + Persistencia en Firestore de contexto por sesión + sugerencias predictivas |
| AfichesSeguridad con stub | + html2canvas+jsPDF funcional + templates por industria (14 rubros) + QR code |
| GeminiChat en Asesor | Mantener Claude + inyectar NormativeContext + orquestador ambiental |
| PlanEmergencia 5 tabs | + Activación real a Firestore + notificación FCM a brigada + GPS de brigada en tiempo real |
| Gamificación básica | Conectar gamificationBackend (ya existe server.ts /api/gamification) |
| Anatomía con AI | Conectar con BRECHA de ergonomics para generar rutinas preventivas |

---

## 8. VERIFICACIÓN PARA FEATURES DE PROTO 1

| Test | Condición de éxito |
|------|-------------------|
| WeatherBulletin dark/light | Cambiar tema → boletín invierte aspecto según hora solar real |
| NormativeContext → Asesor | Preguntar sobre DS 594 → AI reconoce automáticamente sin especificar |
| Smart actions Zettelkasten | Ir a /workers → panel muestra "suggest-epp-for-worker" automáticamente |
| AfichesSeguridad descarga | Seleccionar template A4 + mensaje → PDF real descargable |
| Compliance scoring | useIndustryIntegration retorna scores 0-100 por conexión |
