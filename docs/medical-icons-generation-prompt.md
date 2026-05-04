# Generación manual de los 33 iconos médicos — Prompt profesional

**Sprint 20 Fase 1b — handoff al usuario**
**Fecha**: 2026-05-04
**Estado**: bloqueado por billing Gemini API → handoff a generación manual con cualquier herramienta image-gen pagada (DALL-E vía ChatGPT Plus, Midjourney, Stable Diffusion, Imagen 3/4 con billing, etc.)

---

## TL;DR (qué hacer)

1. Copiá el **System prompt** (sección 2) — pegalo como instrucción de sistema en ChatGPT, Claude, o el chat de tu herramienta. Esto fija estilo, paleta y constraints para todas las imágenes.
2. Generá una imagen por icono usando los **33 prompts individuales** de la sección 4. Copiá cada prompt completo, esperá la imagen, descargala.
3. **Renombrala** con el nombre exacto del icono (ver columna "Filename" — siempre `<name>.png`).
4. Cuando tengas todas (o un batch parcial), pasámelas por chat o decime que están en `Downloads/` y yo las muevo a `D:/Guardian Praeventio/repo/public/icons/biology/` + commit + push.

---

## 1. Briefing visual (qué buscamos)

Iconos médicos minimalistas para una **PWA de prevención de riesgos ocupacionales en faena minera chilena**. Cada icono representa anatomía, EPP, instrumental, fármacos, rehabilitación o lesiones, y vive en módulos de:

- Análisis médico ocupacional (HumanBodyViewer, MedicalAnalyzer)
- Diagnóstico diferencial y vigilancia (DifferentialDiagnosis, VigilanciaScheduler)
- Verificación de EPP y exámenes preventivos (EPPVerificationModal, AptitudeCertificateForm)
- Botiquín / formularios SUSESO

Los 11 módulos médicos ya integran un componente `MedicalIcon` con fallback chain `PNG → SVG placeholder → tinted box`. Apenas estos PNG aparezcan en `public/icons/biology/`, los iconos ricos reemplazan automáticamente los placeholders.

---

## 2. System prompt (pégalo como instrucción de sistema)

```
Sos un ilustrador médico profesional especializado en iconografía operativa
para apps móviles de seguridad y salud ocupacional. Vas a generar 33 iconos
médicos individuales, una imagen por solicitud, todos siguiendo este estilo
y restricciones invariantes:

ESTILO
- Ilustración médica minimalista, vectorial-flat, contornos limpios.
- Strokes suaves de 2-3 px. Sin sombras realistas pesadas.
- Forma centrada, recortada al cuadrado, sujeto único bien legible.
- Inspirado en iconografía de salud ocupacional, pero ARTE ORIGINAL —
  no copies obras específicas de BioRender, Bioicons, ni de ningún
  otro proveedor identificable.

PALETA EXACTA (no uses otros colores)
- Primario: teal  #4db6ac  (caballito de batalla, light mode)
- Sombras / oscuros: petroleum blue  #061f2d
- Acentos sutiles (premium): gold  #d4af37
- Toques negros/grises permitidos solo donde lo exija la anatomía
- NO uses verde lima, naranja vibrante, ni magenta — fuera de paleta brand

FORMATO
- PNG con canal alfa transparente (fondo NUNCA sólido).
- Resolución cuadrada 1024×1024 (después se baja a 512 con resampling de
  alta calidad — pedís 1024 para tener margen).
- Aspect ratio 1:1.

PROHIBICIONES (no negociables)
- NO incluyas texto, labels, números, ni watermarks.
- NO incluyas logos ni marcas registradas.
- NO incluyas rostros humanos identificables (cuando aparezca un cuerpo,
  que sea silueta esquemática anatómica, sin rasgos faciales detallados).
- NO uses estilo cartoon infantil — es para profesionales de la salud
  laboral en Chile, tono respetuoso clínico.
- NO uses gradientes neon ni efectos vidrio — flat brand-aligned.

CONTEXTO REGULATORIO (subtexto para anclar autoridad visual)
- DS 594 / DS 40 (Chile)
- Ley 16.744 (accidentes del trabajo)
- ACHS / SUSESO / ISP
- ISO 45001 (gestión SST)

Cuando te pase un prompt individual, generá UNA imagen siguiendo todas
estas reglas. No expliques, no agregues comentarios — solo la imagen.
```

