# Generación manual de imágenes — 50 prompts standalone

**Sprint 20 Fase 1b — handoff al usuario**
**Fecha**: 2026-05-04
**Estado**: bloqueado por billing Gemini API → handoff a generación manual con cualquier herramienta image-gen pagada (DALL-E vía ChatGPT Plus, Midjourney, Stable Diffusion, Imagen 3/4 con billing).

**Total**: **50 prompts** = 33 iconos médicos brand-aligned (Parte A) + 17 imágenes con información valiosa (Parte B — heroes, infografías, posters, iconos extendidos).

---

## Cómo usar este documento

Cada prompt es **completamente standalone** — no necesitás leer reglas de estilo aparte ni concatenar nada. Pegá el prompt **completo** en tu herramienta y obtenés la imagen lista. La paleta brand y restricciones se repiten en cada prompt para que cada uno funcione aislado.

**Filename target** aparece encima de cada prompt. Renombrá la imagen descargada exactamente así para que el componente `MedicalIcon` la encuentre, o pasame todas por chat / dejalas en `Downloads/` y yo las renombrar y muevo al repo.

---

# PARTE A — 33 iconos médicos brand-aligned

Iconos atómicos para los 11 módulos médicos. Estilo flat 2D, paleta teal+petroleum+gold, transparent PNG 1024×1024.

---

