# PLAN PARTE 3 — Prototipo 2 (Firebase Version): Hallazgos y Recuperación

> Fuente: https://github.com/mikesandoval10creator/Guardian-Praeventio-f-irebaseversion
> 1 commit | Código en Lovable.dev (no accesible desde GitHub) | Documentación completa disponible

---

## 1. ESTADO DEL REPOSITORIO

El repositorio proto 2 contiene **solo archivos de configuración y documentación** — el código fuente vive en Lovable.dev (`https://lovable.dev/projects/1dc6ba8f-212d-4c15-9557-dfc60dd65485`).

Lo que SÍ está disponible y es recuperable:
- `analisis_funcional.md` — mapa arquitectónico completo
- `auditoria01.md` — audit session dic 2025 con decisiones técnicas
- `PLAN_MAESTRO.md` — 512 nodos del sistema
- `ROADMAP_RESCATE.md` — plan de 5 fases de rescate de módulos
- `firestore.rules` + `storage.rules` — modelo de datos y seguridad completo
- `BUILD_ERRORS.md` — errores TypeScript activos al momento del freeze

**`_respaldo_codigo_antiguo`**: Confirmado AUSENTE en GitHub. Era carpeta local en Lovable.dev excluida del build con "velvet rope" comment en vite.config.ts. Contenía versiones antiguas de Cloud Functions.

---

## 2. ARQUITECTURA "EL GRAN MAESTRO" — La joya de proto 2

### El patrón de 3 capas AI

Proto 2 diseñó un backend AI donde **el AI nunca responde sin contexto ambiental real**:

```
Request del usuario
       ↓
praeventio.ts (portal / anti-corrupción)
       ↓
praeventio-orchestrator.ts ("Los Sentidos")
   ├── OpenWeatherMap adapter
   │   └── Resiliente: devuelve datos simulados si falla API
   └── USGS seismic adapter
       └── No resiliente: devuelve null si falla (regresión identificada)
       ↓
praeventio-main.ts ("El Gran Maestro")
   AI persona: "experto en seguridad industrial con 30 años de experiencia"
   Output OBLIGATORIO: JSON estricto
   {
     causa_raiz: string,
     riesgos: Array<{ descripcion, severidad, probabilidad }>,
     plan_accion: {
       correctivas: string[],
       preventivas: string[]
     }
   }
```

### Estado en GP actual
- `orchestratorService.ts` **YA EXISTE** y llama OpenWeatherMap + USGS en tiempo real ✅
- Pero **NO está conectado** a `/api/ask-guardian` ❌
- El Asesor responde sin saber si hay viento de 80 km/h o sismo de 5.0 en la zona

### Implementación en GP

**Paso 1:** En `server.ts` ruta `/api/ask-guardian` (línea ~353):
```typescript
// Añadir antes de llamar a Gemini/Claude:
const envContext = await fetchEnvironmentContext(lat, lng);
const systemPrompt = `
  Eres un experto en seguridad industrial con 30 años de experiencia.
  Contexto ambiental actual del sitio:
  - Temperatura: ${envContext.weather.temp}°C
  - Viento: ${envContext.weather.windSpeed} km/h
  - UV: ${envContext.weather.uvIndex}
  - Sismicidad reciente: ${envContext.seismic?.magnitude ?? 'Sin actividad'}
  ${normativeContext} // ← de NormativeContext (Parte 2)
`;
```

**Paso 2:** Forzar output JSON estructurado:
```typescript
// Añadir al system prompt:
"Responde SIEMPRE en JSON con: causa_raiz, riesgos[]{descripcion,severidad,probabilidad}, plan_accion{correctivas[],preventivas[]}"
```

---

## 3. RBAC CON CUSTOM CLAIMS — firestore.rules

### Modelo de 3 roles confirmado en firestore.rules

```javascript
// Roles: 'general' > 'officer' > 'soldado'
// Cada usuario tiene assignedSiteIds[] en token

function isGeneral() { return request.auth.token.role == 'general'; }
function isOfficer() { return request.auth.token.role == 'officer'; }
function isSoldier() { return request.auth.token.role == 'soldado'; }
function hasAccessToSite(siteId) {
  return siteId in request.auth.token.assignedSiteIds;
}

// Regla especial — audit_log ES INMUTABLE:
match /audit_log/{docId} {
  allow read: if isAuthenticated();
  allow create: if isAuthenticated(); // Solo services accounts
  allow update: if false; // BLOQUEADO incluso para generals
  allow delete: if false; // BLOQUEADO incluso para generals
}
```

### Estado en GP actual
- GP tiene RBAC dual-capa (Firestore rules + custom claims) ✅
- Verificar si tiene los 3 roles específicos (general/officer/soldado)
- Verificar si tiene `assignedSiteIds` en token para scoping por sitio
- Verificar si tiene audit_log inmutable