---

## 3. Cómo darle el system prompt a cada herramienta

### ChatGPT Plus (DALL-E 3)
1. Iniciá un nuevo chat.
2. Mensaje 1: copiá el system prompt completo.
3. ChatGPT confirmará que entendió.
4. Mensajes 2..34: cada uno con el prompt individual del icono. ChatGPT generará la imagen, click derecho → "Guardar como" → renombrá al filename objetivo.

### Midjourney
1. Convertí el system prompt en `--style` parámetros / structure-guide. Midjourney respeta texto pero los hyperparámetros importan: `--ar 1:1 --no text labels logos --style raw --niji false`.
2. Para cada icono: `<prompt individual> --ar 1:1 --style raw --no text logos faces text-overlay`.

### Stable Diffusion (local o servicio)
1. System prompt → "negative prompt" para excluir estilos no deseados:
   ```
   text, watermark, logo, brand, signature, neon, glow, glass effect,
   cartoon, infantile, photorealistic, dramatic lighting
   ```
2. Positive prompt = el system prompt + prompt individual del icono.

### Google Imagen 3/4 (con billing)
1. Pegá el system prompt como `instruction`.
2. Cada icono individual como `prompt`.

---

## 4. Los 33 prompts individuales

Cada fila tiene: nombre exacto del archivo (cómo guardarlo) y el prompt para pegar.

### Anatomía / siluetas (3)

| Filename | Prompt |
|---|---|
| `human-body-male-front.png` | Adult male body silhouette, anterior view, neutral T-pose, schematic anatomical proportions, head + torso + arms + legs visible, gender-neutral musculature, no facial features. Teal primary outline #4db6ac, petroleum shadows #061f2d, transparent PNG. |
| `human-body-female-front.png` | Adult female body silhouette, anterior view, neutral T-pose, full body proportions, schematic outline, no facial features. Teal primary #4db6ac, petroleum shadows #061f2d, transparent PNG. |
| `spine.png` | Human vertebral column, posterior view, characteristic S-curve with cervical, thoracic, lumbar, sacral and coccygeal regions, individual vertebrae visible. Teal #4db6ac main strokes, petroleum #061f2d shadows. Transparent PNG, anatomical educational style. |

### Órganos (7)

| Filename | Prompt |
|---|---|
| `lung-pair.png` | Pair of human lungs, anterior view, both left and right lobes visible, trachea and main bronchi at top, alveolar texture suggested by light cross-hatching. Teal #4db6ac fill, petroleum #061f2d outline, no human body around. Transparent PNG. |
| `heart-anatomical.png` | Anatomical human heart with major vessels (aorta, pulmonary artery, vena cava) clearly outlined, three-quarter view, four chambers suggested. NOT a stylized valentine heart shape. Teal #4db6ac primary, petroleum #061f2d for vessels and chambers. Transparent PNG. |
| `kidney-pair.png` | Pair of kidneys with adrenal glands above each, posterior view, ureters extending downward toward bladder, renal vessels visible at the hilum. Teal #4db6ac main shape, petroleum #061f2d details. Transparent PNG. |
| `liver.png` | Human liver showing classic two-lobed structure (larger right lobe, smaller left lobe), with gallbladder visible underneath, anterior view. Teal #4db6ac body, petroleum #061f2d outline and gallbladder. Transparent PNG. |
| `brain.png` | Human brain side profile, cerebrum + cerebellum + brainstem distinguishable, characteristic convoluted surface with sulci and gyri patterns. Teal #4db6ac fill, petroleum #061f2d strokes for gyri. Transparent PNG. |
| `eye.png` | Human eye anatomical cross-section, side view, iris pupil sclera retina lens optic nerve clearly visible. Teal #4db6ac iris and main fill, petroleum #061f2d for pupil and outline, gold #d4af37 subtle accent on lens highlight. Transparent PNG. |
| `ear.png` | Human ear cross-section, external ear with auditory canal entry, middle ear with ossicles, inner ear with cochlea and semicircular canals. Lateral profile, schematic educational. Teal #4db6ac primary, petroleum #061f2d details. Transparent PNG. |