## A.1 — `human-body-male-front.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de una silueta de cuerpo masculino adulto en vista anterior (frontal), pose neutral en T, cabeza + torso + brazos + piernas visibles, musculatura genérica esquemática anatómica, SIN rasgos faciales detallados (cabeza completamente lisa o muy esquemática). Strokes suaves de 2-3 px. Centrado, recortado al cuadrado, sujeto único bien legible. Paleta exacta: contornos primarios teal #4db6ac, sombras y outline más oscuro petroleum blue #061f2d, sin acentos gold. Fondo TRANSPARENTE (canal alfa). Sin texto, sin labels, sin números, sin watermarks, sin logos. Estilo inspirado en iconografía de salud ocupacional pero ARTE ORIGINAL — no copies obras específicas de BioRender ni Bioicons. Resolución 1024×1024 PNG.
```

---

## A.2 — `human-body-female-front.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de una silueta de cuerpo femenino adulto en vista anterior (frontal), pose neutral en T, brazos ligeramente abducidos con palmas hacia adelante, contorno típico femenino con proporciones esquemáticas (cabeza + torso + extremidades), SIN rasgos faciales detallados. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: contornos primarios teal #4db6ac, sombras y outline petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, labels, números, logos ni watermarks. Estilo iconografía clínica respetuosa profesional, NO cartoon infantil. Resolución 1024×1024 PNG, ARTE ORIGINAL no copia.
```

---

## A.3 — `spine.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de una columna vertebral humana en vista posterior, mostrando la curva característica en S con regiones cervical, torácica, lumbar, sacra y coccígea, vertebras individuales claramente visibles. Strokes suaves de 2-3 px. Sujeto único centrado, isolado del cuerpo. Paleta exacta: vertebras teal #4db6ac, separaciones intervertebrales y discos petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, etiquetas ni watermarks. Estilo educativo clínico anatómico, NO cartoon. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.4 — `lung-pair.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un par de pulmones humanos en vista anterior, ambos lóbulos izquierdo y derecho visibles, tráquea y bronquios principales en la parte superior, textura alveolar sugerida con cross-hatching ligero o puntillismo sutil. Strokes suaves de 2-3 px. Sujeto único centrado, sin cuerpo alrededor. Paleta exacta: pulmones rellenos teal #4db6ac, contornos y bronquios petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, etiquetas, logos ni watermarks. Estilo educativo respetuoso clínico, NO cartoon ni rojo carne realista. Resolución 1024×1024 PNG, ARTE ORIGINAL no copia de proveedores específicos.
```

---

## A.5 — `heart-anatomical.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un corazón humano ANATÓMICO (NO una forma estilizada de San Valentín / valentine), con grandes vasos visibles (aorta, arteria pulmonar, vena cava), vista de tres-cuartos, las cuatro cámaras (aurículas y ventrículos) sugeridas. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: corazón relleno teal #4db6ac, vasos y cámaras petroleum blue #061f2d, sin gold. Fondo TRANSPARENTE. Sin texto, números, labels, logos ni watermarks. Estilo educativo médico, profesional clínico, NO cartoon ni emoji de corazón. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.6 — `kidney-pair.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un par de riñones humanos con glándulas suprarrenales encima de cada uno, vista posterior, uréteres extendiéndose hacia abajo en dirección de la vejiga, vasos renales visibles entrando al hilio. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: riñones rellenos teal #4db6ac, suprarrenales y vasos petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, labels ni watermarks. Estilo educativo clínico respetuoso. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.7 — `liver.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un hígado humano mostrando la estructura clásica de dos lóbulos (lóbulo derecho más grande, lóbulo izquierdo más pequeño), con vesícula biliar visible debajo, vista anterior. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: hígado relleno teal #4db6ac, contorno y vesícula petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, etiquetas ni watermarks. Estilo educativo clínico, NO color carne realista. Resolución 1024×1024 PNG, ARTE ORIGINAL no copia.
```

---

## A.8 — `brain.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un cerebro humano en perfil lateral, cerebro + cerebelo + tronco encefálico distinguibles, superficie convoluta característica con patrones de surcos (sulci) y giros (gyri) visibles. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: cerebro relleno teal #4db6ac, sulci/gyri y contorno petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, labels, logos ni watermarks. Estilo educativo neurológico clínico, NO cartoon. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.9 — `eye.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un ojo humano en CORTE TRANSVERSAL anatómico (cross-section), vista lateral, mostrando iris, pupila, esclera, retina, cristalino y nervio óptico claramente etiquetados estructuralmente (sin texto). Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: iris y relleno principal teal #4db6ac, pupila y contorno petroleum blue #061f2d, acento sutil gold #d4af37 en el highlight del cristalino. Fondo TRANSPARENTE. Sin texto, etiquetas, labels ni watermarks. Estilo educativo oftalmológico clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.10 — `ear.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un oído humano en CORTE TRANSVERSAL anatómico, mostrando oído externo con conducto auditivo, oído medio con osículos (martillo, yunque, estribo) sugeridos, oído interno con cóclea y canales semicirculares visibles. Vista perfil lateral, estilo esquemático educativo. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: estructuras principales teal #4db6ac, osículos y detalles petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, etiquetas, números ni watermarks. Estilo educativo otorrinolaringología clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.11 — `mask-n95.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de una mascarilla respiradora N95, vista de tres-cuartos, diseño cónico contorneado (dome-shape) con borde curvo superior, superficie filtrante blanca, borde gris alrededor del perímetro, presillas elásticas para orejas, válvula de exhalación visible. SIN ningún rostro humano — mascarilla isolada en fondo transparente. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: cuerpo de la mascarilla blanco/gris-petroleum #061f2d para borde, válvula con acento teal #4db6ac, presillas petroleum blue. Fondo TRANSPARENTE. Sin texto, números, marcas comerciales ni watermarks. Estilo equipamiento de protección personal industrial. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.12 — `mask-surgical.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de una mascarilla quirúrgica vista frontal plana, diseño rectangular con pliegues horizontales típicos, presillas elásticas para orejas a ambos lados. SIN rostro humano — mascarilla isolada. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: cuerpo teal #4db6ac (no azul típico), pliegues y presillas petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, logos ni watermarks. Estilo equipamiento médico clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.13 — `gloves-medical.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un par de guantes de examinación médica de nitrilo, palma y dorso visibles, puños ligeramente abultados, posición lista para usar (extendidos planos). Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: guantes teal #4db6ac, contorno y arrugas petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo PPE médico-laboratorio. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.14 — `goggles-safety.png`

```
Crea una ilustración minimalista, vectorial-flat, de gafas de seguridad industrial, vista de tres-cuartos, lentes claras de cobertura completa, slots de ventilación lateral, correa elástica para la cabeza. Strokes suaves de 2-3 px. Sujeto único centrado, isolado. Paleta exacta: marco de las gafas teal #4db6ac, correa elástica petroleum blue #061f2d, acento sutil gold #d4af37 en la bisagra. Lentes con transparencia leve. Fondo TRANSPARENTE. Sin texto, marcas, números ni watermarks. Estilo PPE industrial. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.15 — `helmet-safety.png`

```
Crea una ilustración minimalista, vectorial-flat, de un casco de seguridad de construcción tipo "hard hat", vista lateral, forma de domo clásica con visera (brim) y barboquejo (chin strap) visible, sin ocupante. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: casco teal #4db6ac (no amarillo típico), barboquejo y sombra de visera petroleum blue #061f2d, pequeño acento gold #d4af37 en un punto de anclaje (e.g. clip lateral). Fondo TRANSPARENTE. Sin texto, marcas, números ni watermarks. Estilo PPE construcción/minería. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.16 — `hearing-protection.png`

