# PLAN PARTE 4 — Roadmap de Implementación Unificado

> Integra hallazgos de GP actual + Prototipo 1 + Prototipo 2
> Objetivo: Hacer REAL cada módulo y nodo. Mejorar el diseño sobre lo que tenían los prototipos.

---

## PRINCIPIOS DE ESTA IMPLEMENTACIÓN

1. **Mejorar, no solo portar** — Cada feature de los prototipos se implementa con mejor diseño UI/UX
2. **Real sobre stub** — Si existe en código pero no funciona de extremo a extremo, no cuenta
3. **Seguridad primero** — Las brechas letales (BRECHA-00 al 04) bloquean todo lo demás
4. **Zettelkasten como columna vertebral** — Las conexiones entre módulos son el valor diferencial
5. **El Gran Maestro siempre con contexto ambiental** — AI nunca responde sin datos del campo

---

## FASE 0 — SEGURIDAD LETAL (Esta semana, ~2 horas)

**Sin esto NO hay pruebas de campo.**

| # | Tarea | Archivos | Tiempo |
|---|-------|---------|--------|
| 0.1 | EmergencyContext → Firestore real | src/contexts/EmergencyContext.tsx | 20 min |
| 0.2 | SafeDrivingMode SOS → llama EmergencyContext | src/pages/SafeDrivingMode.tsx | 5 min |
| 0.3 | SafeDrivingMode Base → número dinámico | src/pages/SafeDrivingMode.tsx + src/types/ | 15 min |
| 0.4 | ManDown → mandown_events Firestore + acknowledge | src/hooks/useManDownDetection.ts | 30 min |
| 0.5 | Geofence → zone_violations Firestore | src/hooks/useGeofence.ts | 15 min |
| 0.6 | Añadir ruta /sun-tracker | src/routes/OperationsRoutes.tsx | 2 min |
| 0.7 | Configurar RESEND_API_KEY y WEBHOOK_SECRET | .env / deploy config | 10 min |
| 0.8 | ManDown re-escalación (server job 10 min) | server.ts | 20 min |
| 0.9 | Seismic monitor → triggerEmergency si M≥4.5 | src/hooks/useSeismicMonitor.ts | 15 min |

**Total estimado: ~2.5 horas**

---

## FASE 1 — DISEÑO: BOLETÍN CLIMÁTICO (Semana 1, ~2 días)

**Objetivo:** Portar el sistema de tema inteligente de proto 1 y mejorar el boletín climático.

### 1.1 ThemeContext con isDayTime
**Archivo nuevo:** `src/contexts/ThemeContext.tsx`
```typescript
// isDayTime: 6 AM a 8 PM Chile
// Exporta: theme, toggleTheme(), isDayTime
// Recalcula cada hora
// Persiste en localStorage
```

### 1.2 Motor Astronómico SunTracker
**Mejorar:** `src/pages/SunTracker.tsx` (ya existe como página básica)
- Añadir algoritmos de proto 1: declinación solar, ángulo horario, ecuación del tiempo
- 24 estados horarios en español ("amanecer-dorado", "mediodia-pleno")
- 8 fases lunares con ciclo J2000.0
- SVG animado con arco parabólico solar

### 1.3 SunTrackerContainer (cross-inversion)
**Archivo nuevo:** `src/components/SunTrackerContainer.tsx`
```typescript
// Mejoras sobre proto 1:
// + Framer Motion para transiciones suaves (ya disponible en GP)
// + Integrar datos sísmicos en el estado del contenedor
// + Modo "faena minera" con ajuste de altitud
```

### 1.4 WeatherBulletin
**Archivo nuevo:** `src/components/WeatherBulletin.tsx`
- Integrar `orchestratorService.ts` (ya existe y funciona)
- Mostrar: temperatura, UV, humedad, AQI, precipitación, sismicidad
- Layout responsivo dos columnas
- **Mejoras sobre proto 1:**
  - AQI de OpenWeatherMap real (orchestratorService ya lo tiene)
  - Indicador sísmico si hay actividad ≥3.0 en últimas 6h
  - Umbral de altitud configurable por proyecto
  - Animaciones Framer Motion en cambio de estado

### 1.5 WeatherSafetyRecommendations
**Archivo nuevo:** `src/components/WeatherSafetyRecommendations.tsx`
- Mantener lógica de altitud de proto 1 (0→500→1500→2400m)
- Usar Claude en lugar de Gemini (endpoint `/api/ask-guardian`)
- Fallback a reglas predefinidas si AI falla

