# Generación de iconos médicos originales con Gemini 2.5 Flash Image

> Filosofía Praeventio (2026-05-04, decisión Daho): "el conocimiento es gratuito
> para todos". BioRender muestra el catálogo de conceptos visuales que la
> industria de la salud ocupacional usa; nosotros generamos **bocetos
> ORIGINALES** que conviven con esa nomenclatura sin tocar las ilustraciones
> proprietarias de BioRender.

## Cómo funciona

Tres capas independientes, cada una legalmente limpia:

1. **BioRender MCP** (mi entorno Claude Code, no producción) — herramienta
   exploratoria. Puedo buscar "human body anatomy" y descubrir que existen
   1186 iconos ahí. Eso me orienta sobre qué conceptos deberían estar en
   nuestra biblioteca. **No copio los SVG**.

2. **Bioicons** (CC0/CC BY/MIT, gratis, sin licencia premium) — fallback
   inmediato. Si necesitamos un icono YA, hay una versión libre disponible.
   Sprint 17c integró 33 iconos vía `MedicalIcon` component.

3. **Generación propia con Nano Banana 2** (Gemini 2.5 Flash Image) — la
   ruta definitiva. Producimos arte ORIGINAL en nuestra paleta y estilo,
   sin riesgo legal y sin atribución obligatoria.

## Requisitos

- Node ≥ 20 (ya en CI).
- `@google/genai` ya en deps.
- API key de Google AI Studio: https://aistudio.google.com/apikey
  (gratis con quota generosa para uso personal/MVP).

## Uso

```bash
# 1. Configurar API key (una sola vez por shell)
export GEMINI_API_KEY=AIzaSy_TU_KEY_REAL

# 2. Vista previa — qué se va a generar y con qué prompts
node scripts/generate-medical-icons.mjs --dry-run

# 3. Generar uno solo (test rápido)
node scripts/generate-medical-icons.mjs --name lung-pair

# 4. Generar todos los faltantes (skip los que ya existen)
node scripts/generate-medical-icons.mjs

# 5. Regenerar uno (sobrescribir)
node scripts/generate-medical-icons.mjs --name mask-n95 --force
```

## Output

PNG 1024×1024 (downscaled para `<img loading="lazy" />`) en
`public/icons/biology/{name}.png`. Vite los sirve estático sin
runtime fetch.

`MedicalIcon` component (Sprint 17c) prefiere PNG sobre SVG cuando
existe — pero para que esto funcione hay que hacer un mini-cambio en
`iconLibrary.ts` cambiando extensión `.svg` → `.png` en cada entry, o
agregar lookup dual. Decidí dejar SVG-first en esta primera ronda y
upgradearlo a PNG solo cuando hayas generado todos los iconos.

## Costos estimados

Gemini 2.5 Flash Image al 2026-05:

- ~$0.039 por imagen 1024×1024.
- 33 iconos del manifest = **~$1.30 total** para regenerar todo.
- Free tier de Google AI Studio incluye **150 imágenes/día** sin costo.
  Para esta tanda inicial, es 100% gratis.

## Estilo y consistencia

El `STYLE_PREFIX` en el script garantiza coherencia con BRAND.md:

- Paleta teal `#4db6ac` primaria, petroleum `#061f2d` para sombras,
  gold `#d4af37` solo en elementos premium (medallas, certificados).
- Fondo transparente.
- Sin texto, sin watermarks.
- Square 1:1.
- Estilo flat 2D minimalista, NO realismo médico anatómico
  (no reemplaza un atlas; es iconografía de UI).

Si querés cambiar el estilo (ej. "más realista", "más pictográfico",
"más Wim Hof energy"), editá `STYLE_PREFIX` en el script y regenerá
con `--force`.

## Refinamiento iterativo

Gemini 2.5 Flash Image acepta inputs multimodales: si un boceto no
te convence, podés:

1. Editar manualmente `prompt` de ese icono en `ICON_MANIFEST`.
2. Regenerar con `--force --name <icon>`.
3. (Futuro) Pasar el SVG actual como reference image y pedir
   modificación incremental — agregar `--reference` flag al script
   en una iteración futura.

## Workflow recomendado

1. Daho corre el script en local con su `GEMINI_API_KEY`.
2. Revisa visualmente los 33 PNG generados.
3. Para los que no le gusten, ajusta el prompt en el manifest y
   regenera ese icono.
4. Cuando todo el set le parezca bien, commitea los PNGs +
   actualiza `iconLibrary.ts` para apuntar a `.png` en lugar de `.svg`.
5. Push → PR → merge.

## Boundary legal explícito

- Los PNGs generados son **arte original** de Praeventio, derivado
  de prompts conceptuales NEUTRALES (sin nombrar BioRender, sin pedir
  estilo específico de ningún proveedor).
- BioRender se usa **solo para mapping conceptual** en el lado dev
  (mi MCP), no para training ni sourcing visual.
- Bioicons sigue como path libre alternativo si en algún momento
  Gemini Image se vuelve costoso o cambia su licencia.

## Ver también

- ADR 0003 — Medical iconography Bioicons primary
- `src/services/medical/iconLibrary.ts` — registry compartido
- `src/components/medical/MedicalIcon.tsx` — runtime component
- BRAND.md — paleta y guías de estilo Praeventio