```
Crea una ilustración minimalista, vectorial-flat, de un par de orejeras de protección auditiva industrial conectadas por una banda regulable, vista de tres-cuartos lateral, copas con cojines acolchados sobre las orejas. Strokes suaves de 2-3 px. Sujeto único centrado, sin cabeza humana visible. Paleta exacta: copas teal #4db6ac, banda y cojines petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo PPE industrial. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.17 — `fall-arrest-harness.png`

```
Crea una ilustración minimalista, vectorial-flat, de un arnés de seguridad de cuerpo completo para detención de caídas, con tirantes para hombros, lazos para piernas, y anillo D dorsal en la espalda. Vista frontal, sin figura humana adentro — arnés isolado mostrando la estructura de cintas. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: cintas (webbing) teal #4db6ac, hebillas y anillo D petroleum blue #061f2d, acento gold #d4af37 sutil en el anillo D dorsal (elemento crítico). Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo PPE trabajo en altura. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.18 — `pill.png`

```
Crea una ilustración minimalista, vectorial-flat, de una cápsula farmacéutica oblonga única, dos tonos (mitad superior teal #4db6ac, mitad inferior petroleum tenuemente más claro), pequeño highlight circular en la parte superior sugiriendo reflejo/brillo. Isolada, ligera sugerencia 3D mediante shading sutil. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: teal #4db6ac mitad principal, petroleum blue #061f2d para sombra y contorno. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo farmacéutico clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.19 — `syringe.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de una jeringa médica con aguja, émbolo a media presión, barril calibrado con marcas de medición, cuerpo transparente sugerido. Orientación horizontal, isolada. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: barril y émbolo teal #4db6ac, aguja y marcas de medición petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números legibles, marcas ni watermarks. Estilo equipamiento médico clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.20 — `iv-bag.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de una bolsa de suero intravenoso (IV) transparente con agujero para colgarla en la parte superior, parcialmente llena con líquido pálido teal, tubo de administración con conector saliendo por la parte inferior, cámara de goteo visible. Strokes suaves de 2-3 px. Sujeto único centrado, isolado. Paleta exacta: líquido y bolsa teal #4db6ac, tubo y conectores petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo hospitalario clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.21 — `first-aid-kit.png`

```
Crea una ilustración minimalista, vectorial-flat, de un botiquín de primeros auxilios con cruz médica blanca centrada en el frente, cerrado y con cierres, vista de tres-cuartos con asa visible en la parte superior. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: caja principal teal #4db6ac (NO el rojo típico), contorno y cierres petroleum blue #061f2d, acento gold #d4af37 sutil en los broches. Cruz blanca al centro. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo emergencia clínica. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.22 — `stethoscope.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un estetoscopio médico con diseño simplificado: pieza torácica circular (diafragma), conectada a tubería en forma de Y que se extiende hacia las olivas auriculares en la parte superior. Isolado. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: tubería y pieza torácica teal #4db6ac, olivas auriculares petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo instrumento médico clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.23 — `spirometer.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un espirómetro digital portátil para medir función pulmonar, boquilla en la parte superior, pantalla digital visible en la cara frontal mostrando un gráfico estilizado abstracto (sin números legibles). Instrumento compacto, vista de tres-cuartos. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: carcasa teal #4db6ac, pantalla y boquilla petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números legibles, marcas ni watermarks. Estilo medicina ocupacional / ISO PLANESI. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.24 — `audiometer.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de unos audífonos de audiometría (over-ear, copas grandes) con cable extendiéndose hacia una caja de control compacta, usados para tests de audición clínicos. Vista lateral. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: copas y caja de control teal #4db6ac, cable y banda craneal petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo diagnóstico audiológico clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.25 — `thermometer.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un termómetro digital infrarrojo moderno tipo "pistola" (gun-style) con forma ergonómica, pantalla LCD en la parte superior mostrando un valor de temperatura genérico estilizado (rectángulo abstracto sin números legibles), gatillo. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: cuerpo teal #4db6ac, pantalla y gatillo petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números legibles, marcas ni watermarks. Estilo instrumento médico moderno. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.26 — `blood-pressure-cuff.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un esfigmomanómetro (manguito de presión arterial) con bomba manual de pera y manómetro circular con marcas, manguito conectado al manómetro vía tubería flexible. El manguito se muestra como si estuviera enrollado en un brazo cilíndrico imaginario (sin brazo real visible). Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: manguito teal #4db6ac, manómetro y tubería petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números legibles, marcas ni watermarks. Estilo instrumento clínico cardiovascular. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.27 — `pulse-oximeter.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un oxímetro de pulso de dedo (fingertip pulse oximeter) con pequeña pantalla digital mostrando una lectura SpO2 estilizada (líneas abstractas, sin números legibles). Forma compacta de pinza con bisagra. Strokes suaves de 2-3 px. Sujeto único centrado, sin dedo dentro. Paleta exacta: carcasa teal #4db6ac, pantalla y bisagra petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números legibles, marcas ni watermarks. Estilo monitoreo clínico portátil. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.28 — `wheelchair.png`

