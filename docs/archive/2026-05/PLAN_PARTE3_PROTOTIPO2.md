# PLAN PARTE 3 — Prototipo 2 (Firebase Lovable.dev): Hallazgos y Recuperación

> Documento actualizado: 2026-05-03 | Re-priorizado tras Sprint 5
> Fuente: https://github.com/mikesandoval10creator/Guardian-Praeventio-f-irebaseversion
> 1 commit | Código en Lovable.dev (no accesible) | Documentación parcialmente recuperada

---

## 1. ESTADO DEL REPOSITORIO PROTO-2

El repositorio Proto-2 fue siempre solo metadata + reglas — el código vivía en Lovable.dev (`https://lovable.dev/projects/1dc6ba8f-212d-4c15-9557-dfc60dd65485`). Lo recuperable:

| Documento | Estado |
|-----------|--------|
| `firestore.rules` | ✅ recuperado e integrado en GP |
| `storage.rules` | ✅ recuperado e integrado en GP |
| `BUILD_ERRORS.md` | ✅ recuperado |
| `analisis_funcional.md` | ❌ **PERDIDO** — no existe en GitHub ni en notas locales |
| `auditoria01.md` (sesión audit dic 2025) | ❌ **PERDIDO** |
| `PLAN_MAESTRO.md` (512 nodos) | ❌ **PERDIDO** — solo recuerdos del usuario sobre 320 primeros nodos |
| `ROADMAP_RESCATE.md` | ✅ recuperado |
| `_respaldo_codigo_antiguo` | ❌ confirmado AUSENTE (era local en Lovable.dev) |

**Decisión recomendada:** Aceptar la pérdida formalmente. Los nodos 1–320 están reconstruidos a través de los servicios actuales (94 servicios cubren la mayoría). Los nodos 321–512 nunca fueron especificados — declarar como **no implementables hasta workshop de scoping** (ver §6).

---

## 2. ARQUITECTURA "EL GRAN MAESTRO" — Estado de adopción

### El patrón de 3 capas AI (recuperado de auditoria01.md → memoria del usuario)

```
Request del usuario
       ↓
praeventio.ts (portal / anti-corrupción)
       ↓
praeventio-orchestrator.ts ("Los Sentidos")
   ├── OpenWeatherMap adapter (resiliente con simulación de fallback)
   └── USGS seismic adapter (no resiliente — regresión identificada)
       ↓
praeventio-main.ts ("El Gran Maestro")
   AI persona: "experto OHS con 30 años de experiencia"
   Output OBLIGATORIO: JSON estricto
   { causa_raiz, riesgos[], plan_accion: { correctivas[], preventivas[] } }
```

### Estado en GP actual

- `[orchestratorService.ts](src/services/orchestratorService.ts)` ✅ existe, llama OpenWeatherMap + USGS en tiempo real.
- `fetchEnvironmentContext(lat, lng)` ✅ existe y es invocable.
- **El Asesor `/api/ask-guardian` NO consume `fetchEnvironmentContext`** ❌ — esta es la **brecha crítica del audit 2026-05-03**.

---

## 3. BRECHA CRÍTICA — `/api/ask-guardian` sin contexto ambiental

### Evidencia

Archivo `[src/server/routes/gemini.ts:124-191](src/server/routes/gemini.ts)` — endpoint `POST /ask-guardian`:

```typescript
// gemini.ts:135-152 (RESUMEN del estado actual)
const { searchRelevantContext } = await import('../../services/ragService.js');
const context = await searchRelevantContext(query);

const prompt = `
  Eres "El Guardián", el núcleo de inteligencia artificial de Praeventio Guard.
  ...
  CONTEXTO LEGAL RELEVANTE:
  ${context}
  PREGUNTA DEL USUARIO:
  ${query}
`;
```

**Lo que falta:** ningún llamado a `fetchEnvironmentContext()`. El Asesor responde sobre "EPP recomendado para una soldadura" sin saber que en la zona hay viento de 70 km/h, sismo M4.1 hace 20 minutos, UV 11, o altitud 3200m. PARTE3 (Gran Maestro) lo exigía explícitamente desde diciembre 2025.

### Fix propuesto (4 horas)

