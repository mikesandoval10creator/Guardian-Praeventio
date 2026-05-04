# ADR-0004: Imágenes médicas hosted en servidor Praeventio (no en bundle)

**Fecha**: 2026-05-04
**Sprint**: 20 — Fase 1b
**Estado**: Aceptada
**Decisores**: Daho Sandoval (product), Claude Code (assist)
**Predecesor**: ADR-0003 (Bioicons primary, BioRender exploratorio)

---

## Contexto

Sprint 17c agregó 33 placeholders SVG en `public/icons/biology/` y un componente `MedicalIcon` con fallback graceful en 11 módulos médicos (HumanBodyViewer, AnatomyLibrary, MedicalAnalyzer, BioAnalysis, AptitudeCertificateForm, DifferentialDiagnosis, DrugInteractions, VigilanciaScheduler, AddMedicineModal, EPPVerificationModal, VisionAnalyzer). Sprint 17c también agregó el script `scripts/generate-medical-icons.mjs` para producir bocetos originales con Gemini 2.5 Flash Image (alias Nano Banana, ~$0.039 por imagen).

Sprint 20 Fase 1b (este ADR) decide cómo se entregan los 33 PNG generados al usuario final.

## Forces

1. **Bundle size**: 33 PNG × ~50KB = ~1.65MB extra si se commitean al repo y bundlean con el frontend. Aumenta el LCP en redes lentas (3G en faena minera) y degrada el target Lighthouse ≥0.90 que apunta el master plan.
2. **Costo de regeneración**: cada vez que el usuario quiera mejorar un icono (regenerar uno por estilo, agregar variantes para los 4 modos UX), tiene que rebuildear y redeployar la app entera. Friction operacional.
3. **Política de licencia BioRender**: la suite BioRender es premium. Su MCP `search-icons` retorna metadata pública (descripciones anatómicas) que es libre de usar como referencia conceptual, pero los assets gráficos requieren license premium. Necesitamos un flow donde nano-banana genere arte ORIGINAL inspirado en la nomenclatura sin copiar.
4. **Operario sin red (Brecha B)**: el caso de uso primario de Praeventio incluye operarios en faenas mineras sin señal. Si los iconos solo viven en el server, un operario offline ve placeholders en blanco. Necesitamos fallback graceful local.
5. **Reusabilidad cross-app**: futuros productos B2D del modelo Praeventio (Climate API, Hazmat API, Normativa API, Suite) podrían querer reutilizar la iconografía médica. Hostear en bucket público facilita esa expansión.

## Decisión

**Las 33 (más futuras) imágenes médicas se hostean en un bucket público de Praeventio (`gs://praeventio-public-assets/medical-icons/v1/`) y el frontend referencia URLs absolutas. El SVG placeholder local se mantiene en `public/icons/biology/` como fallback graceful para offline o degradación.**

### Flujo concreto

1. **Generación local**: el dueño del producto ejecuta:
   ```bash
   gcloud auth login
   export GEMINI_API_KEY=AIzaSy...
   node scripts/generate-medical-icons.mjs --enrich-with-bioicons --upload
   ```
   El flag `--enrich-with-bioicons` lee `scripts/biorender-references.json` (cache de descripciones canónicas BioRender) y concatena al prompt de Nano Banana como "anatomical reference (conceptual only — generate ORIGINAL artwork)". El flag `--upload` sube cada PNG con `gsutil cp` al bucket con `Cache-Control: public, max-age=31536000, immutable`.

2. **Frontend**: `iconLibrary.ts` declara `format: 'png'` para los 33 entries. La función `resolveIconUrl(entry)`:
   - Si `VITE_MEDICAL_ICONS_BASE_URL` está seteado, retorna `${base}/${entry.name}.png` (Praeventio CDN).
   - Si no, retorna el `publicPath` local SVG.
   El componente `MedicalIcon` intenta primero la URL preferida; si el `<img>` dispara `onError` (404, CORS, offline), el state local cambia y re-renderiza con el fallback SVG. Una sola network call por icono fallido.

3. **Versionado**: `medical-icons/v1/` permite re-generar todos los iconos en un nuevo prefix `v2/` sin invalidar caché ni romper deploys legacy. Cada generación se considera un release inmutable.

4. **Bucket público**: configurado con `gsutil iam ch allUsers:objectViewer gs://praeventio-public-assets`. CORS allowlist incluye dominios de producción (`praeventio.net`, `*.run.app`) más localhost para dev.

### URL pattern definitivo

```
https://storage.googleapis.com/praeventio-public-assets/medical-icons/v1/{name}.png
```

Cuando esté disponible un dominio CDN propio (futuro):
```
https://assets.praeventio.net/medical-icons/v1/{name}.png
```

El env var `VITE_MEDICAL_ICONS_BASE_URL` permite cambiar sin recompilar; basta con cambiar `.env.production` y redeployar.

## Alternativas consideradas