```
Crea una ilustración minimalista, vectorial-flat, de una silla de ruedas manual, vista de tres-cuartos, marco visible, rueda trasera grande con rayos, rueda delantera pequeña tipo caster, asiento y respaldo en forma de L. Sin ocupante. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: marco y respaldo teal #4db6ac, ruedas y rayos petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo equipamiento de rehabilitación. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.29 — `crutch.png`

```
Crea una ilustración minimalista, vectorial-flat, de una muleta axilar (underarm crutch) con marco regulable, soporte acolchado para la axila en la parte superior, manubrio en el medio, punta de goma antideslizante en la base. Orientación vertical, isolada. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: parte acolchada y manubrio teal #4db6ac, marco y punta petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, marcas ni watermarks. Estilo equipamiento de rehabilitación. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.30 — `arm-fracture.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un antebrazo humano en yeso o cabestrillo con vendajes de soporte, indicando claramente el sitio de fractura. Estilo ortopédico clínico, sin rasgos faciales visibles, sin cuerpo humano completo (solo el brazo). Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: cabestrillo y yeso teal #4db6ac, contorno del brazo y detalles del vendaje petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, etiquetas ni watermarks. Estilo educativo ortopédico clínico, NO graphic. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.31 — `leg-fracture.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de una pierna inferior humana con yeso (cast) en tibia/peroné, una muleta apoyada cercana sugerida en segundo plano. Sitio de fractura sugerido en la parte baja de la pierna. Estilo clínico, isolado, sin figura humana completa adjunta (solo la pierna). Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: yeso y muleta teal #4db6ac, contorno y detalles petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, etiquetas ni watermarks. Estilo educativo ortopédico, NO graphic. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.32 — `burn-skin.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un diagrama en CORTE TRANSVERSAL de la piel humana mostrando las capas (epidermis, dermis, grasa subcutánea) con profundidades de quemadura primer/segundo/tercer grado anotadas mediante zonas más oscuras. Estilo diagrama educativo, NO graphic ni realista — clínico abstracto. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: tono principal de piel teal #4db6ac, zonas afectadas por quemadura petroleum blue #061f2d, separadores de capas con acento sutil gold #d4af37. Fondo TRANSPARENTE. Sin texto, etiquetas, números ni watermarks. Estilo dermatología educativa. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

## A.33 — `cut-wound.png`

```
Crea una ilustración médica minimalista, vectorial-flat, de un dedo humano vendado con gasa y cinta adhesiva, presentación simple de primeros auxilios, SIN sangre visible, NO graphic. Limpio y clínico, isolado. Strokes suaves de 2-3 px. Sujeto único centrado. Paleta exacta: gasa teal #4db6ac, cinta y contorno del dedo petroleum blue #061f2d. Fondo TRANSPARENTE. Sin texto, números, etiquetas ni watermarks. Estilo primeros auxilios respetuoso clínico. Resolución 1024×1024 PNG, ARTE ORIGINAL.
```

---

# PARTE B — 17 imágenes con información valiosa

Imágenes más narrativas que mezclan iconografía con contexto productivo. **Resolución mayor (1920×1080 o 1024×1024 según uso)** para que sirvan como hero banners, infografías y posters.

---

## B.1 — `hero-landing-mining-supervisor.png` (1920×1080)

```
Crea una ilustración cinemática semi-flat (más detalle que un icono pero mantenido geométrico, no foto), de un supervisor minero chileno visto de espaldas mirando al horizonte de una mina de tajo abierto al amanecer, con casco de seguridad y chaleco reflectivo. Composición rule-of-thirds: figura a la izquierda inferior, mina y horizonte ocupando 2/3 del cuadro. Cielo del amanecer con tonos teal-petroleum gradiente sutil al gold del sol naciente. Sin rasgos faciales visibles (de espaldas o silueta lateral muy esquemática). Estilo: minimalista pero atmosférico, paleta brand teal #4db6ac + petroleum blue #061f2d + acento gold #d4af37 en el sol. Sin texto, sin watermarks, sin logos. Aspect ratio 16:9. Estilo Praeventio: respetuoso, profesional, evocativo (no cartoon, no foto realista). Resolución 1920×1080 PNG. ARTE ORIGINAL — no copia de proveedores específicos.
```