```typescript
// Antes del searchRelevantContext call (línea ~135), añadir:
const { fetchEnvironmentContext } = await import('../../services/orchestratorService.js');
const { lat, lng } = req.body.location ?? {};
const envContext = lat && lng
  ? await fetchEnvironmentContext(lat, lng).catch(() => null)
  : null;

// Construir el prompt aumentado:
const envBlock = envContext
  ? `[CONTEXTO AMBIENTAL]
     - Temperatura: ${envContext.weather?.temp}°C
     - Viento: ${envContext.weather?.windSpeed} km/h
     - UV: ${envContext.weather?.uvIndex}
     - Sismicidad reciente: ${envContext.seismic?.magnitude ?? 'sin actividad'} (${envContext.seismic?.distance ?? 'n/a'} km)`
  : '[CONTEXTO AMBIENTAL] No disponible (cliente no envió coordenadas)';

const augmentedQuery = `${envBlock}\n\nPREGUNTA: ${query}`;
const context = await searchRelevantContext(augmentedQuery);  // RAG ahora ve env tags
```

Y forzar output JSON estructurado (Gran Maestro):

```typescript
// Añadir al system prompt:
"Responde SIEMPRE en JSON con: causa_raiz (string), riesgos[]{descripcion,severidad,probabilidad}, plan_accion{correctivas[],preventivas[]}"
```

### Decisiones adoptadas vs. no adoptadas

| Diseño Proto-2 | Estado en GP |
|----------------|--------------|
| El Gran Maestro persona | 🔶 persona presente, contexto ambiental pendiente |
| `fetchEnvironmentContext` resiliente | ✅ existe |
| RBAC dual-layer (rules + custom claims) | ✅ adoptado |
| MIME-typed Storage rules | ✅ adoptado |
| Zettelkasten con metadata + bidirectional connections | ✅ adoptado |
| Inyección env context en `/api/ask-guardian` | ❌ **no adoptado — fix arriba** |
| Scoping por `assignedSiteIds` custom claim | ❌ no adoptado |
| `audit_log` inmutable Firestore rules | ✅ adoptado en `firestore.rules:425-450` |
| `audit_log` inmutable integrado a normativa changes | ❌ no adoptado |

---

## 4. RBAC CON CUSTOM CLAIMS — comparativa

### Modelo Proto-2

```javascript
// 3 roles: 'general' > 'officer' > 'soldado'
// assignedSiteIds[] en token
function isGeneral() { return request.auth.token.role == 'general'; }
function hasAccessToSite(siteId) {
  return siteId in request.auth.token.assignedSiteIds;
}
match /audit_log/{docId} {
  allow update: if false;  // BLOQUEADO incluso para generals
  allow delete: if false;
}
```

### Modelo GP actual

GP implementa RBAC con 6 roles (no 3) — más granular que Proto-2 — y BRECHA-04 del roadmap se cerró integrando Firestore rules + custom claims. Falta el scoping `assignedSiteIds` que Proto-2 sí especificaba; en GP el scoping actual es por `projectId` membership en colecciones `projects/{id}/members`. Migrar a custom claim añade un `O(1)` en cada read sin necesitar lookup de membership.

**Decisión:** mantener 6 roles GP, pero **adoptar `assignedSiteIds` como claim adicional** en Sprint futuro de hardening (estimado 6h). El RBAC actual cubre los casos de uso B2B; el delta es performance.

---

## 5. STORAGE RULES — Adoptado ✅

Las 12 buckets MIME-typed de Proto-2 están reflejadas en `storage.rules` actual de GP. Verificar tamaños puntuales (training-videos 500MB es generoso; revisar si Cloud Storage costs justifican bajarlo a 200MB para tier Free).

---

## 6. PLAN_MAESTRO — 320 nodos definidos, 192 nodos hoja en blanco

### Estado real de los nodos (corregido)

| Bloque | Nodos | Descripción | Estado |
|--------|-------|-------------|--------|
| I | 1–75 | Identidad y Perfil | ✅ implementado |
| II | 76–135 | Sensores y Tiempo Real | ✅ implementado |
| III | 136–311 | Gestión y Procesos | ✅ implementado |
| IV | 312–320 | Bio-Ingeniería y Fisiología | ✅ implementado (extendido en Sprint 5 con Bernoulli) |
| V–VIII | 321–512 | **NUNCA DEFINIDO — 192 nodos hoja en blanco** | ❌ |

**Total: 320 nodos definidos + 192 specced-but-unbuilt = 512 nominales.**

### Decisión recomendada