### EPP (Equipo de Protección Personal) (7)

| Filename | Prompt |
|---|---|
| `mask-n95.png` | N95 respirator face mask, three-quarter view, dome-shaped contoured design, white filtering surface with petroleum gray border, elastic ear loops, exhalation valve visible. No human face — mask isolated on transparent background. Teal #4db6ac for valve accent, petroleum #061f2d for borders. Transparent PNG. |
| `mask-surgical.png` | Surgical face mask, front view, pleated rectangular design with horizontal folds, elastic ear loops on both sides. No human face — mask isolated. Teal #4db6ac fill, petroleum #061f2d pleats and ear loops. Transparent PNG. |
| `gloves-medical.png` | Pair of nitrile medical examination gloves, palm and back visible, slightly puffed cuffs, ready to wear position. Teal #4db6ac gloves, petroleum #061f2d outline. Transparent PNG. |
| `goggles-safety.png` | Industrial safety goggles, three-quarter view, full-coverage clear lenses, side ventilation slots, elastic head strap. Teal #4db6ac frame, petroleum #061f2d strap, slight gold #d4af37 accent on hinge. Transparent PNG. |
| `helmet-safety.png` | Construction safety hard hat, side view, classic dome shape with brim and chin strap visible, no occupant. Teal #4db6ac primary helmet color, petroleum #061f2d strap and brim shadow, gold #d4af37 small accent (e.g. anchor point). Transparent PNG. |
| `hearing-protection.png` | Pair of industrial earmuff hearing protectors connected by adjustable headband, side three-quarter view, cup-shaped ear cushions. Teal #4db6ac cups, petroleum #061f2d headband. Transparent PNG. |
| `fall-arrest-harness.png` | Full-body fall arrest safety harness with shoulder straps, leg loops, and dorsal D-ring connector at the back. Front view, no human figure inside, harness isolated. Teal #4db6ac webbing, petroleum #061f2d buckles, gold #d4af37 D-ring. Transparent PNG. |

### Pharma (4)