---

## B.2 — `hero-cerebro-externo-network.png` (1920×1080)

```
Crea una ilustración isométrica vectorial-flat de "El Cerebro Externo" Praeventio: un laptop abierto en el centro mostrando una pantalla con una red de nodos conectados (knowledge graph estilizado tipo grafo de fuerza), nodos representan fuentes de conocimiento (libro, archivo, gráfico, documento) con líneas conectándolos. Vista isométrica 30°. Estilo flat 2D vectorial limpio. Paleta brand: nodos teal #4db6ac, conexiones petroleum blue #061f2d, nodo central destacado con acento gold #d4af37. Fondo gradiente sutil de petroleum-deep #020c12 a petroleum-mid #0a2e42. Sin texto legible (sólo formas estilizadas en la pantalla). Composición centrada. Resolución 1920×1080 PNG. ARTE ORIGINAL.
```

---

## B.3 — `hero-offline-faena-subterranea.png` (1920×1080)

```
Crea una ilustración cinemática semi-flat de un operario en una galería minera subterránea, sosteniendo un teléfono Praeventio cuya pantalla brilla con un ícono "WiFi-off" prominente y un banner que dice visualmente "Modo offline activo" (estilizado, sin texto legible — solo formas que sugieren la idea: ícono de wifi tachado + barra de notificación en color amber). Detrás del operario, paredes de la galería con vetas de mineral sugeridas, iluminación del casco. Atmosfera: aislamiento controlado por la app. Paleta brand: teal #4db6ac (pantalla del teléfono), petroleum blue #061f2d (galería), acento amber para el banner offline (color de advertencia, equivalente brand-aligned), gold #d4af37 en la lámpara del casco. Sin rasgos faciales detallados. Sin texto legible. Aspect ratio 16:9. Resolución 1920×1080 PNG. ARTE ORIGINAL.
```

---

## B.4 — `infografia-flow-infinito-3-fases.png` (1920×1080)

```
Crea una infografía horizontal minimalista flat de las 3 fases del flow del producto Praeventio, dispuestas como una secuencia con flechas estilizadas conectándolas:
Fase 1 izquierda: "Detección Predictiva" — icono de un ojo con líneas radiantes / sensor (sugiere visión anticipada).
Fase 2 centro: "Respuesta Adaptativa" — icono de engranajes interconectados o circuito que se reorganiza (sugiere adaptación).
Fase 3 derecha: "Consolidación de Conocimiento" — icono de un libro abierto con red de nodos saliendo (sugiere graph knowledge).
Cada fase tiene un círculo grande con el icono dentro, debajo el título estilizado (placeholder rectangular sin texto legible). Flechas entre fases insinuando flujo. Paleta brand: círculos en gradiente teal #4db6ac → gold #d4af37 a lo largo de la secuencia (Fase 1 más teal, Fase 3 más gold), líneas y flechas petroleum blue #061f2d. Fondo blanco o transparente. Sin texto legible — solo formas estilizadas que sugieren títulos. Resolución 1920×1080 PNG. ARTE ORIGINAL.
```

---

## B.5 — `infografia-ciclo-iper-4-pasos.png` (1024×1024)

```
Crea una infografía circular minimalista flat del ciclo IPER (Identificación, Evaluación, Control, Documentación de riesgos) en 4 pasos dispuestos en círculo con flechas curvas conectando cada paso al siguiente formando un loop continuo:
1. Norte: "Identificar" — icono de lupa.
2. Este: "Evaluar" — icono de balanza o gráfico de barras.
3. Sur: "Controlar" — icono de escudo con check.
4. Oeste: "Documentar" — icono de portapapeles con líneas.
Cada paso es un círculo con icono adentro, conectados por flechas curvas. Centro del ciclo: ícono de un trabajador con casco (sugiere "el operario es el centro"). Paleta brand: círculos teal #4db6ac, flechas petroleum blue #061f2d, centro gold #d4af37 sutil. Fondo blanco o transparente. Sin texto legible — formas estilizadas sugieren títulos. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.6 — `infografia-jerarquia-controles.png` (1024×1024)

```
Crea una infografía piramidal minimalista flat de la jerarquía de controles de seguridad ocupacional (5 niveles del más al menos efectivo, top-down):
Nivel 1 top (más efectivo): "Eliminación" — icono de tachadura sobre símbolo de peligro.
Nivel 2: "Sustitución" — icono de flechas circulares de reemplazo.
Nivel 3: "Controles ingenieriles" — icono de engranaje.
Nivel 4: "Controles administrativos" — icono de portapapeles.
Nivel 5 base (menos efectivo): "EPP" — icono de casco.
Pirámide invertida (top más ancho que base) sugiere "más efectivo arriba". Cada nivel un trapezoidal. Paleta gradiente: top teal #4db6ac (más efectivo, más brand) → fondo petroleum blue #061f2d (menos efectivo, más oscuro). Acentos gold #d4af37 sutiles en los iconos. Sin texto legible. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.7 — `infografia-sos-workflow.png` (1920×1080)

