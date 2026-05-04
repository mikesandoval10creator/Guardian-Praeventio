# Auditoria 777 — Parte 2 (Apéndices Bucket C y D)

> Continuación de `auditoria777.md`. Acá viven los detalles ejecutables del Agente C (code review + simplify + UX polish) y Agente D (spec Sprint 20).

## Apéndice C — Detalle ejecutable de cada hallazgo del Bucket C

### F-C01 [🟡] [Agente C] Convertir findMedicalIcon a Map lookup
**Tipo**: simplify · **Archivo**: src/services/medical/iconLibrary.ts:80-82 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 5min · **Dep**: ninguna

**Descripción**: `findMedicalIcon` hace `Array.find()` lineal sobre 33 entries por cada llamada. En módulos como `HumanBodyViewer` que hacen 7 lookups por render, son 7×33 = 231 comparaciones por render. Convertir a `Map<string, MedicalIconEntry>` lazy-initializado a O(1).

**Plan ejecutable**:
1. Test primero: `src/services/medical/iconLibrary.test.ts` (si no existe — crear, si existe agregar caso):
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { findMedicalIcon, MEDICAL_ICON_REGISTRY } from './iconLibrary';

   describe('findMedicalIcon', () => {
     it('returns the entry for a known name', () => {
       const entry = findMedicalIcon('lung-pair');
       expect(entry?.publicPath).toBe('/icons/biology/lung-pair.svg');
     });
     it('returns undefined for unknown name', () => {
       expect(findMedicalIcon('nonexistent')).toBeUndefined();
     });
     it('lookup is consistent across many calls (idempotent)', () => {
       for (let i = 0; i < 100; i++) {
         expect(findMedicalIcon('heart-anatomical')?.name).toBe('heart-anatomical');
       }
     });
   });
   ```
2. Editar `src/services/medical/iconLibrary.ts`. Reemplazar líneas 80-82:
   ```typescript
   // Lazy-initialized index for O(1) lookup. The registry is frozen-shape, so the
   // Map is built once per process. Tested in iconLibrary.test.ts.
   let _index: Map<string, MedicalIconEntry> | null = null;
   function getIndex(): Map<string, MedicalIconEntry> {
     if (_index === null) {
       _index = new Map(MEDICAL_ICON_REGISTRY.map((entry) => [entry.name, entry]));
     }
     return _index;
   }

   export function findMedicalIcon(name: string): MedicalIconEntry | undefined {
     return getIndex().get(name);
   }
   ```
3. Run tests → PASS.
4. Commit: `perf(medical): convert findMedicalIcon to O(1) Map lookup`

**Criterio de éxito**:
- Tests pasan
- Smoke render: páginas con muchos `<MedicalIcon>` (HumanBodyViewer) renderizan idéntico

---

### F-C02 [🟢] [Agente C] AnatomyLibrary MedicalIcon size consistency
**Tipo**: ux-polish · **Archivo**: src/components/medicine/AnatomyLibrary.tsx · **Skill**: frontend-design · **MCP**: ninguno · **Estim**: 10min · **Dep**: ninguna

**Descripción**: AnatomyLibrary fue uno de los 11 módulos donde se wireó MedicalIcon en Sprint 17c. Revisar que los tamaños usados (size prop) sean consistentes con el resto:
- Inline en heading: 20-24
- Card-header decorativo: 32-48
- Inline body text: 16-18

Si encontrás `size={48}` en posiciones inline, bajar a 24. Si encontrás `size={16}` en card-headers, subir a 32.

**Plan ejecutable**:
1. Abrir `src/components/medicine/AnatomyLibrary.tsx`.
2. Grep `<MedicalIcon` y revisar cada uso:
   - Inline en h1/h2/h3 → `size={20}` o `size={24}` (gap-1.5 ml-2)
   - Card decorativo → `size={32}` o `size={48}` (gap-2 con `aria-hidden`)
3. Tomar la patrón de `src/components/occupational-health/MedicalAnalyzer.tsx:120-124` como canonical.
4. Si hay inconsistencias, ajustar manteniendo la jerarquía visual.
5. Smoke visual: `npm run dev`, navegar a `/medicine/anatomy`, comparar con `/medicine/diagnosis`.
6. Commit: `style(medical): align MedicalIcon sizes in AnatomyLibrary with MedicalAnalyzer convention`

**Criterio de éxito**:
- Tamaños consistentes con el patrón canonical
- Render visual sin saltos de tamaño raros

---

### F-C03 [🟢] [Agente C] AptitudeCertificateForm MedicalIcon coherencia
**Tipo**: ux-polish · **Archivo**: src/components/medicine/AptitudeCertificateForm.tsx · **Skill**: frontend-design · **MCP**: ninguno · **Estim**: 8min · **Dep**: ninguna

**Plan ejecutable**:
1. Revisar `<MedicalIcon>` en form fields (junto a labels): debe ser size 18-22 con `text-teal-600 dark:text-gold-500`.
2. Si hay inconsistencias con el patrón de `EPPVerificationModal` (size=22 ml-2), ajustar.
3. Render visual.
4. Commit: `style(medical): align MedicalIcon size in AptitudeCertificateForm`

**Criterio de éxito**: tamaños alineados con la convención.

---

### F-C04 [🟢] [Agente C] DifferentialDiagnosis MedicalIcon coherencia
**Tipo**: ux-polish · **Archivo**: src/components/medicine/DifferentialDiagnosis.tsx · **Skill**: frontend-design · **MCP**: ninguno · **Estim**: 8min · **Dep**: ninguna

**Plan ejecutable**: idem F-C02/F-C03, aplicado a DifferentialDiagnosis.

**Criterio de éxito**: idem.

---

### F-C05 [🟢] [Agente C] DrugInteractions MedicalIcon coherencia
**Tipo**: ux-polish · **Archivo**: src/components/medicine/DrugInteractions.tsx · **Skill**: frontend-design · **MCP**: ninguno · **Estim**: 8min · **Dep**: ninguna

**Plan ejecutable**: idem.

**Criterio de éxito**: idem.

---

### F-C06 [🟢] [Agente C] VigilanciaScheduler MedicalIcon coherencia
**Tipo**: ux-polish · **Archivo**: src/components/medicine/VigilanciaScheduler.tsx · **Skill**: frontend-design · **MCP**: ninguno · **Estim**: 8min · **Dep**: ninguna

**Plan ejecutable**: idem.

**Criterio de éxito**: idem.

---

### F-C07 [🟢] [Agente C] AddMedicineModal MedicalIcon en header
**Tipo**: ux-polish · **Archivo**: src/components/medicine/AddMedicineModal.tsx · **Skill**: frontend-design · **MCP**: ninguno · **Estim**: 8min · **Dep**: ninguna

**Plan ejecutable**:
1. Revisar header del modal: el patrón canonical de `EPPVerificationModal:145-152` es una fila de 6 íconos `size={22}` con `gap-1.5` y `aria-hidden="true"`.
2. AddMedicineModal probablemente tenga sólo 1-2 íconos en su header (pill, syringe). Confirmar size 22-24 y `aria-hidden` apropiado.
3. Commit.

**Criterio de éxito**: pattern consistente.

---

### F-C08 [🟢] [Agente C] EPPVerificationModal sanity check
**Tipo**: ux-polish · **Archivo**: src/components/epp/EPPVerificationModal.tsx:145-152 · **Skill**: frontend-design · **MCP**: ninguno · **Estim**: 5min · **Dep**: ninguna

**Plan ejecutable**:
1. Confirmar que la fila de 6 MedicalIcon (helmet/goggles/n95/hearing/gloves/harness) sigue siendo:
   ```tsx
   <div className="hidden md:flex items-center gap-1.5 ml-2 text-emerald-500" aria-hidden="true">
     <MedicalIcon name="helmet-safety" size={22} alt="Casco" />
     ...
   </div>
   ```
2. Si todo OK, NO MODIFICAR. Es la referencia.
3. Si falta `aria-hidden` o el `text-emerald-500` se cambió por algo no semántico, restaurar.

**Criterio de éxito**: archivo sin cambios o cambio mínimo conservador.

---

### F-C09 [🟡] [Agente C] MedicalAnalyzer hex → tokens semánticos
**Tipo**: simplify · **Archivo**: src/components/occupational-health/MedicalAnalyzer.tsx:120 · **Skill**: simplify · **MCP**: ninguno · **Estim**: 8min · **Dep**: ninguna

**Descripción**: `text-[#2a8a81] dark:text-[#d4af37]` es funcionalmente correcto pero rompe el sistema de tokens semánticos (tokens en `src/index.css` líneas 11-55). Con tokens, futuros cambios de paleta son una sola edición. Hoy hay 235+ ocurrencias de hex hardcodeado en 36 archivos — atacar esto incremental.

**Plan ejecutable**:
1. Verificar que existen los tokens correspondientes en `src/index.css`:
   - `--color-teal-600: #2e8079` (cercano a `#2a8a81` — no idéntico, validar visualmente)
   - `--color-gold-500` (TBD — leer index.css completo)
2. Si los tokens existen y son visualmente equivalentes (delta < ΔE 5), reemplazar:
   ```tsx
   <div className="hidden sm:flex items-center gap-1.5 ml-3 text-[#2a8a81] dark:text-[#d4af37]" aria-hidden="true">
   ```
   con:
   ```tsx
   <div className="hidden sm:flex items-center gap-1.5 ml-3 text-teal-600 dark:text-gold-500" aria-hidden="true">
   ```
3. Si los tokens NO son visualmente equivalentes, agregar el hex exacto como variable CSS en `src/index.css` y referenciarla por nombre — NO hardcodear nuevamente.
4. Smoke visual: comparar render light + dark.
5. Commit: `style(medical): use teal-600/gold-500 tokens instead of hardcoded hex in MedicalAnalyzer`

**Criterio de éxito**:
- Render visual idéntico (eyeball comparison)
- `grep "text-\[#" src/components/occupational-health/MedicalAnalyzer.tsx` retorna 0

---

### F-C10 [🟡] [Agente C] Replicar pattern hex → tokens en src/components/medicine
**Tipo**: simplify · **Archivo**: src/components/medicine/* (8 archivos) · **Skill**: simplify · **MCP**: ninguno · **Estim**: 25min · **Dep**: F-C09

**Descripción**: Replicar el reemplazo F-C09 en los 8 archivos de medicine con hex hardcodeado:
- DifferentialDiagnosis (7 hits)
- DrugInteractions (11 hits)
- VigilanciaScheduler (9 hits)
- AnatomyLibrary (5 hits)
- AptitudeCertificateForm (8 hits)

**Constraint hard**: `nodeTypeUtils.ts` con `lime-500` (NodeType.ATTENDANCE) NO se toca — es semántico para ese tipo de nodo, intencional.

**Plan ejecutable**:
1. Para cada archivo en `src/components/medicine/`:
   1. `grep "text-\[#"` para listar.
   2. Para cada match, reemplazar con token semántico equivalente (teal/gold/petroleum/coral según uso).
   3. Smoke visual de la página.
2. NO tocar `src/utils/nodeTypeUtils.ts` (lime-500 intencional).
3. Verificación: `grep -rn "text-\[#(2a8a81|4db6ac|d4af37)\]" src/components/medicine/` → 0
4. Commit: `style(medicine): replace hardcoded hex with semantic tokens (8 files)`

**Criterio de éxito**:
- Grep retorna 0
- `nodeTypeUtils.ts` sigue con `'#84cc16'` y `'bg-lime-500'` para ATTENDANCE
- Render visual de los 8 archivos sin diferencia perceptible

---

### F-C11 [🟡] [Agente C] Test determinismo nodeIdFor
**Tipo**: review · **Archivo**: src/services/zettelkasten/persistence/writeNode.ts:64-87 · **Skill**: code-review · **MCP**: ninguno · **Estim**: 6min · **Dep**: ninguna

**Descripción**: `nodeIdFor` es la pieza clave de la idempotencia del Zettelkasten — si se rompe, los retries de la cola offline duplican filas. Revisar el contrato y agregar test que demuestre que mismos inputs ⇒ mismo id.

**Plan ejecutable**:
1. Crear (si no existe) `src/services/zettelkasten/persistence/writeNode.idempotency.test.ts`:
   ```typescript
   import { describe, it, expect } from 'vitest';
   import { nodeIdFor } from './writeNode';
   import type { RiskNodePayload } from '../types';

   const PAYLOAD_A: RiskNodePayload = {
     type: 'hidrante-pressure',
     title: 'Caída de presión',
     description: 'Hidrante 3 con caída a 12 PSI',
     severity: 'high',
     metadata: { hidrante: '3', presion: 12 },
     connections: ['nodo-1', 'nodo-2'],
     references: ['NCh 432'],
   } as any;

   describe('nodeIdFor — idempotencia', () => {
     it('mismos inputs ⇒ mismo id en N llamadas', async () => {
       const id1 = await nodeIdFor(PAYLOAD_A, 'project-1');
       const id2 = await nodeIdFor(PAYLOAD_A, 'project-1');
       const id3 = await nodeIdFor(PAYLOAD_A, 'project-1');
       expect(id1).toBe(id2);
       expect(id1).toBe(id3);
     });
     it('mismo payload, project distinto ⇒ id distinto', async () => {
       const id1 = await nodeIdFor(PAYLOAD_A, 'project-1');
       const id2 = await nodeIdFor(PAYLOAD_A, 'project-2');
       expect(id1).not.toBe(id2);
     });
     it('orden de keys en metadata NO altera el id', async () => {
       const a = { ...PAYLOAD_A, metadata: { hidrante: '3', presion: 12 } };
       const b = { ...PAYLOAD_A, metadata: { presion: 12, hidrante: '3' } };
       const ida = await nodeIdFor(a, 'project-1');
       const idb = await nodeIdFor(b, 'project-1');
       expect(ida).toBe(idb);
     });
     it('id es 16 hex chars', async () => {
       const id = await nodeIdFor(PAYLOAD_A, 'project-1');
       expect(id).toMatch(/^[0-9a-f]{16}$/);
     });
   });
   ```
2. Run → debería pasar (la implementación actual ya es determinista).
3. Si falla, NO arreglar la implementación — reportar al orquestador (es regresión seria).
4. Commit: `test(zettelkasten): assert nodeIdFor idempotency contract (4 cases)`

**Criterio de éxito**:
- 4 tests pasan
- Sin cambio en `writeNode.ts`

---

### F-C12 [🟡] [Agente C] climateRiskCoupling hot-path review
**Tipo**: review · **Archivo**: src/services/zettelkasten/climateRiskCoupling.ts:1-100 · **Skill**: code-review · **MCP**: ninguno · **Estim**: 10min · **Dep**: ninguna

**Descripción**: 434 LOC, llama `dynamicPressure` y `windLoadOnSurface` en thresholds. Revisar si esas calls están en hot loops (cada render). Si sí, considerar memoize. Si no, dejar nota explicativa y cerrar el hallazgo.

**Plan ejecutable**:
1. Leer `src/services/zettelkasten/climateRiskCoupling.ts` completo.
2. Buscar llamadas a `dynamicPressure(` y `windLoadOnSurface(` — registrar:
   - ¿En qué función ocurren?
   - ¿Esa función se llama por cada forecast day, o sólo cuando hay viento sobre threshold?
3. Si se llaman para CADA día sin guard de threshold: agregar guard temprano (`if (windKmh < WINDLOAD_KMH_TRIGGER) return;` antes del compute).
4. Si ya hay guard: documentar en el comentario del módulo que las calls son cheap (puro determinístico, no IO).
5. Reportar al orquestador qué se encontró. Si el cambio es trivial (1 línea) implementarlo en este task. Si requiere refactor mayor, dejar TODO.

**Criterio de éxito**:
- Reporte claro: "hot-path no requerido / requerido y aplicado"
- Si aplicado: cambio mínimo + commit `perf(zettel): early-return in climate coupling when below wind threshold`

---

### F-C13 [🟡] [Agente C] IPERCAnalysis split de IPERCMatrix
**Tipo**: simplify · **Archivo**: src/components/risks/IPERCAnalysis.tsx (634 LOC) · **Skill**: simplify · **MCP**: ninguno · **Estim**: 30min · **Dep**: ninguna

**Descripción**: IPERCAnalysis a 634 LOC contiene probablemente: state management + matrix rendering + filters + actions + modal. La matriz IPERC es un componente bien delineado que puede vivir en su propio archivo.

**Plan ejecutable**:
1. Leer `src/components/risks/IPERCAnalysis.tsx` completo.
2. Identificar el bloque de "renderMatrix" / componente que dibuja la matriz.
3. Crear `src/components/risks/IPERCMatrix.tsx`:
   - Props bien tipadas (no `any`)
   - Stateless si posible
   - Tests con `@testing-library/react` para snapshot mínimo
4. En IPERCAnalysis, importar IPERCMatrix y reemplazar el inline.
5. Verificar que `npm run typecheck` y tests existentes pasan.
6. Verificar que el LOC de `IPERCAnalysis.tsx` baja a ≤520 (extraer ~120 LOC).
7. Smoke render: `/risks/iperc` se ve idéntico.
8. Commit: `refactor(risks): extract IPERCMatrix into its own component`

**Criterio de éxito**:
- LOC `IPERCAnalysis.tsx` ≤ 520
- Render visual idéntico
- Tests existentes siguen pasando

---

### F-C14 [🟡] [Agente C] ISOManagement split header + filters
**Tipo**: simplify · **Archivo**: src/components/audits/ISOManagement.tsx (773 LOC) · **Skill**: simplify · **MCP**: ninguno · **Estim**: 25min · **Dep**: ninguna

**Plan ejecutable**:
1. Leer archivo.
2. Extraer:
   - `ISOManagementHeader.tsx` — title, breadcrumbs, action buttons (~80-100 LOC)
   - `ISOManagementFilters.tsx` — search, category, status filters (~70-100 LOC)
3. Importar y reemplazar inline.
4. Tests + render visual.
5. Commit: `refactor(audits): extract ISOManagement header + filters subcomponents`

**Criterio de éxito**:
- LOC `ISOManagement.tsx` ≤ 620
- Render idéntico
- Tests pasan

---

### F-C15 [🟢] [Agente C] moduleGroups.ts coherencia tokens
**Tipo**: review · **Archivo**: src/components/dashboard/moduleGroups.ts · **Skill**: code-review · **MCP**: ninguno · **Estim**: 8min · **Dep**: ninguna

**Plan ejecutable**:
1. Leer `src/components/dashboard/moduleGroups.ts`.
2. Buscar definiciones de "module groups" con `color`/`bgColor`/`gradient` keys.
3. Si hardcodean hex, reportar — pero NO refactorizar todavía (puede ser un sistema de paleta separado, ver memoria del usuario sobre 4 modos UX).
4. Si usan tokens semánticos (`teal-500` etc.), nada que hacer — confirmar buena práctica.
5. Reportar al orquestador.

**Criterio de éxito**:
- Reporte claro
- Refactor opcional, sin urgencia

---

## Apéndice D — Detalle ejecutable del Bucket D

### F-D01 [🟢] [Agente D] Spec Sprint 20 — decisión Brecha B (SLM offline) vs Brecha C (fotogrametría auto)
**Tipo**: spec · **Output**: `docs/sprints/SPRINT_20_SPEC.md` (CREATE) + `docs/sprints/sprint-20-architecture.png` (CREATE) · **Skill**: superpowers:brainstorming + superpowers:writing-plans + nano-banana:nano-banana · **MCP**: plugin_context7_context7 · **Estim**: 60min · **Dep**: ninguna

**Descripción**: De las 4 brechas estratégicas identificadas (memoria del usuario `product_strategic_gaps_2026-05-04.md`):
- **Brecha A**: Capacitor plugins nativos opt-in — FallDetection ya hecho ✅
- **Brecha B**: SLM offline — pendiente
- **Brecha C**: pipeline fotogrametría auto — pendiente
- **Brecha D**: E2E Playwright — Sprint 19 lo cierra ✅

Sprint 20 debe atacar B o C. Esta decisión se toma vía brainstorm comparando esfuerzo, valor de producto, dependencias técnicas, riesgo. El output es una spec con 4 mini-planes ejecutables (no 1 mega-plan): cada plan tiene file paths, tests TDD, deps, MCPs.

**Plan ejecutable**:

**Fase 1 — Brainstorm (15min)**

Invocar `superpowers:brainstorming` para evaluar B vs C contra estos ejes:

| Eje | Brecha B (SLM offline) | Brecha C (fotogrametría auto) |
|---|---|---|
| Esfuerzo | Alta — requiere model selection, quantization, IndexedDB caching, runtime WebGPU/WebGL | Media — requiere pipeline cámara→3D, COLMAP/MeshLab/photogrammetry-cli wrapper, Cloud Function para procesar |
| Valor producto | Alto — privacidad + offline + cero latencia para advice básico | Alto — Site25DPanel realmente cobra vida cuando faena puede generar su mesh sola |
| Dependencias | WebGPU disponible (Chrome 113+, Safari 17+, Capacitor 8 OK); modelos open: Gemma 2B, Phi-3 Mini, TinyLlama | Cloud Function GPU (T4 mínimo $0.35/hr); usuario debe subir 30+ fotos; UX guía captura |
| Riesgo | Medio — primera vez productizando ML local; tamaño de modelo afecta install (200-500 MB) | Bajo — pipeline COLMAP es maduro; UX cámara es UI-fest pero conocido |
| Test mental "3 fases del Flow Infinito" | Detección offline ✅ + Respuesta sin red ✅ + Consolidación al reconectar ✅ | Detección visual del entorno ✅ + Respuesta automatizada ✅ + Consolidación en Site25DPanel ✅ |
| Constraint Gemini-first prod | OK — SLM es complemento offline, Gemini sigue dirigiendo runtime online | OK — fotogrametría no compite con Gemini |
| Licencias | Gemma (Apache 2.0), Phi-3 (MIT) — frontend-friendly | COLMAP (BSD), photogrammetry-cli wrapped server-side — OK |

**Recomendación a redactar**: si el usuario quiere "el efecto wow más visible al usuario en faena en menos sprints", elegir **Brecha C** (fotogrametría auto). Site25DPanel lo gana en demo. SLM queda para Sprint 21 — la curva de aprendizaje on-device-ML es ortogonal al resto del runtime.

Si el usuario prioriza "privacidad + offline-first como diferencial", elegir **Brecha B**.

La spec final debe presentar AMBAS opciones y la recomendación, pero estructurar el plan ejecutable para LA opción recomendada.

**Fase 2 — Validación de libs (10min)**

Invocar `plugin_context7_context7`:
- Para B: resolve-library-id `transformers.js` y `webgpu` para confirmar APIs y estabilidad. Consultar a Hugging Face docs para weight formats compatibles.
- Para C: resolve-library-id `photogrammetry-cli` o equivalente. Confirmar que existe binario Linux para Cloud Run.

**Fase 3 — Mockup nano-banana (10min)**

Invocar `nano-banana:nano-banana` con prompt:
```
Architecture diagram for Praeventio Sprint 20 — [Brecha C: photogrammetry pipeline / Brecha B: on-device SLM]:
- User uploads 30 photos via mobile camera in /faena/scan
- Photos POSTed to /api/scan/photogrammetry (multipart)
- Cloud Run job spawns photogrammetry-cli COLMAP T4 GPU
- Output mesh.glb stored in Cloud Storage
- Site25DPanel pulls mesh.glb via signed URL and renders in three.js
Use teal #4db6ac + petroleum #061f2d + gold #d4af37 brand palette.
1024x1024, isometric/flat hybrid.
```
Output: `docs/sprints/sprint-20-architecture.png`.

**Fase 4 — Escribir SPEC.md (25min)**

Crear `docs/sprints/SPRINT_20_SPEC.md` con esta estructura:

```markdown
# Sprint 20 Spec — [Recommended brecha]

## Decisión: Brecha [B/C]
[Razones del brainstorm]

## Plan ejecutable (4 mini-planes)

### Plan 1 — [Nombre del primer chunk] (~3-4h)
**Archivos**:
- Create: ...
- Modify: ...

**Steps**:
1. Test primero: ...
2. Implementación mínima: ...
3. ...

[etc — 4 planes en total con LOC exacto, deps, criterios de éxito]

## Brecha alternativa diferida (alt brecha): contexto
[Por si en Sprint 21 se ataca]

## Constraints validados (context7 lookups)
- ...

## Diagram
![Architecture](./sprint-20-architecture.png)
```

**Fase 5 — Commit + reportar al orquestador**

```bash
git add docs/sprints/SPRINT_20_SPEC.md docs/sprints/sprint-20-architecture.png
git commit -m "docs(sprint-20): spec brecha [B/C] with 4-plan execution + nano-banana arch diagram"
```

Reportar al orquestador:
- Brecha recomendada
- Total estimación Sprint 20 (suma de 4 mini-planes)
- Top riesgo de la decisión

**Criterio de éxito**:
- `docs/sprints/SPRINT_20_SPEC.md` ≥ 800 LOC con 4 mini-planes ejecutables
- `docs/sprints/sprint-20-architecture.png` generado y commiteado
- Recomendación clara entre B y C con justificación
- 0 código de runtime tocado

**Constraint hard a recordar**:
- NO Anthropic SDK en runtime productivo (Gemini-first siempre)
- NO Stripe (descartado en favor Transbank/Khipu/GooglePlay)
- Frontend MIT/CC0/CC BY puro — descartar GPL/AGPL en cualquier lib propuesta
- Tests integration usan Firestore real (no mocks)

---

## Cierre

Esta auditoría 777 cubre 38 hallazgos repartidos en 4 buckets agentic, con detalles ejecutables que un implementador con cero contexto del repo puede levantar paso a paso. El código base demuestra disciplina arquitectónica notable — los hallazgos son cierres de Sprint 19 y oportunidades de polish, no incendios.

**Next steps recomendados al orquestador**:

1. Lanzar Agente A (cost optimization) primero — sus 18 hallazgos tienen menor estimación serial (~75 min) y bloquean nada. Habilita el deploy de F-A03+A04 al runtime (cost saver inmediato).
2. Lanzar Agente B en paralelo desde el comienzo — sus dependencias internas son F-B01, F-B05 antes de F-B06..F-B09. La estimación total ~190 min, recomendable partir en B1+B2 sub-agentes.
3. Lanzar Agente C después de A para evitar conflicts de archivo (A toca pages/Driving etc., C toca components/medical). C es el más paralelizable internamente — 15 sub-tareas pequeñas.
4. Agente D en paralelo desde el inicio — NO toca código, sólo `docs/sprints/`. 60 min lineales.

Tono final: el repo está bien-arquitectónicamente; cada hallazgo es una invitación a pulir, no a reparar. Los 4 agentes pueden trabajar con confianza en buen escenario — defensive coding excesivo no es necesario.
