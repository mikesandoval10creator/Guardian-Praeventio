#!/usr/bin/env node
/**
 * generate-medical-icons.mjs — Genera bocetos médicos originales con
 * Gemini 2.5 Flash Image (alias "Nano Banana") usando @google/genai.
 *
 * Filosofía:
 *   El conocimiento es libre. BioRender muestra el catálogo de
 *   conceptos visuales (anatomía, EPP, pharma) pero su licencia
 *   bloquea uso comercial sin Industry License. Esta herramienta
 *   genera **bocetos ORIGINALES** propios de Praeventio inspirados
 *   en la nomenclatura general de la disciplina, NO copias de
 *   ilustraciones específicas de BioRender. El estilo es coherente
 *   con BRAND.md (paleta teal/petroleum/gold) y la línea visual de
 *   la app, distinguible de cualquier proveedor.
 *
 * Uso:
 *   export GEMINI_API_KEY=AIzaSy...
 *   node scripts/generate-medical-icons.mjs                 # genera todos los faltantes
 *   node scripts/generate-medical-icons.mjs --name lung-pair # genera solo uno
 *   node scripts/generate-medical-icons.mjs --force          # regenera incluso si existe
 *   node scripts/generate-medical-icons.mjs --dry-run        # muestra prompts sin llamar API
 *
 * Output: PNG 512x512 en public/icons/biology/{name}.png
 *
 * Costos estimados (Gemini 2.5 Flash Image al 2026-05):
 *   - ~$0.039 por imagen (1024x1024)
 *   - 33 iconos del registry inicial = ~$1.30 total
 *   - Gratis hasta cierto quota mensual del free tier de Google AI Studio.
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(PROJECT_ROOT, 'public/icons/biology');
const MODEL = 'gemini-2.5-flash-image';

const STYLE_PREFIX =
  'A clean, minimalist medical illustration on transparent background. ' +
  'Single subject centered, flat 2D design, soft outline strokes 2-3px. ' +
  'Color palette: teal #4db6ac primary, deep petroleum blue #061f2d for shadows, ' +
  'subtle gold #d4af37 accents only on premium elements. ' +
  'Style inspired by occupational health iconography, but ORIGINAL artwork — ' +
  'not a copy of any specific reference. Modern flat design suitable for ' +
  'a Chilean occupational safety SaaS interface. PNG with transparent alpha. ' +
  'No text, no labels, no watermarks. Square 1:1 ratio. ';

/**
 * Manifest de iconos a generar. Cada entry mapea un nombre estable
 * (que matchea el iconLibrary.ts) a un prompt descriptivo en inglés
 * (Gemini responde mejor en inglés para image gen) que define el
 * concepto visual sin referencia a marcas.
 */
const ICON_MANIFEST = [
  // Anatomía
  { name: 'human-body-male-front', prompt: 'Anatomically simplified adult male body silhouette, anterior view, neutral T-pose, head + torso + arms + legs visible, gender-neutral musculature.' },
  { name: 'human-body-female-front', prompt: 'Anatomically simplified adult female body silhouette, anterior view, neutral T-pose, full body proportions.' },
  { name: 'spine', prompt: 'Vertebral column lateral profile, cervical to coccyx, individual vertebrae visible, slight S-curve.' },

  // Órganos
  { name: 'lung-pair', prompt: 'Pair of human lungs, anterior view, both left and right lobes visible, trachea and main bronchi at top, alveolar texture suggested.' },
  { name: 'heart-anatomical', prompt: 'Anatomical human heart with major vessels (aorta, pulmonary artery, vena cava) clearly outlined, three-quarter view, NOT a stylized valentine heart.' },
  { name: 'kidney-pair', prompt: 'Pair of kidneys with adrenal glands and renal pelvis, posterior view, ureters extending downward.' },
  { name: 'liver', prompt: 'Human liver with gallbladder visible, anterior view, lobed shape clear.' },
  { name: 'brain', prompt: 'Human brain side profile, cerebrum, cerebellum and brainstem, gyri texture suggested.' },
  { name: 'eye', prompt: 'Human eye anatomical cross-section, iris pupil sclera retina lens visible, side view.' },
  { name: 'ear', prompt: 'Human outer ear with auditory canal entry, lateral profile, helix and lobe defined.' },

  // EPP (Equipo de Protección Personal)
  { name: 'mask-n95', prompt: 'N95 respirator face mask, three-quarter view, contoured shape with elastic ear loops, exhalation valve visible.' },
  { name: 'mask-surgical', prompt: 'Surgical face mask, pleated rectangular design, ear loops, flat front view.' },
  { name: 'gloves-medical', prompt: 'Pair of nitrile medical examination gloves, palm and back visible, slightly puffed cuffs.' },
  { name: 'goggles-safety', prompt: 'Industrial safety goggles, full-coverage clear lenses, side ventilation, elastic strap.' },
  { name: 'helmet-safety', prompt: 'Hard hat construction safety helmet, side view, brim and chin strap visible, classic shape.' },
  { name: 'hearing-protection', prompt: 'Pair of industrial earmuff hearing protectors connected by adjustable headband, side view.' },
  { name: 'fall-arrest-harness', prompt: 'Full-body fall arrest safety harness with shoulder straps, leg loops and dorsal D-ring connector, front view, no human inside.' },

  // Pharma
  { name: 'pill', prompt: 'Single oblong pharmaceutical capsule, two-tone, slight 3D suggestion, isolated.' },
  { name: 'syringe', prompt: 'Medical syringe with needle, plunger half-pressed, calibrated barrel, isolated horizontal.' },
  { name: 'iv-bag', prompt: 'Intravenous fluid bag hanging with drip chamber and tubing, transparent fluid, hospital style.' },
  { name: 'first-aid-kit', prompt: 'Red first aid kit box with white cross, closed, latched, three-quarter view.' },

  // Instrumentos
  { name: 'stethoscope', prompt: 'Doctor stethoscope, binaural earpieces and chest piece, looped tubing, isolated.' },
  { name: 'spirometer', prompt: 'Handheld digital spirometer device for measuring lung function, mouthpiece on top, display visible.' },
  { name: 'audiometer', prompt: 'Audiometer headphones with cable extending to a control box, used for hearing tests.' },
  { name: 'thermometer', prompt: 'Modern digital infrared thermometer, gun-style, display screen on top.' },
  { name: 'blood-pressure-cuff', prompt: 'Sphygmomanometer blood pressure cuff with manual bulb pump and dial gauge, wrapped on imaginary arm.' },
  { name: 'pulse-oximeter', prompt: 'Fingertip pulse oximeter device with small digital display, classic clip shape.' },

  // Rehabilitación
  { name: 'wheelchair', prompt: 'Manual wheelchair, three-quarter view, frame and large rear wheel visible, no occupant.' },
  { name: 'crutch', prompt: 'Pair of underarm crutches, padded tops, parallel orientation.' },

  // Lesiones
  { name: 'arm-fracture', prompt: 'Forearm in plaster cast or sling, indication of fracture site, supporting bandages.' },
  { name: 'leg-fracture', prompt: 'Lower leg in plaster cast with crutches nearby suggested, fracture location lower tibia.' },
  { name: 'burn-skin', prompt: 'Cross-section diagram of skin showing first/second/third degree burn layers, NOT graphic, educational diagram style.' },
  { name: 'cut-wound', prompt: 'Bandaged finger with gauze and adhesive tape, simple first-aid presentation.' },
];