```
Crea una infografía horizontal minimalista flat del flujo SOS de Praeventio:
Paso 1 izquierda: ícono de un dedo presionando un botón rojo con timer "3 seg" estilizado.
Paso 2: ícono de ondas radiales saliendo del teléfono.
Paso 3: ícono de un broadcast a múltiples cascos cercanos (Bluetooth proximity).
Paso 4 derecha: ícono de un equipo de respuesta acudiendo (3 figuras pequeñas con cascos).
Flechas conectan cada paso. Paleta: el botón SOS en color coral / rojo brand (#b66258), broadcast y respuesta en teal #4db6ac, fondo y conectores petroleum blue #061f2d, gold #d4af37 en el equipo de respuesta (urgencia validada). Sin texto legible. Aspect ratio 16:9. Resolución 1920×1080 PNG. ARTE ORIGINAL.
```

---

## B.8 — `poster-trabajo-en-altura.png` (1024×1024)

```
Crea un póster instructivo minimalista flat sobre trabajo en altura. Composición: un trabajador silueta esquemática (sin rasgos faciales) en un andamio elevado, equipado con arnés de cuerpo completo, línea de vida conectada a un punto de anclaje fijo arriba. Anotaciones visuales (sin texto): círculos numerados marcando 5 puntos críticos: (1) casco, (2) arnés torso, (3) lazos piernas, (4) cuerda de vida, (5) punto de anclaje. Paleta brand: trabajador y arnés teal #4db6ac, andamio y anclaje petroleum blue #061f2d, círculos numerados gold #d4af37. Fondo blanco o transparente. Estilo cartilla de seguridad ACHS / ISO 45001 — respetuoso profesional. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.9 — `poster-espacio-confinado.png` (1024×1024)

```
Crea un póster instructivo minimalista flat sobre trabajo en espacio confinado. Composición: cross-section vertical de un tanque/silo cilíndrico, trabajador silueta adentro con detector de gas portátil (icono cuadrado pequeño en la mano), tubería de ventilación entrando desde arriba, atalaya silueta afuera del tanque vigilando, lectura del detector estilizada. Paleta brand: trabajador y detector teal #4db6ac, tanque y ventilación petroleum blue #061f2d, alerta atalaya gold #d4af37 sutil. Sin rasgos faciales. Sin texto. Estilo cartilla de seguridad. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.10 — `poster-hazmat-pictogramas.png` (1024×1024)

```
Crea un poster minimalista flat de pictogramas SGA (Sistema Globalmente Armonizado) de químicos peligrosos, dispuestos en grilla 3×3 (9 pictogramas). Cada pictograma en un rombo (diamante) con borde negro: (1) Llama (inflamable), (2) Calavera y huesos cruzados (toxicidad aguda), (3) Signo de exclamación (irritante), (4) Bombona explotando (explosivos), (5) Llama sobre círculo (oxidante), (6) Cilindro de gas (gases bajo presión), (7) Corrosión sobre mano (corrosivo), (8) Calavera con halo (peligro de salud crónica), (9) Pez y árbol muerto (peligroso para el medio ambiente). Paleta brand simplificada: símbolos en petroleum blue #061f2d, fondos de los rombos blanco/teal-50, bordes teal #4db6ac. Sin texto legible. Resolución 1024×1024 PNG. ARTE ORIGINAL — pictogramas inspirados en SGA estándar internacional pero rediseñados con el brand de Praeventio.
```

---

## B.11 — `poster-carga-manual-tecnica.png` (1024×1024)