PARTE3 versión 2026-04-30 proponía un blueprint para 321–512 (Inteligencia Colectiva, Ecosistema Enterprise, Expansión Regional, AI Avanzada). Esa propuesta **no fue ratificada** por el usuario y la documentación original (`PLAN_MAESTRO.md`) está perdida.

**Acción:** Antes de gastar esfuerzo en estos nodos, hacer un workshop de scoping de 1 día con design partners reales (~6h). El output debe ser un nuevo `PLAN_MAESTRO_2026-Q3.md` o un abandono formal del concepto "512 nodos". Mientras tanto, los Sprints 6–17 documentados en `[ROADMAP_2026-05.md](ROADMAP_2026-05.md)` y `[PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md](PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md)` cubren el valor concreto.

---

## 7. DOCUMENTOS PERDIDOS — Recuperación o abandono

### Propuesta de recuperación parcial

| Doc | Recuperable | Estrategia |
|-----|-------------|------------|
| `analisis_funcional.md` | 🔶 parcial | Reconstruir como `ARCHITECTURE.md` (ya existe en repo, 26KB) |
| `auditoria01.md` | ❌ no | Aceptar pérdida; este documento PARTE3 **es** la auditoría viva |
| `PLAN_MAESTRO.md` (512 nodos) | ❌ no | Abandono formal; reemplazar por `ROADMAP_2026-05.md` (17 sprints) |

`ARCHITECTURE.md` actual ya cubre 95% del contenido inferido de `analisis_funcional.md`. No re-crear.

---

## 8. AI COMPUTER VISION — Módulo activado en Sprint 5

Proto-2 tenía `lib/ai-computer-vision.ts` sin integración. En GP actual:
- `[VisionAnalyzer.tsx](src/components/ai/VisionAnalyzer.tsx)` ✅ activo, conectado a `/api/gemini`
- `respiratorPressureDrop` cableado en VisionAnalyzer (commit `afa8c08`, NIOSH 42 CFR Part 84)
- `useNativeCamera.ts` ✅ activo
- Detección EPP en imagen estática ✅, stream en tiempo real ⏳ Sprint 12

---

## 9. RUTAS DE EVACUACIÓN AI — `generateDynamicRoute`

| Componente | Estado |
|------------|--------|
| `EmergenciaAvanzada.tsx` | ✅ |
| `DynamicEvacuationMap.tsx` | ✅ |
| `orchestratorService` con weather+seismic | ✅ |
| Algoritmo A* determinista | ✅ implementado |
| `/api/emergency/dynamic-route` con env context | ⏳ depende de fix B-PERS-04 |

**Patrón seguro:** A* primero (determinista), Gemini solo como fallback si A* no tiene grafo de la zona. **Nunca al revés** por seguridad vital.

---

## 10. BUILD_ERRORS.md — Estado de los contratos TypeScript

Los errores documentados en Proto-2 (`KnowledgeContextType` faltando `graph`, `createNode`, `createEdge`) se cerraron al portar `UniversalKnowledgeContext` a GP. `useNormativeContext` resolvió cuando el contexto se integró (§3 PARTE2). **Sin TS errors abiertos en GP.**

---

## 11. VERIFICACIÓN — Tests críticos

| Test | Estado |
|------|--------|
| El Gran Maestro inyecta env context en `/api/ask-guardian` | ❌ **fix pendiente — 4h** |
| Output JSON estructurado del Asesor | ❌ pendiente con el mismo fix |
| Ruta evacuación dinámica con condiciones actuales | 🔶 backend listo, env injection bloquea |
| Computer vision EPP detecta faltantes con D.S. 594 | ✅ |
| `audit_log` updateDoc retorna PERMISSION_DENIED | ✅ verificado en rules |
| `assignedSiteIds` RBAC scoping | ⏳ no adoptado, decisión Sprint hardening |

---

## 12. SIGUIENTE PASO ACCIONABLE

Una sola tarea desbloquea más valor que el resto: **Sprint 10 = inyección env context en `/api/ask-guardian`** (ver `[PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md](PLAN_PARTE4_ROADMAP_IMPLEMENTACION.md)` §Sprint 10). 4 horas de trabajo, transforma el Asesor de RAG legal estático en el Gran Maestro real que Proto-2 diseñó.

---

> Próxima revisión: 2026-05-31 tras Sprint 10 (env context) y workshop de scoping nodos 321–512.