### A1: Commit los 33 PNG al repo, bundlear con la app
- **Pro**: simplicidad operacional. Deploy = código + assets atómico.
- **Con**: +1.65MB al bundle. LCP afectado. Re-generar requiere rebuild + redeploy de toda la app. Lighthouse perf regresiona. Inconsistente con el target ≥0.90 del master plan Fase 6.
- **Decisión**: descartada por costo de bundle y friction operacional.

### A2: Servir los PNG desde un endpoint Express del backend (Cloud Run)
- **Pro**: control fino sobre auth, headers, edge cases.
- **Con**: cada icono es un round-trip a Cloud Run. Requests aumentan. Latencia agregada vs CDN. Costo de Cloud Run innecesario para assets estáticos inmutables.
- **Decisión**: descartada — overkill para assets estáticos.

### A3: Firebase Storage (en lugar de GCS público directo)
- **Pro**: integración con Firebase Auth / Security Rules si fuera necesario.
- **Con**: assets son públicos por diseño, no necesitamos auth. Firebase Storage agrega un layer innecesario. CORS y caching son más opaque.
- **Decisión**: descartada — GCS público + CDN edge es más directo.

### A4: Copiar BioRender assets directamente
- **Pro**: producción inmediata sin generar nada.
- **Con**: viola license premium BioRender (memoria `product_medical_iconography_2026-05-04`). Bloqueador legal absoluto.
- **Decisión**: descartada — license non-negotiable.

### A5: GCS público + Cloud CDN delante
- **Pro**: latencia geográficamente óptima (POP en Sudamérica).
- **Con**: Cloud CDN agrega costo recurrente (~$0.08/GB).
- **Decisión**: postpuesto a Fase 11 (deploy hardening) si las métricas lo justifican. Por ahora GCS público sin CDN da TTFB ~150ms desde Chile, aceptable para assets de 50KB.

## Consecuencias

### Positivas
- Bundle de la app **no** crece con los 33 PNG (~1.65MB ahorro). Lighthouse perf preservado.
- Re-generar un icono = correr el script y subir, sin redeploy. Iteración 100x más rápida.
- Operario offline ve placeholder SVG inmediatamente (fallback graceful en el componente).
- Versionado limpio (`v1/`, `v2/`...) sin invalidar caché agresivamente.
- License-safe: BioRender solo aporta descripciones (metadata pública), nano-banana genera arte original.

### Negativas
- Frontend depende de conectividad para iconos de alta calidad. Mitigado por SVG local fallback. Sprint 20 Fase 1 (SLM offline) podría agregar service-worker precache opcional para precarga proactiva en wifi corporativo.
- Bucket público implica scraping potencial. Mitigación: assets son públicos no sensibles (iconos médicos genéricos), watermark futuro si fuera necesario.
- Setup inicial requiere `gcloud auth` + permisos de bucket. Documentado en el header del script.
- Env var `VITE_MEDICAL_ICONS_BASE_URL` agrega un punto de configuración. Default vacío = SVG local, así que no rompe builds existentes.

### Neutrales
- CORS del bucket debe incluir `praeventio.net`, dominios `*.run.app` y `localhost:*` para dev.
- Cache invalidation no aplica (assets inmutables por versión `v1/`); para una imagen "rota" se publica en `v1/{name}.png?cb=$timestamp` o se sube `v2/`.

## Aplicación

- `scripts/generate-medical-icons.mjs` modificado con flags `--enrich-with-bioicons`, `--upload`, `--bucket`, `--prefix`.
- `scripts/biorender-references.json` cacheado con 33 descripciones canónicas BioRender (license-safe).
- `src/services/medical/iconLibrary.ts` con campo `format` y helpers `resolveIconUrl`, `readMedicalIconsBaseUrl`.
- `src/components/medical/MedicalIcon.tsx` con state de fallback graceful sobre `onError`.
- `src/services/medical/iconLibrary.test.ts` extendido con casos de `resolveIconUrl` (env var present/absent, trailing slash).
- `.env.example` debe documentar `VITE_MEDICAL_ICONS_BASE_URL` (deferred a Fase 3 deployment hardening, ya que el bucket no existe aún en producción real).

## Verificación post-aplicación

Cuando el dueño del producto ejecute la generación + upload:

1. `npm run typecheck` clean (verificado in this PR)
2. `npm test -- iconLibrary` con los 5 nuevos casos verdes (verificado in this PR)
3. `node scripts/generate-medical-icons.mjs --enrich-with-bioicons --upload --dry-run` muestra los prompts enriquecidos
4. `node scripts/generate-medical-icons.mjs --enrich-with-bioicons --upload` genera los 33 + sube
5. `curl -I https://storage.googleapis.com/praeventio-public-assets/medical-icons/v1/lung-pair.png` retorna 200 + `Cache-Control: public, max-age=31536000, immutable`
6. Setear `VITE_MEDICAL_ICONS_BASE_URL=https://storage.googleapis.com/praeventio-public-assets/medical-icons/v1` en `.env.production`
7. Deploy a producción
8. Verificar en DevTools Network que los iconos cargan desde el bucket, no desde el bundle local
9. Forzar 404 cortando red al bucket → verificar fallback SVG funciona