```
Crea un póster comparativo minimalista flat de técnica correcta vs incorrecta de carga manual. Lado izquierdo (incorrecto): silueta de trabajador con espalda flexionada cargando una caja, X roja sobre la figura. Lado derecho (correcto): silueta de trabajador con piernas flexionadas y espalda recta cargando la misma caja, check verde sobre la figura. Línea divisoria vertical entre los dos lados. Sin rasgos faciales. Paleta brand: figuras teal #4db6ac, caja petroleum blue #061f2d, X coral #b66258 (incorrecto), check teal-darker #2e8079 (correcto), gold #d4af37 sutil en el check. Sin texto legible. Estilo ergonomía clínica respetuoso. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.12 — `extra-operador-maquinaria-pesada.png` (1024×1024)

```
Crea una ilustración minimalista flat de una silueta de operador de maquinaria pesada sentado en una excavadora o cargador frontal, con casco amarillo de seguridad, chaleco reflectivo, joystick en mano, vista lateral con la cabina del vehículo sugerida alrededor. Sin rasgos faciales. Paleta brand: operador y casco teal #4db6ac (en lugar del amarillo típico), chaleco gold #d4af37 sutil con bandas reflectivas teal claras, vehículo y cabina petroleum blue #061f2d. Sujeto único centrado. Fondo TRANSPARENTE. Sin texto, marcas, números ni watermarks. Estilo iconografía industrial minera. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.13 — `extra-supervisor-planilla.png` (1024×1024)

```
Crea una ilustración minimalista flat de una silueta esquemática de supervisor con casco de seguridad y chaleco reflectivo, sosteniendo una tablet o portapapeles, en pose de inspección (mirando el documento, vista lateral o tres-cuartos). Sin rasgos faciales. Paleta brand: supervisor y casco teal #4db6ac, tablet/portapapeles petroleum blue #061f2d, chaleco con acento gold #d4af37 (banda reflectiva). Sujeto único centrado. Fondo TRANSPARENTE. Sin texto legible en el portapapeles, sin marcas. Estilo iconografía profesional industrial. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.14 — `extra-brigadista-emergencia.png` (1024×1024)

```
Crea una ilustración minimalista flat de una silueta de brigadista de emergencia con casco rojo (variante color emergencia), chaleco reflectivo, sosteniendo un botiquín de primeros auxilios en una mano y una linterna o radio en la otra, pose alerta lateral. Sin rasgos faciales. Paleta brand modificada: casco coral #b66258 (color emergencia, brand-aligned), chaleco teal #4db6ac, botiquín petroleum blue #061f2d con cruz blanca, gold #d4af37 sutil en la radio. Sujeto único centrado. Fondo TRANSPARENTE. Sin texto, marcas ni watermarks. Estilo iconografía emergencia industrial respetuosa. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.15 — `extra-equipo-evacuacion.png` (1024×1024)