| Filename | Prompt |
|---|---|
| `pill.png` | Single oblong pharmaceutical capsule, two-tone (teal #4db6ac top half, petroleum-tinted #061f2d/lighter bottom half), small circular highlight at upper portion suggesting reflection. Isolated, slight 3D suggestion via subtle shading. Transparent PNG. |
| `syringe.png` | Medical syringe with needle, plunger half-pressed, calibrated barrel with measurement markings, transparent body suggested. Horizontal orientation, isolated. Teal #4db6ac for barrel/plunger, petroleum #061f2d for needle and markings. Transparent PNG. |
| `iv-bag.png` | Transparent IV intravenous fluid bag with hanging hole at the top, partially filled with pale teal liquid, delivery tube with connector extending downward, drip chamber visible. Teal #4db6ac fluid, petroleum #061f2d tubing and connector. Transparent PNG. |
| `first-aid-kit.png` | First aid kit box with white medical cross centered on the front, closed and latched, three-quarter view with handle visible on top. Teal #4db6ac main box color (instead of typical red), petroleum #061f2d outline, gold #d4af37 latch accents. Transparent PNG. |

### Instrumentos (6)

| Filename | Prompt |
|---|---|
| `stethoscope.png` | Medical stethoscope, simplified design, circular chest piece (diaphragm) connected to Y-shaped tubing extending to binaural earpieces at top. Isolated. Teal #4db6ac tubing and chest piece, petroleum #061f2d earpieces. Transparent PNG. |
| `spirometer.png` | Handheld digital spirometer device for measuring lung function, mouthpiece on top, digital display visible on the front face. Compact medical instrument, three-quarter view. Teal #4db6ac housing, petroleum #061f2d display and mouthpiece. Transparent PNG. |
| `audiometer.png` | Audiometer headphones (large over-ear cups) with cable extending to a small control box, used for hearing tests. Side view. Teal #4db6ac cups and control box, petroleum #061f2d cable and headband. Transparent PNG. |
| `thermometer.png` | Modern digital infrared thermometer, gun-style ergonomic shape with display screen on top showing a generic temperature value (no readable text — just a stylized rectangle), trigger handle. Teal #4db6ac body, petroleum #061f2d screen and trigger. Transparent PNG. |
| `blood-pressure-cuff.png` | Sphygmomanometer blood pressure cuff with manual bulb pump and circular dial gauge, navy/teal cuff connected to gauge via flexible tubing. Cuff shown as if wrapped around an imaginary cylindrical arm (no actual arm). Teal #4db6ac cuff, petroleum #061f2d gauge and tubing. Transparent PNG. |
| `pulse-oximeter.png` | Fingertip pulse oximeter device with small digital display showing a stylized SpO2 reading (no readable numbers — just abstract lines). Compact clip shape with hinged design. Teal #4db6ac housing, petroleum #061f2d display and hinge. Transparent PNG. |

### Rehabilitación (2)

| Filename | Prompt |
|---|---|
| `wheelchair.png` | Manual wheelchair, three-quarter view, frame and large rear wheel with spokes visible, smaller front caster wheel, seat and L-shaped backrest. No occupant. Teal #4db6ac frame, petroleum #061f2d wheels and spokes. Transparent PNG. |
| `crutch.png` | Single underarm crutch with adjustable frame, padded top support for the axilla, handgrip in the middle, non-slip rubber tip at the bottom. Vertical orientation, isolated. Teal #4db6ac padded top and grip, petroleum #061f2d frame and tip. Transparent PNG. |

### Lesiones (4)

| Filename | Prompt |
|---|---|
| `arm-fracture.png` | Forearm or arm in plaster cast or sling with supporting bandages, indicating fracture site clearly. Clinical orthopedic illustration style, no facial features. Teal #4db6ac sling/cast, petroleum #061f2d outline of arm and bandage details. Transparent PNG. |
| `leg-fracture.png` | Lower leg with plaster cast on tibia/fibula, optional crutch leaning nearby. Fracture location at lower leg suggested. Clinical illustration, isolated, no human figure attached. Teal #4db6ac cast, petroleum #061f2d outline. Transparent PNG. |
| `burn-skin.png` | Cross-section diagram of human skin showing the layers (epidermis, dermis, subcutaneous fat) with first/second/third degree burn depths annotated by darker zones. Educational diagram style, NOT graphic — abstracted clinical illustration. Teal #4db6ac main skin tone, petroleum #061f2d for burn-affected zones, gold #d4af37 minor accent on layer separators. Transparent PNG. |
| `cut-wound.png` | Bandaged finger or wound site with gauze wrap and adhesive tape, simple first-aid presentation. Clean and clinical, no blood visible, not graphic. Teal #4db6ac gauze, petroleum #061f2d tape and finger outline. Transparent PNG. |

---

## 5. Naming convention (importante)

Cada PNG **DEBE** llamarse exactamente como aparece en la columna "Filename":

```
human-body-male-front.png
human-body-female-front.png
spine.png
lung-pair.png
heart-anatomical.png
kidney-pair.png
liver.png
brain.png
eye.png
ear.png
mask-n95.png
mask-surgical.png
gloves-medical.png
goggles-safety.png
helmet-safety.png
hearing-protection.png
fall-arrest-harness.png
pill.png
syringe.png
iv-bag.png
first-aid-kit.png
stethoscope.png
spirometer.png
audiometer.png
thermometer.png
blood-pressure-cuff.png
pulse-oximeter.png
wheelchair.png
crutch.png
arm-fracture.png
leg-fracture.png
burn-skin.png
cut-wound.png
```

El componente `MedicalIcon` busca exactamente estos nombres. Cualquier diferencia (mayúsculas, espacios, guiones bajos) → fallback al SVG placeholder.

---

## 6. Workflow recomendado

### Opción rápida (lote)
1. Pegá el **system prompt** en ChatGPT Plus / Midjourney / etc.
2. Generá los 33 en una sesión continua (~2 horas con DALL-E 3, ~1 hora con Midjourney V6 si tenés generación rápida).
3. Renombrá cada uno al `filename` correspondiente.
4. Movelos a una carpeta `Downloads/medical-icons/` o pasámelos por chat.
5. Avisame y los integro al repo:
   ```bash
   mv ~/Downloads/medical-icons/*.png "D:/Guardian Praeventio/repo/public/icons/biology/"
   git add public/icons/biology/*.png
   git commit -m "feat(medical): generated 33 PNG bocetos via manual generation (Sprint 20 Fase 1b cierre)"
   git push
   ```

### Opción gradual (varios días)
1. Generá 5-10 por sesión.
2. Pasámelos / decime que están en Downloads.
3. Yo los integro en commits parciales (no esperamos los 33).
4. El fallback chain ya cubre los faltantes con SVG.

---

## 7. Validación final (cuando estén integrados)

Después de mover los 33 PNGs:
- `npm run typecheck` — debe seguir clean.
- `npm test` — sin regresiones.
- `npm run build` — bundle crece ~1.65MB (33 × ~50KB), aceptable (decisión del usuario en ADR-0004).
- Smoke test visual: navegar a `/anatomy`, `/medical-analyzer`, `/diagnosis-differential` y confirmar que `data-medical-icon-stage="png"` aparece en el DOM (DevTools).

---

## 8. Si querés delegar la generación a una herramienta tipo agente

Como prompt completo único para una herramienta tipo Claude Sonnet con Imagen API o GPT-4 con DALL-E:

```
Actúa como ilustrador médico profesional. Generá 33 iconos siguiendo el
system prompt de la sección 2 de docs/medical-icons-generation-prompt.md
del repo Guardian Praeventio. Las descripciones individuales y filenames
están en la sección 4 del mismo doc. Devolvé los 33 PNGs en una carpeta
zip o como adjuntos individuales.
```

---

## Apéndice — Por qué ChatGPT Plus / DALL-E 3 funciona bien

- DALL-E 3 respeta system prompts complejos mejor que Midjourney en estilo brand-strict.
- Aspect ratio 1:1 nativo, transparente vía `--no background` o "transparent PNG" en el prompt.
- ChatGPT Plus = $20/mes USD = mucho menos que el costo cumulativo de generar 33 con Imagen pago.
- Generación incremental: revisás cada uno y regenerás si no te convence.

## Apéndice — Si querés probar con Stable Diffusion local

- Modelo recomendado: SDXL 1.0 con Refiner.
- LoRA opcional: `medical-illustration` o `flat-design-vector`.
- VRAM necesaria: 8-12 GB.
- Tiempo por imagen: 15-30s en RTX 3060.
- Comando ComfyUI / A1111: aspect 1:1, steps 30-40, CFG 7-8, sampler DPM++ 2M Karras.

---

*Generado por Claude Code en Sprint 20 Fase 1b — handoff manual debido a billing bloqueado en Gemini API free tier.*