### 1.6 NativeCompass
**Mejorar:** `src/components/NativeCompass.tsx` (ya existe como stub)
- Implementar la lógica completa de proto 1
- SVG compass rose con 36 marcas
- Calibración figura 8
- Badge "SIN INTERNET" offline

### 1.7 Integración
- Montar WeatherBulletin en `Dashboard.tsx` y en `Asesor` page
- Exportar isDayTime desde ThemeContext y usarlo en RootLayout

---

## FASE 2 — IA CONTEXTUAL (Semana 1-2, ~3 días)

**Objetivo:** Implementar "El Gran Maestro" en el Asesor actual.

### 2.1 NormativeContext
**Archivo nuevo:** `src/contexts/NormativeContext.tsx`
- Portar estructura de proto 1
- **Mejora:** Conectar a `bcnService.ts` en lugar de datos estáticos
- `getComprehensiveNormativeContext()` como función principal
- Categorías: fundacional, higiene industrial, gestión riesgos, sectorial, MINSAL

### 2.2 Conectar Orquestador al Asesor
**Modificar:** `server.ts` ruta `/api/ask-guardian`
```typescript
// Antes de llamar a Claude:
const envContext = await fetchEnvironmentContext(lat, lng);
const normativeCtx = getNormativeContextForSector(sector);
const systemPrompt = buildExpertSystemPrompt(envContext, normativeCtx);
```

### 2.3 Output JSON estructurado (El Gran Maestro)
- Añadir al system prompt la instrucción de JSON estricto
- Parser en frontend para renderizar causa_raiz, riesgos[], plan_accion
- Tarjeta BCN link directo a leychile.cl en respuestas normativas

### 2.4 Mejoras UI del Asesor
- Renderizar JSON estructurado como cards (no texto plano)
- Indicador visual "Contexto activo: T=22°C, Viento=15km/h, Sin actividad sísmica"
- Card normativa con link BCN cuando respuesta menciona decreto/ley

---

## FASE 3 — ZETTELKASTEN REAL (Semanas 2-4, ~1 semana)

**Objetivo:** De 2 consumidores a 30. De orphan detection a inteligencia real.

### 3.1 Upgrade useZettelkastenIntelligence
**Modificar:** `src/hooks/useZettelkastenIntelligence.ts`
- Mantener orphan detection (ya funciona)
- **Añadir:** Detección de contexto por URL
  ```typescript
  const context = detectContextFromURL(location.pathname)
  // '/workers' → 'workers'
  // '/ergonomics' → 'ergonomics'
  // '/risks' → 'risks'
  ```
- **Añadir:** 5 smart actions tipadas (de proto 1)

### 3.2 SmartConnectionsPanel flotante
**Archivo nuevo:** `src/components/knowledge/SmartConnectionsPanel.tsx`
- Panel flotante que aparece según contexto URL
- Lista de acciones sugeridas por tipo de módulo
- Persistencia: estado visible en localStorage por sesión
- Montar en `RootLayout.tsx`

### 3.3 Upgrade UniversalKnowledgeContext
**Modificar:** `src/contexts/UniversalKnowledgeContext.tsx`
- Añadir al interface: `.graph`, `.createNode()`, `.createEdge()`
- Auto-conexión por sector, rol, y tags comunes (lógica de proto 1)
- Conectar con `useRiskEngine()` para nodos

### 3.4 Compliance Scoring
**Modificar:** `src/hooks/useIndustryIntegration.ts`
- Añadir `complianceScore: number` (0-100) por conexión
- Score basado en: cobertura EPP + cumplimiento normativo + estado capacitaciones
- Exponer en Dashboard como "Índice de Cumplimiento"

### 3.5 Pizarra como página real
**Archivo nuevo:** `src/pages/Pizarra.tsx`
- `InteractiveBoardManager` (ya existe en components/knowledge/)
- `SmartConnectionsPanel` (nuevo, fase 3.2)
- `KnowledgeGraph` (ya existe en components/shared/ — NO montado actualmente)
- Meta: tablero colaborativo de seguridad conectado al Risk Network

### 3.6 Bootstrapping automático desde Diagnóstico
**Modificar:** `src/pages/Diagnostico.tsx`
- Al completar evaluación → inferir rubro SII
- Llamar `useIndustryIntegration.bootstrapProjectKnowledge()`
- Pre-cargar nodos de normativa + EPP por industria

---

## FASE 4 — ACTIVAR SERVICIOS MUERTOS (Semana 3, ~2 días)

**7 servicios con 0 callers → conectar a sus rutas existentes en server.ts**