```
Crea una ilustración minimalista flat de un grupo de 4 trabajadores con cascos siguiendo a un líder con linterna en una salida de evacuación, vista de perfil lateral, flecha estilizada de dirección encima del grupo apuntando hacia adelante (sugiere movimiento ordenado). Sin rasgos faciales. Paleta brand: trabajadores y cascos teal #4db6ac, líder con linterna gold #d4af37 destacada, flecha de dirección petroleum blue #061f2d, salida sugerida con marco teal-darker. Composición horizontal con grupo centrado. Fondo TRANSPARENTE. Sin texto, marcas ni watermarks. Estilo iconografía de evacuación profesional. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

## B.16 — `extra-mina-cenital.png` (1920×1080)

```
Crea una ilustración isométrica/cenital minimalista flat de una mina de tajo abierto vista desde arriba, mostrando los anillos concéntricos de bermas (terraces escalonados), caminos en espiral descendiendo, vehículos pequeños tipo camiones de carga en algunos puntos, áreas de operación marcadas con círculos sutiles. Vista cenital 90° o ligeramente inclinada (75°). Paleta brand: bermas y caminos teal #4db6ac (más claro hacia los bordes, más oscuro al centro), vehículos petroleum blue #061f2d, áreas de operación destacadas con gold #d4af37 sutil. Sin texto, marcas, números ni watermarks. Estilo cartografía industrial limpia. Aspect ratio 16:9. Resolución 1920×1080 PNG. ARTE ORIGINAL.
```

---

## B.17 — `extra-casco-detalle-hero.png` (1024×1024)

```
Crea una ilustración semi-detallada flat de un casco de seguridad industrial visto de frente, con detalle suficiente para servir como hero icono: cintas reflectivas blancas/teal en los lados, número "001" estilizado en el frente (como ID de trabajador, sin texto legible — solo formas que sugieren números), correa de barboquejo, ranuras de ventilación. Vista frontal levemente inclinada. Paleta brand: casco teal #4db6ac, correas y cintas reflectivas teal-50 más claro, ranuras y borde petroleum blue #061f2d, ID frontal gold #d4af37 sutil. Sujeto único centrado, ligeramente más detallado que un icono atómico (este es para hero/banner uso). Fondo TRANSPARENTE. Sin texto legible, marcas ni watermarks. Estilo iconografía heroica industrial minería. Resolución 1024×1024 PNG. ARTE ORIGINAL.
```

---

# Workflow recomendado para los 50

### Estrategia A — Lote en una sesión (~3-5 horas con DALL-E 3)
1. Pegá los 33 prompts de Parte A consecutivos en ChatGPT Plus.
2. Renombrá cada PNG descargado al filename target.
3. Pegá los 17 prompts de Parte B.
4. Pasámelos por chat o dejalos en `Downloads/medical-icons/` y avisame.

### Estrategia B — Gradual (varios días)
1. 5-10 imágenes por sesión.
2. Pasámelas y yo las integro en commits parciales.
3. La app mantiene fallback chain mientras tanto.

### Naming convention final (los 50)

**Parte A — 33 iconos médicos** (van a `public/icons/biology/`):
`human-body-male-front.png`, `human-body-female-front.png`, `spine.png`, `lung-pair.png`, `heart-anatomical.png`, `kidney-pair.png`, `liver.png`, `brain.png`, `eye.png`, `ear.png`, `mask-n95.png`, `mask-surgical.png`, `gloves-medical.png`, `goggles-safety.png`, `helmet-safety.png`, `hearing-protection.png`, `fall-arrest-harness.png`, `pill.png`, `syringe.png`, `iv-bag.png`, `first-aid-kit.png`, `stethoscope.png`, `spirometer.png`, `audiometer.png`, `thermometer.png`, `blood-pressure-cuff.png`, `pulse-oximeter.png`, `wheelchair.png`, `crutch.png`, `arm-fracture.png`, `leg-fracture.png`, `burn-skin.png`, `cut-wound.png`.

**Parte B — 17 imágenes informativas** (van a `public/images/marketing/` o `public/images/posters/` según tipo):

Heroes (van a `public/images/heroes/`):
- `hero-landing-mining-supervisor.png`
- `hero-cerebro-externo-network.png`
- `hero-offline-faena-subterranea.png`

Infografías (van a `public/images/infographics/`):
- `infografia-flow-infinito-3-fases.png`
- `infografia-ciclo-iper-4-pasos.png`
- `infografia-jerarquia-controles.png`
- `infografia-sos-workflow.png`

Posters (van a `public/images/posters/`):
- `poster-trabajo-en-altura.png`
- `poster-espacio-confinado.png`
- `poster-hazmat-pictogramas.png`
- `poster-carga-manual-tecnica.png`

Iconos extendidos (van a `public/icons/extended/`):
- `extra-operador-maquinaria-pesada.png`
- `extra-supervisor-planilla.png`
- `extra-brigadista-emergencia.png`
- `extra-equipo-evacuacion.png`
- `extra-mina-cenital.png`
- `extra-casco-detalle-hero.png`

(Yo creo las carpetas necesarias y agrego las referencias al código cuando lleguen las imágenes.)

---

# Apéndices

### Por qué ChatGPT Plus / DALL-E 3 funciona bien aquí
- Respeta system prompts complejos en estilo brand-strict (mejor que Midjourney en consistencia).
- Aspect ratios 1:1 y 16:9 nativos.
- Generación incremental: revisás cada imagen y regenerás si no convence.
- $20/mes USD = mucho menos que el costo cumulativo de generar 50 con Imagen pago.

### Por qué Midjourney V6 si querés más detalle artístico
- Mejor calidad de detalle anatómico para los iconos médicos.
- Workflow `--ar 1:1 --style raw --no text logos faces --niji false`.
- Para Parte B (heroes/infografías), V6 produce composiciones más cinemáticas.
- Costo: $10/mes Basic → ~200 generaciones rápidas (alcanza para 50).

### Si una imagen no te convence
Pedile al modelo "regenerar variante con énfasis en X" — DALL-E 3 acepta refinamiento conversacional. Midjourney usá `V1`-`V4` (variations) o `U1`-`U4` (upscale).

---

*Sprint 20 Fase 1b — Generated by Claude Code as a manual handoff after free tier Gemini billing block.*
*Para las 50 imágenes: cuando tengas todas o un batch parcial, pasámelas por chat o dejalas en `Downloads/` y yo las integro al repo con commits granulares.*