### Implementación en GP (si no existe)
```typescript
// Cloud Function setUserRole (o endpoint en server.ts):
await admin.auth().setCustomUserClaims(uid, {
  role: 'officer', // 'general' | 'officer' | 'soldado'
  assignedSiteIds: ['faena-norte-01', 'faena-sur-02']
});
```

---

## 4. STORAGE RULES — 12 Buckets Tipados

Proto 2 define storage con tamaños y MIME types específicos por categoría:

| Bucket | Límite | Tipos permitidos |
|--------|--------|-----------------|
| epp-photos/{userId}/ | 10 MB | image/* |
| training-videos/ | 500 MB | video/* |
| training-documents/{userId}/ | 50 MB | PDF, imagen, texto |
| medical/{userId}/ | 20 MB | PDF, imagen |
| audits/{userId}/{auditId}/ | 25 MB | imagen, PDF |
| emergency-assets/{userId}/ | 15 MB | cualquier tipo |
| certificates/{userId}/ | 10 MB | PDF únicamente |
| temp/{userId}/ | 100 MB | auto-delete 24h via Cloud Function |
| public/ | sin límite | read: todos auth; write: if false (solo server-side) |
| backups/{userId}/ | sin límite | user-scoped |

**Implementar en GP:** Verificar que las reglas de storage actuales tienen estos límites. Si no, aplicar el modelo de proto 2.

---

## 5. RUTAS DE EVACUACIÓN AI — generateDynamicRoute

### Diseño de proto 2

```typescript
// Cloud Function generateDynamicRoute:
// Input: { userId, location: {lat, lng}, eventType, weatherConditions }
// AI: Vertex AI / Gemini Pro
// Output: { route: Waypoint[], safeZones: Zone[], estimatedTime: number }

// Frontend: EmergencyEvacuationSystem.tsx
// Llama a generateDynamicRoute → muestra ruta animada en mapa
```

### Estado en GP actual
- `EmergenciaAvanzada.tsx` existe ✅
- `DynamicEvacuationMap.tsx` existe en components/emergency/ ✅
- `orchestratorService.ts` tiene datos weather+seismic ✅
- Algoritmo A* documentado en TODO.md como "Implementado" ✅
- Pero: ¿DynamicEvacuationMap llama a un endpoint real o es stub? (verificar)

### Implementación en GP
Añadir endpoint en `server.ts`:
```typescript
app.post('/api/emergency/dynamic-route', verifyAuth, async (req, res) => {
  const { location, eventType } = req.body;
  const envContext = await fetchEnvironmentContext(location.lat, location.lng);
  // Llamar a Gemini con contexto ambiental + calcular ruta A*
  // Si A* implementado: usar algoritmo determinista
  // Si no: usar Gemini como fallback (nunca al revés por seguridad)
});
```

---

## 6. AI COMPUTER VISION — Módulo Latente

Proto 2 tenía `lib/ai-computer-vision.ts` — módulo completo pero **sin ninguna integración activa**.

### Capacidades documentadas
- Detección de EPP en tiempo real (cámara)
- Análisis estático de imágenes
- Batch processing de fotos
- Reportes de compliance EPP

### Estado en GP actual
- `VisionAnalyzer.tsx` existe en components/ai/ ✅
- `useNativeCamera.ts` hook existe ✅
- `DocumentOCRManager.tsx` existe ✅
- ¿Están conectados a un backend AI real? (verificar — probablemente stub)

### Implementación
Conectar `VisionAnalyzer.tsx` al endpoint `/api/gemini` con:
```typescript
// Prompt especializado para detección EPP:
"Analiza esta imagen de un trabajador. Identifica: 
 1. EPP presente (casco, chaleco, guantes, calzado)
 2. EPP faltante según actividad detectada
 3. Normativa aplicable (D.S. 594, D.S. 132)
 4. Nivel de riesgo: CRÍTICO/ALTO/MEDIO/BAJO"
```

---

## 7. PLAN MAESTRO — 512 Nodos

### Estado de los nodos

| Bloque | Nodos | Descripción | Estado proto 2 |
|--------|-------|-------------|----------------|
| I | 1–75 | Identidad y Perfil | ✅ Implementado |
| II | 76–135 | Sensores y Tiempo Real | ✅ Implementado |
| III | 136–311 | Gestión y Procesos | ✅ Implementado |
| IV | 312–320 | Bio-Ingeniería y Fisiología | ✅ Implementado |
| V–VIII | 321–512 | **INEXISTENTE** | ❌ Nunca definido |

Los nodos 321–512 (192 nodos) son una **hoja en blanco declarada** — no hay descripción de qué deben hacer.

### Propuesta para Nodos 321–512

| Bloque propuesto | Nodos | Descripción |
|-----------------|-------|-------------|
| V — Inteligencia Colectiva | 321–380 | Red social interna, Mural dinámico, lecciones aprendidas globales, benchmarking entre faenas |
| VI — Ecosistema Enterprise | 381–430 | Google Workspace full, ERP/SAP/Buk, SSO enterprise, blockchain certificados |
| VII — Expansión Regional | 431–470 | 15 países LATAM, packs normativa por país, multi-moneda, Reglamento 583 Bolivia, NR-35 Brasil |
| VIII — AI Avanzada | 471–512 | Computer vision EPP en tiempo real, digital twins de faena, voz manos libres, biometría |

---

## 8. ROADMAP_RESCATE — 5 Fases de Proto 2

Proto 2 tenía un plan de rescate de módulos que es directamente aplicable a GP:

**Fase 1 — Prevención de Riesgos:**
- Riesgos.tsx, Matriz.tsx, MedidasControl.tsx, PrevencionRiesgos.tsx
- GP: todos existen, verificar que están 100% conectados a Firestore

**Fase 2 — Pilar Humano:**
- Trabajadores, EPP, Ergonomia, Medicina, Higiene
- GP: todos existen, BRECHA-08 y BRECHA-09 aplican aquí

**Fase 3 — Orden y Cumplimiento:**
- Normativas, ComiteParitario, AuditoriasPage, Inspecciones
- GP: existen, ComiteParitario es de los mejor implementados

**Fase 4 — Escudo de Emergencias:**
- PlanEmergencia, Evacuacion, Emergencia, EmergenciaAvanzada
- GP: BRECHAS-00/01/07/10 aplican directamente aquí

**Fase 5 — Flujo de Conocimiento:**
- Capacitaciones, Entrenamiento, AfichesSeguridad, Material, Documentos
- GP: existen, AfichesSeguridad necesita export real

---

## 9. DEPENDENCIAS NOTABLES DE PROTO 2 PARA EVALUAR

| Dependencia | Versión | Propósito | Evaluación para GP |
|------------|---------|-----------|-------------------|
| @xyflow/react | 12.8.3 | Visualización node-graph Zettelkasten | INSTALAR — KnowledgeGraph.tsx lo necesita |
| dexie | 4.3.0 | IndexedDB ORM offline-first | GP ya tiene idb, evaluar migración |
| mapbox-gl | 3.14.0 | Mapas para rutas evacuación | GP usa Google Maps, mantener |
| ethers | 6.15.0 | Web3/blockchain | PAUSADO por usuario |
| @metamask/detect-provider | 2.0.0 | Detección MetaMask | PAUSADO por usuario |

---

## 10. BUILD_ERRORS.MD — Contratos TypeScript Rotos

Los errores de TypeScript de proto 2 son un **mapa de lo que falta implementar**:

```typescript
// ERROR 1: KnowledgeContextType falta:
interface KnowledgeContextType {
  graph: GraphData;        // ← AÑADIR
  createNode: (node) => void;  // ← AÑADIR
  createEdge: (edge) => void;  // ← AÑADIR
  // ... resto existe
}
// Afecta: IndustryKnowledgeIntegrator, KnowledgeNodeBadge,
//         SmartConnectionsPanel, ZettelkastenEnhancement, MainLayout

// ERROR 2: Módulo no encontrado:
import { useNormativeContext } from '@/contexts/NormativeContext'
// Afecta: NormativeReference.tsx, SmartSuggestions.tsx
// Fix: Portar NormativeContext desde proto 1 (ver Parte 2)

// ERROR 3: Implicit any en parámetros:
// KnowledgeNodeBadge, SmartConnectionsPanel, NormativeReference
// Fix: Tipar explícitamente con las interfaces de KnowledgeContextType
```

---

## 11. MEJORAS PROPUESTAS SOBRE PROTO 2

| Diseño Proto 2 | Mejora para GP |
|---------------|----------------|
| El Gran Maestro con Gemini Pro | Adaptar a Claude + inyectar NormativeContext chileno |
| USGS adapter sin resiliencia | Añadir fallback igual que weather adapter |
| security-manager desconectado | Reconectar a validación de backend en /api/ask-guardian |
| generateDynamicRoute sin fallback | Usar A* determinista primero, Gemini solo si A* falla |
| ai-computer-vision.ts sin integrar | Conectar a VisionAnalyzer.tsx + useNativeCamera.ts |
| audit_log inmutable | Verificar reglas Firestore actuales en GP |
| assignedSiteIds en token | Verificar y añadir si falta en custom claims |

---

## 12. VERIFICACIÓN FEATURES DE PROTO 2

| Test | Condición de éxito |
|------|-------------------|
| El Gran Maestro | /api/ask-guardian incluye temp, viento, sismicidad en contexto AI |
| Output JSON estructurado | Respuesta del Asesor siempre incluye causa_raiz, riesgos[], plan_accion |
| Ruta evacuación dinámica | DynamicEvacuationMap genera ruta basada en condiciones actuales |
| Computer vision EPP | VisionAnalyzer detecta EPP faltante en foto con referencia a D.S. 594 |
| audit_log inmutable | updateDoc/deleteDoc a audit_log retorna PERMISSION_DENIED |
| assignedSiteIds RBAC | Officer con siteId X no puede ver datos de siteId Y |