| Servicio | Endpoint server.ts | Conectar desde |
|---------|-------------------|----------------|
| coachBackend | /api/coach/chat | AsesorChat.tsx (modo coach) |
| gamificationBackend | /api/gamification/* | MedalSystem.tsx, WallyGame.tsx |
| safetyEngineBackend | /api/ask-guardian | SafetyForecast.tsx, PredictiveAnalysis.tsx |
| environmentBackend | /api/telemetry/ingest | Telemetry.tsx |
| dataSeedService | /api/seed-data | Settings admin panel |
| oauthTokenStore | OAuth flow | InviteAccept.tsx + SSOConfig.tsx |
| seedBackend | /api/seed-glossary | Glossary admin |

### Hooks de seguridad con 1 consumidor → ampliar
- `useAcousticSOS`: añadir a EmergenciaAvanzada.tsx
- `useManDownDetection`: añadir a Dashboard.tsx (supervisores deben verlo)
- `useSurvivalPing`: añadir a todos los módulos de campo

---

## FASE 5 — COMPLETITUD DE PÁGINAS (Mes 2, ~2 semanas)

**Páginas que existen pero necesitan trabajo específico**

### 5.1 AfichesSeguridad — Descarga real
**Modificar:** `src/pages/modules/AfichesSeguridad.tsx` (o equivalente)
- Implementar `handleDownload()` con html2canvas + jsPDF (ambas instaladas)
- Templates por industria: 14 rubros de proto 1
- QR code generado (qrcode ya instalado)
- Formatos: A4, A3, A2 con resolución para impresión

### 5.2 PlanEmergencia — 5 tabs + activación real
- 5 tabs: Resumen, Brigada, Procedimientos, Evacuación, Normativas
- 4 roles de brigada con responsabilidades explícitas
- Activación → escribe en Firestore → FCM a brigada
- GPS de brigada en tiempo real durante emergencia

### 5.3 ISOManagement — 6 módulos reales
- ISO 9001:2015 + ISO 45001:2018
- Dashboard, Documentos, Competencias, Auditorías, Riesgos, Mejora Continua
- Conectar a colección `iso_audits` en Firestore

### 5.4 Training — Certificado descargable
- Añadir botón "Descargar Certificado" en sesión completada
- Usar generateTrainingCertificate (ya importado, nunca llamado)

### 5.5 Anatomía + Ergonomía conectadas
- HumanBodyViewer: conectar región corporal a datos de ergonomía del trabajador
- Al marcar región → crear nodo en Risk Network via useRiskEngine
- Generar rutina preventiva via Gemini

### 5.6 MuralDinamico — Pared comunitaria real
- Firestore onSnapshot (ya existe en MuralDinamicoFirebase)
- Verificar que auth-gated likes/shares funcionan
- Integrar con Zettelkasten: publicar "Lecciones Aprendidas" automáticamente

---

## FASE 6 — EVACUACIÓN DINÁMICA AI (Mes 2, ~1 semana)

### 6.1 Endpoint /api/emergency/dynamic-route
```typescript
// server.ts (nuevo endpoint):
app.post('/api/emergency/dynamic-route', verifyAuth, async (req, res) => {
  const { location, eventType, blockages } = req.body;
  const envContext = await fetchEnvironmentContext(location.lat, location.lng);
  // 1. Intentar A* determinista primero (seguridad vital)
  // 2. Si A* no tiene datos: Gemini como fallback
  // 3. Retornar: route[], safeZones[], estimatedTime
});
```

### 6.2 Conectar DynamicEvacuationMap
- `src/components/emergency/DynamicEvacuationMap.tsx` → llamar nuevo endpoint
- Mostrar ruta animada + zonas seguras
- Integrar datos sísmicos y climáticos en tiempo real

### 6.3 Computer Vision EPP
- `src/components/ai/VisionAnalyzer.tsx` → conectar a `/api/gemini`
- Prompt especializado: detectar EPP presente/faltante
- Referencia automática a normativa aplicable (D.S. 132, D.S. 594)

---

## FASE 7 — ENTERPRISE SECURITY (Mes 2-3, ~2 semanas)

### 7.1 Verificar y completar Firestore Rules
- Confirmar 3 roles: general > officer > soldado
- Confirmar assignedSiteIds para scoping por sitio
- Implementar audit_log inmutable (if false en update/delete)
- Aplicar storage rules de proto 2 (12 buckets con límites)

### 7.2 SSO SAML/OIDC
- SSOConfig.tsx UI ya existe
- Implementar backend SAML/OIDC con Firebase Auth provider
- Soporte Azure AD + Google Workspace

### 7.3 ERP/HRM API completa
- ERPIntegration.tsx UI ya existe
- /api/erp/sync endpoint ya existe en server.ts
- Completar sync bidireccional con Buk/SAP (schema validation con Zod)

### 7.4 Compresión de imágenes antes de Storage
- Canvas API antes de upload a Firebase Storage
- Reducir tamaño promedio de fotos EPP de ~5MB a ~1MB

---

## FASE 8 — NODOS 321-512: CONSTRUIR EL FUTURO (Mes 3+)

### Bloque V — Inteligencia Colectiva (321-380)
- Red social corporativa de seguridad (MuralDinamico mejorado)
- Lecciones aprendidas globales entre faenas
- Benchmarking anónimo de índices de accidentabilidad
- Sistema de mentores: trabajador experto → trabajador nuevo

### Bloque VI — Ecosistema Enterprise (381-430)
- Google Workspace full (Drive, Calendar, Sheets bidireccional)
- ERP/SAP/Buk sync completo
- SSO enterprise (Azure AD, Okta)
- Blockchain para certificados de capacitación (ERC-20 en Polygon)

### Bloque VII — Expansión Regional (431-470)
- 15 países LATAM con sus normativas específicas
- Pack normativa Chile (actual), Bolivia (Reglamento 583), Perú (Ley 29783), Brasil (NR-35)
- Multi-moneda: CLP, USD, PEN, BOB, BRL
- Panel de idiomas: español, inglés, portugués, quechua (interface)

### Bloque VIII — AI Avanzada (471-512)
- Computer vision EPP en tiempo real (stream de cámara)
- Digital twin de la faena (Three.js ya disponible en GP)
- Asistente de voz manos libres con ElevenLabs (Carmen, Roberto, Sarah)
- Biometría comportamental para detección de fatiga
- Gemelos digitales de trabajadores para simulación de riesgo

---

## RESUMEN EJECUTIVO

```
ESTA SEMANA (Fase 0 + inicio Fase 1):
├── Brechas letales: EmergencyContext, SOS, ManDown, Geofence
├── Ruta SunTracker
└── ThemeContext + inicio WeatherBulletin

MES 1 (Fases 1-3):
├── Boletín climático completo con dark/light cross-inversion
├── El Gran Maestro: Asesor con contexto ambiental + normativo
└── Zettelkasten real: URL context + SmartConnectionsPanel + Pizarra

MES 2 (Fases 4-6):
├── 7 servicios muertos conectados
├── Páginas completadas: AfichesSeguridad, ISOManagement, PlanEmergencia
└── Evacuación dinámica AI + Computer Vision EPP

MES 2-3 (Fase 7):
├── Enterprise: SSO, ERP, Firestore rules completas
└── Preparación para expansión

MES 3+ (Fase 8):
└── Nodos 321-512: expandir al futuro
```

---

## HERRAMIENTAS DE DISEÑO PARA MEJORAR LOS PROTOTIPOS

| Área | Herramienta | Uso |
|------|-------------|-----|
| Componentes UI | shadcn/ui (ya instalado) | Consistencia visual |
| Animaciones | Framer Motion (ya instalado) | Transiciones WeatherBulletin, Zettelkasten |
| Gráficos | Recharts (ya instalado) | Dashboard métricas, compliance scoring |
| Node graph | @xyflow/react (instalar) | Visualización Zettelkasten visual |
| PDF export | html2canvas + jsPDF (ya instalado) | AfichesSeguridad, certificados |
| AI para UI | Claude AI via /api/gemini | Generar sugerencias UX contextuales |
| 3D | Three.js (ya instalado) | Digital twins, anatomía 3D |

---

## VERIFICACIÓN END-TO-END

| Test | Fase | Condición de éxito |
|------|------|-------------------|
| SOS en campo | F0 | Presionar → doc en Firestore en <2s + FCM a supervisor |
| WeatherBulletin night | F1 | Cambiar a tema claro → boletín muestra estrellas animadas si es noche |
| Asesor con contexto | F2 | "¿Qué EPP necesito hoy?" → respuesta incluye temperatura y sismicidad actuales |
| Smart action worker | F3 | Ir a /workers → panel sugiere "suggest-epp-for-worker" automáticamente |
| Afiches PDF | F5 | Seleccionar A3 + minería → PDF descargable con normativa D.S. 132 |
| Ruta evacuación AI | F6 | Simular sismo → mapa muestra ruta calculada con condiciones actuales |
| Compliance 0-100 | F3 | Worker sin capacitación muestra score 23 en dashboard |
| Audit log | F7 | Intentar updateDoc en audit_log → PERMISSION_DENIED |
