# ADR-0004: Imágenes médicas bundleadas al repo (offline-first)

**Fecha**: 2026-05-04
**Sprint**: 20 — Fase 1b
**Estado**: Aceptada
**Decisores**: Daho Sandoval (product), Claude Code (assist)
**Predecesor**: ADR-0003 (Bioicons primary, BioRender exploratorio)
**Reemplaza**: una versión previa que proponía hostear las imágenes en GCS bucket público (PR #26 cerrado sin merge — la decisión fue revertida 2026-05-04).

---

## Contexto

Sprint 17c agregó 33 placeholders SVG en `public/icons/biology/` y un componente `MedicalIcon` con fallback graceful en 11 módulos médicos (HumanBodyViewer, AnatomyLibrary, MedicalAnalyzer, BioAnalysis, AptitudeCertificateForm, DifferentialDiagnosis, DrugInteractions, VigilanciaScheduler, AddMedicineModal, EPPVerificationModal, VisionAnalyzer). También agregó el script `scripts/generate-medical-icons.mjs` para producir bocetos originales con Gemini 2.5 Flash Image (alias Nano Banana, ~$0.039 por imagen).

Sprint 20 Fase 1b (este ADR) decide cómo se entregan los 33 PNG generados al usuario final.

## Forces

1. **Offline-first es la promesa central**: Sprint 20 Fase 1 ya implementa SLM offline (Brecha B) — un Phi-3 Mini de ~600MB que corre on-device para que el operario en faena minera sin red siga consultando al asistente de seguridad. **Si la app debe hablar sin red, también debe ver sin red**: hostear los iconos en un bucket externo crea una grieta entre las dos promesas.
2. **El usuario aprobó el costo de bundle**: explícitamente dijo "subir a lo necesario para tener SLM con respecto al tamaño de la app, no hay problema". Si ~3MB del runtime SLM y ~600MB del modelo SLM (cacheado en IndexedDB en primer launch) son aceptables, los ~1.65MB de los 33 PNG médicos no mueven la aguja.
3. **Política de licencia BioRender**: la suite BioRender es premium. Su MCP `search-icons` retorna metadata pública (descripciones anatómicas) que es libre de usar como referencia conceptual, pero los assets gráficos requieren license premium. Necesitamos un flow donde nano-banana genere arte ORIGINAL inspirado en la nomenclatura sin copiar.
4. **Capacitor mobile**: la app se va a wrappear en Capacitor para Android/iOS (Brecha A — Fase 4 del master plan). En mobile, los assets bundleados son ARchivos del paquete instalado — disponibles incluso en avión. Hostear assets en CDN externa significa que el wrap mobile depende de red para iconos, que rompe la UX nativa offline esperada.
5. **Simplicidad operativa**: bundle = un solo deploy atómico. Hosted = deploy de código + upload manual de assets + configuración de env var + verificación CORS + cache invalidation. Más superficie operativa, más errores posibles.

## Decisión

**Las imágenes médicas se bundlean al repo (`public/icons/biology/*.png` commiteados) y el frontend las carga vía path relativo. Los SVG placeholders existentes se mantienen como fallback intermedio. El componente `MedicalIcon` aplica una fallback chain PNG → SVG → placeholder graceful para offline-resilience.**

### Flujo concreto

1. **Generación local**: el dueño del producto ejecuta:
   ```bash
   export GEMINI_API_KEY=AIzaSy...
   node scripts/generate-medical-icons.mjs --enrich-with-bioicons
   ```
   El flag `--enrich-with-bioicons` lee `scripts/biorender-references.json` (cache de descripciones canónicas BioRender) y concatena al prompt de Nano Banana como "anatomical reference (conceptual only — generate ORIGINAL artwork)". El script genera los 33 PNG en `public/icons/biology/{name}.png`.

2. **Commit**: el dueño commitea los PNG al repo:
   ```bash
   git add public/icons/biology/*.png
   git commit -m "feat(medical): generated 33 PNG bocetos with nano-banana"
   ```
   Bundle crece ~1.65MB (33 × ~50KB). Aceptable por la decisión force #2.

3. **Frontend** (sin cambios al usuario): el componente `MedicalIcon` computa el PNG candidate desde el `publicPath` SVG (`replace('.svg', '.png')`) y lo intenta primero. Si el PNG existe en el bundle, carga. Si no (404 — PNG no generado para ese icono específico), `onError` cambia state y re-renderiza con el SVG legacy. Si el SVG también falla, segundo `onError` cae al placeholder graceful.

4. **No hay env var, no hay upload, no hay CDN**: el `iconLibrary.ts` se mantiene tal como está (paths SVG); el componente `MedicalIcon` hace el override transparente. Cero deploy infrastructure overhead.

### Fallback chain visual

```
┌──────────┐   404    ┌──────────┐   404    ┌──────────────┐
│ PNG en   │ ───────► │ SVG en   │ ───────► │ Placeholder  │
│ bundle   │          │ bundle   │          │ teal-tinted  │
│ (rich)   │          │ (legacy) │          │ (graceful)   │
└──────────┘          └──────────┘          └──────────────┘
   ideal               siempre presente      último recurso
```

## Alternativas consideradas

### A1: Hostear los PNG en GCS bucket público + frontend lee URL absoluta
- **Pro**: bundle no crece. Re-generar sin redeploy.
- **Con**: rompe offline-first. Operario en faena sin red ve placeholders donde debería ver bocetos. Inconsistente con la promesa SLM offline.
- **Decisión**: descartada (PR #26 cerrado sin merge — esta era la propuesta inicial, revertida 2026-05-04).

### A2: Servir los PNG desde un endpoint Express del backend (Cloud Run)
- **Pro**: control fino sobre auth, headers.
- **Con**: misma falla que A1 — depende de red. Plus: cada icono = round-trip Cloud Run = latencia + costo innecesario.
- **Decisión**: descartada — overkill y rompe offline.

### A3: Service Worker pre-cache de los assets hosted
- **Pro**: balance entre A1 (sin bundle bloat) y la promesa offline (con cache pre-warmed).
- **Con**: el SW pre-cache solo funciona después del primer launch CON red. El operario que instala la app y sale a faena sin haber visto los iconos ve placeholders. Plus: complejidad de invalidación.
- **Decisión**: postpuesta como optimización futura si el bundle bloat se vuelve un problema (no es hoy con ~1.65MB).

### A4: Generar SVG en lugar de PNG con nano-banana
- **Pro**: SVG vectorial = file size menor + escalable + mejor crispness.
- **Con**: Gemini 2.5 Flash Image solo produce raster (PNG/JPEG). No tiene API para SVG generation. Convertir PNG→SVG con vectorización automática introduce artefactos.
- **Decisión**: descartada — no técnicamente viable hoy. Mantener PNG.

### A5: Copiar BioRender assets directamente
- **Pro**: producción inmediata sin generar nada.
- **Con**: viola license premium BioRender (memoria `product_medical_iconography_2026-05-04`). Bloqueador legal absoluto.
- **Decisión**: descartada — license non-negotiable.

## Consecuencias

### Positivas
- **Offline-first preservado**: la app entera (SLM + iconos + UI) funciona sin red. Coherente con Brecha B y la propuesta de valor del producto.
- **Capacitor mobile nativo**: los iconos vienen empaquetados con la APK/IPA. Cero conectividad requerida después de install.
- **Simplicidad operativa**: un solo deploy. Sin env var, sin CDN config, sin CORS allowlist, sin cache invalidation manual.
- **Versionado natural via git**: cada generación de iconos vive en un commit. Rollback trivial.
- **Re-generación incremental**: `--name X --force` regenera un icono individual; commit del PNG individual.
- **License-safe**: BioRender solo aporta descripciones (metadata pública), nano-banana genera arte original brand-aligned.

### Negativas
- **Bundle crece +1.65MB**: 33 × ~50KB. Compensado por brotli (PNG no comprime tanto pero el budget actual es `vendor-three: 349KB brotli` y mucho más; +1.65MB raw es invisible vs el delta de SLM runtime).
- **Re-generar requiere rebuild + redeploy**: cuando el usuario quiere mejorar un icono, debe volver a deploy. Mitigación: la generación es operación rara (probably 1-2 veces total durante el lifetime del producto), no continua.
- **Lighthouse perf: el primer load descarga +1.65MB extra**. Mitigación: los iconos son `<img loading="lazy">` — no contribuyen al LCP. Se descargan cuando el usuario navega a un módulo médico, no en el shell inicial.

### Neutrales
- **El componente `MedicalIcon` ahora hace fallback chain**: lógica más compleja, pero testeada (12+ tests verdes en `iconLibrary.test.ts`). Una primera carga sin PNGs hace 33 × 404 (cacheable); después del próximo deploy con PNGs, todo carga directo.
- **Los SVG placeholders se mantienen en el bundle**: nominalmente "duplicación" (SVG + PNG), pero son ~5-10KB por SVG vs ~50KB por PNG. Total adicional SVG < 200KB. Trade-off aceptable por la robustez offline.

## Aplicación

- `scripts/generate-medical-icons.mjs` modificado con flag `--enrich-with-bioicons` que lee `scripts/biorender-references.json`. **NO** incluye `--upload` (descartado por offline-first).
- `scripts/biorender-references.json` cacheado con 33 descripciones canónicas BioRender (license-safe, solo metadata pública).
- `src/components/medical/MedicalIcon.tsx` con state machine `'png' | 'svg' | 'placeholder'` y fallback chain via `onError`. Helper exportado `pngPathFor(entry)` para tests.
- `src/services/medical/iconLibrary.ts` **sin cambios** — los paths siguen siendo `.svg`, el componente computa el PNG candidate.
- `src/services/medical/iconLibrary.test.ts` extendido con 2 nuevos casos (cada entry tiene path bajo `/icons/biology/`, cada SVG path tiene basename computable a PNG candidate).

## Verificación post-aplicación

Cuando el dueño del producto ejecute la generación:

1. `npm run typecheck` clean (verificado in this PR)
2. `npm test -- iconLibrary` con los 2 nuevos casos verdes (verificado in this PR)
3. `node scripts/generate-medical-icons.mjs --enrich-with-bioicons --dry-run` muestra los prompts enriquecidos (sin gastar quota)
4. `node scripts/generate-medical-icons.mjs --enrich-with-bioicons` genera los 33 PNG en `public/icons/biology/`
5. `git add public/icons/biology/*.png && git commit -m "feat(medical): generated 33 PNG bocetos with nano-banana"`
6. `npm run build` — bundle crece ~1.65MB (PNG no listed por size-limit por ser assets estáticos no JS)
7. Post-deploy: navegar a `/anatomy` o módulo médico → DevTools Network confirma que los iconos cargan desde el bundle, NO desde un CDN externo
8. Forzar offline en DevTools → recargar → los iconos siguen visibles
9. Borrar manualmente un PNG (test del fallback) → recargar → ese icono específico muestra el SVG legacy → resto sigue PNG. Restaurar el PNG.