function parseArgs(argv) {
  const args = { name: null, force: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' && argv[i + 1]) {
      args.name = argv[++i];
    } else if (a === '--force') {
      args.force = true;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--help' || a === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(2, 22).join('\n'));
      process.exit(0);
    }
  }
  return args;
}

async function generateOne(ai, entry, args) {
  const outPath = resolve(OUTPUT_DIR, `${entry.name}.png`);
  if (!args.force && existsSync(outPath)) {
    console.log(`✓ skip   ${entry.name} (already exists; use --force to regenerate)`);
    return { skipped: true };
  }

  const prompt = STYLE_PREFIX + entry.prompt;

  if (args.dryRun) {
    console.log(`[dry-run] ${entry.name}\n  prompt: ${prompt.slice(0, 200)}...`);
    return { dryRun: true };
  }

  console.log(`→ generating ${entry.name}...`);
  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: prompt,
    });
    // Gemini 2.5 Flash Image returns parts[].inlineData with base64 PNG.
    const parts = response?.candidates?.[0]?.content?.parts ?? [];
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith('image/'));
    if (!imagePart) {
      console.error(`✗ ${entry.name}: response had no image part`);
      return { error: 'no-image-part' };
    }
    const buf = Buffer.from(imagePart.inlineData.data, 'base64');
    if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
    writeFileSync(outPath, buf);
    console.log(`✓ saved  ${entry.name}.png (${(buf.length / 1024).toFixed(1)} kB)`);
    return { saved: true, bytes: buf.length };
  } catch (err) {
    console.error(`✗ ${entry.name}: ${err?.message ?? err}`);
    return { error: String(err?.message ?? err) };
  }
}

async function main() {
  const args = parseArgs(process.argv);

  if (!process.env.GEMINI_API_KEY && !args.dryRun) {
    console.error('ERROR: GEMINI_API_KEY env var not set. Get one at https://aistudio.google.com/apikey');
    process.exit(2);
  }

  const ai = args.dryRun ? null : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const targets = args.name
    ? ICON_MANIFEST.filter((e) => e.name === args.name)
    : ICON_MANIFEST;

  if (args.name && targets.length === 0) {
    console.error(`ERROR: no icon named "${args.name}" in ICON_MANIFEST.`);
    console.error(`Available: ${ICON_MANIFEST.map((e) => e.name).join(', ')}`);
    process.exit(2);
  }

  console.log(`Generating ${targets.length} icon(s) with ${MODEL}${args.dryRun ? ' (dry-run)' : ''}...`);
  const stats = { saved: 0, skipped: 0, errors: 0, dryRun: 0 };
  for (const entry of targets) {
    const r = await generateOne(ai, entry, args);
    if (r.saved) stats.saved++;
    else if (r.skipped) stats.skipped++;
    else if (r.dryRun) stats.dryRun++;
    else stats.errors++;
    // Gentle pacing for the API (avoid burst)
    if (!args.dryRun && targets.length > 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  console.log(`\nDone. saved=${stats.saved} skipped=${stats.skipped} errors=${stats.errors} dry-run=${stats.dryRun}`);
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
