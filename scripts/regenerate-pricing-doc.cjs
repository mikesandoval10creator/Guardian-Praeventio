#!/usr/bin/env node
/* eslint-disable */
/**
 * regenerate-pricing-doc.cjs
 *
 * Regenera `PRICING.md` desde la fuente única de verdad
 * `src/services/pricing/tiers.ts`. Evita drift entre el código y la
 * documentación cuando se cambian precios, capacidades o nombres de tiers.
 *
 * Uso:
 *   node scripts/regenerate-pricing-doc.cjs                 # escribe PRICING.md
 *   node scripts/regenerate-pricing-doc.cjs --check        # exit 1 si hay drift
 *   node scripts/regenerate-pricing-doc.cjs --stdout       # imprime sin tocar
 *
 * La fuente de verdad es el módulo compilado, pero como tiers.ts es ESM con
 * TypeScript, este script parsea el archivo directamente con regex robustos.
 * Si tiers.ts cambia de forma estructural, este script debe actualizarse.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TIERS_FILE = path.join(ROOT, 'src/services/pricing/tiers.ts');
const OUT_FILE = path.join(ROOT, 'PRICING.md');

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const STDOUT_ONLY = args.has('--stdout');

// ─────────────────────────────────────────────────────────────────────────────
// Parser: extrae bloques { id, nombre, trabajadoresMax, proyectosMax,
//   clpRegular, clpIntro3mo, clpAnual, usdRegular, workspaceTier,
//   trabajadorExtraClp?, proyectoExtraClp?, jurisdictionsMax?, dataResidency?,
//   multiJurisdiction? } del array TIERS en tiers.ts
// ─────────────────────────────────────────────────────────────────────────────

function parseTiers(src) {
  // El array TIERS está entre `export const TIERS: readonly Tier[] = [` y el `];` final
  const start = src.indexOf('export const TIERS:');
  if (start === -1) throw new Error('No se encontró `export const TIERS` en tiers.ts');
  const arrayStart = src.indexOf('[', start);
  const arrayEnd = src.indexOf('\n];', arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) {
    throw new Error('No se pudo localizar el array TIERS');
  }
  const body = src.slice(arrayStart, arrayEnd);

  // Cada tier es un bloque {...} con `id: '...',` como primera propiedad.
  // Dividimos por `\n    id: '` al inicio de una línea indentada (cada tier
  // empieza con su id a 4 espacios de indentación). Comentarios `//`
  // entre tiers pueden preceder al `{`, pero el `id:` indentado es único
  // de cada objeto tier.
  const tierChunks = body.split(/\n    id:\s*'/).slice(1);

  return tierChunks.map((chunk) => {
    const idMatch = chunk.match(/^([^']+)'/);
    if (!idMatch) throw new Error('No se pudo extraer id de un chunk de tier');
    const id = idMatch[1];

    const get = (key) => {
      const re = new RegExp(`\\b${key}:\\s*([^,\\n]+)`);
      const m = chunk.match(re);
      if (!m) return undefined;
      const raw = m[1].trim();
      if (raw === 'Infinity') return 'Infinity';
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
      // string con comillas simples
      const sm = raw.match(/^'([^']*)'$/);
      if (sm) return sm[1];
      return raw;
    };

    return {
      id,
      nombre: get('nombre'),
      trabajadoresMax: get('trabajadoresMax'),
      proyectosMax: get('proyectosMax'),
      clpRegular: get('clpRegular'),
      clpIntro3mo: get('clpIntro3mo'),
      clpAnual: get('clpAnual'),
      usdRegular: get('usdRegular'),
      workspaceTier: get('workspaceTier'),
      trabajadorExtraClp: get('trabajadorExtraClp'),
      proyectoExtraClp: get('proyectoExtraClp'),
      jurisdictionsMax: get('jurisdictionsMax'),
      dataResidency: get('dataResidency'),
      multiJurisdiction: get('multiJurisdiction'),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmtCLP = (n) => {
  if (n === 0) return '$0';
  return '$' + new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 }).format(n);
};

const fmtUSD = (n) => {
  if (n === 0) return '$0';
  return '$' + new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
};

const fmtMax = (n) => (n === 'Infinity' ? '∞' : String(n));

const workspaceLabel = (w) => {
  const map = {
    none: '—',
    'sso-basic': 'SSO básico',
    'sso-casa': 'SSO + CASA',
    'multi-tenant': 'Multi-tenant',
    'multi-tenant-csm': 'Multi-tenant + CSM',
    'vertex-finetuned': 'Vertex fine-tuned',
  };
  return map[w] || String(w);
};

// ─────────────────────────────────────────────────────────────────────────────
// Generador de markdown
// ─────────────────────────────────────────────────────────────────────────────

function generateMarkdown(tiers) {
  const today = new Date().toISOString().slice(0, 10);
  const numTiers = tiers.length;

  const tableRows = tiers
    .map((t, i) => {
      const num = i + 1;
      return `| ${num} | ${t.nombre} | ${fmtMax(t.trabajadoresMax)} | ${fmtMax(t.proyectosMax)} | ${fmtCLP(t.clpRegular)} | ${fmtCLP(t.clpIntro3mo)} | ${fmtCLP(t.clpAnual)} | ${fmtUSD(t.usdRegular)} | ${workspaceLabel(t.workspaceTier)} |`;
    })
    .join('\n');

  const overageRows = tiers
    .filter((t) => t.trabajadorExtraClp !== undefined && t.proyectoExtraClp !== undefined)
    .map((t) => `| ${t.nombre} | ${fmtCLP(t.trabajadorExtraClp)} | ${fmtCLP(t.proyectoExtraClp)} |`)
    .join('\n');

  const overageNames = tiers
    .filter((t) => t.trabajadorExtraClp !== undefined && t.proyectoExtraClp !== undefined)
    .map((t) => t.nombre)
    .join(', ');

  const premiumNames = tiers
    .filter((t) => !t.trabajadorExtraClp)
    .map((t) => t.nombre)
    .join(', ');

  const dataResidencyRows = tiers
    .filter((t) => t.dataResidency || t.jurisdictionsMax !== undefined || t.multiJurisdiction)
    .map((t) => {
      const jur = t.jurisdictionsMax === 'Infinity' ? '∞' : (t.jurisdictionsMax ?? '—');
      const res = t.dataResidency === 'multi' ? 'Multi-jurisdicción' : (t.dataResidency === 'latam' ? 'LATAM' : '—');
      const multi = t.multiJurisdiction ? '✅' : '—';
      return `| ${t.nombre} | ${jur} | ${res} | ${multi} |`;
    })
    .join('\n');

  return `# Praeventio Guard — Política de Precios

> **Filosofía:** la prevención de salvaguarda de vida es **siempre gratis**. Nunca un protocolo de evacuación, alerta de emergencia, ni botón de SOS estará detrás de un muro de pago. **Multi-país sin recargo:** opera en cualquier jurisdicción sin costo extra; ISO 45001 funciona como fallback global cuando GPS detecta un país sin pack normativo local.

> **Fuente única de verdad:** este documento se regenera automáticamente desde \`src/services/pricing/tiers.ts\`. Para actualizar precios, modifica el array \`TIERS\` y ejecuta \`npm run pricing:doc\`. La última regeneración aparece en el footer.

---

## 1. Lógica dual: capacidad vs cumplimiento

Praeventio cobra en dos dimensiones independientes:

| Dimensión          | Qué mide                            | Cómo se cobra                |
|--------------------|-------------------------------------|------------------------------|
| **Capacidad**      | Trabajadores totales + proyectos    | Define el **tier** (${numTiers} disponibles) |
| **Cumplimiento**   | Normativa local por proyecto/faena  | Pack opcional **per-project**|

El tier se elige por capacidad. Los packs normativos (DS 54, DS 44/2024, NIOSH, ISO 45001…) se contratan por proyecto y se acumulan sin afectar el tier.

## 2. Los tiers (vigentes)

| # | Tier | Trabajadores | Proyectos | CLP/mes regular | CLP intro 3m | CLP anual | USD/mes | Workspace |
|---|---|---|---|---|---|---|---|---|
${tableRows}

> **Anual = clpRegular × 9** (≈25% off, "ahorra 3 meses"). **Intro 3 meses** = descuento sobre el primer trimestre.

Todos los tiers incluyen:
- Calendar predictions completas (sin caps).
- Multi-país ilimitado.
- ISO 45001 fallback universal cuando GPS detecta un país sin pack local.
- Zettelkasten (RAG normativo).
- Toda función vida-safety (ADR 0021 — nunca tier-gated).

## 3. Tabla de overage (tiers con capacidad flexible)

Sólo los tiers **${overageNames}** permiten overage. Los premium (**${premiumNames}**) **no** tienen overage — propuesta predecible, hard upgrade si excedes.

| Tier | Trabajador extra (CLP) | Proyecto extra (CLP) |
|---|---|---|
${overageRows || '| (ninguno) | — | — |'}

**Regla sugerencia upgrade:** si tu overage mensual supera el delta al siguiente tier, el sistema te recomienda subir. Implementado en \`suggestUpgrade()\` en \`src/services/pricing/tiers.ts\`.

## 4. Workspace Native (premium en adelante)

| Workspace | Lo que incluye |
|---|---|
| \`sso-basic\` | SSO (SAML/OIDC) básico · CSM dedicado · SLA 99.5% · onboarding en sitio |
| \`sso-casa\` | Todo \`sso-basic\` + CASA Tier · auditoría seguridad anual · API privada · soporte 24/7 |
| \`multi-tenant\` | Multi-tenant nativo · multi-RUT · integraciones SAP/Oracle · data residency CL |
| \`multi-tenant-csm\` | Todo \`multi-tenant\` + CSM dedicado · roadmap influence cuarterly · pen-testing |
| \`vertex-finetuned\` | Modelo Vertex AI fine-tuned propio · despliegue privado opcional · NIST/SOC2 ad-hoc |

${dataResidencyRows ? `## 5. Residencia de datos y multi-jurisdicción

| Tier | Jurisdicciones simultáneas | Residencia | Multi-jurisdicción |
|---|---|---|---|
${dataResidencyRows}

` : ''}## ${dataResidencyRows ? '6' : '5'}. Roadmap LATAM + ISO 45001

Praeventio nace cubriendo Chile (DS 54, DS 44/2024, Ley 16.744, SUSESO). El roadmap LATAM agrega packs locales sin costo extra para tiers vigentes:

- **Q2 2026:** Perú (DS 005-2012-TR), Colombia (Decreto 1072 / SG-SST).
- **Q3 2026:** México (NOM-035, NOM-019), Argentina (Ley 19.587, Res. 295/03).
- **Q4 2026:** Brasil (NR-1, NR-7, NR-9), Ecuador.
- **2027+:** España (LPRL 31/1995), resto LATAM, OSHA US.

Mientras tanto: **ISO 45001 es el fallback global**. Cualquier país sin pack local activa automáticamente la matriz ISO 45001, garantizando un piso normativo internacional reconocible.

## ${dataResidencyRows ? '7' : '6'}. Cómo cobramos (transparencia radical)

La página \`/transparencia\` documenta:
- El **bucket 2D** (trabajadores × proyectos) con diagrama interactivo.
- Tabla de overage con ejemplos.
- Tabla "cuándo conviene upgradear (y cuándo NO)".
- Comparación con alternativas reales: prevencionista part-time CL ($400k–700k CLP), SafetyCulture (~$120 USD), multas SUSESO ($1–25M CLP), accidente grave (~$50M CLP).
- Calculadora interactiva consumiendo \`calculateMonthlyCost()\` desde \`tiers.ts\` (single source of truth).

Ruta: \`/transparencia\` → \`./src/pages/Transparencia.tsx\`.

## ${dataResidencyRows ? '8' : '7'}. Facturación y datos legales

- **Moneda dual:** CLP (default Chile, geo-detectado) o USD (override manual persistente en \`localStorage\`).
- **IVA 19% incluido** en precios CLP retail. Boleta/factura electrónica chilena.
- **RUT emisor:** 78231119-0 (Praeventio Guard SpA).
- **Helper de IVA:** \`withIVA(subtotal)\` en \`tiers.ts\` retorna \`{subtotal, iva, total}\` con redondeo techo para mantener coherencia con la cifra \`.990\` mostrada al usuario.
- **Pagos consumer (gratis → Oro):** Google Play Billing en app nativa Android.
- **Pagos B2B (Titanio+):** Transbank/Webpay (CL web), Khipu (CL web alternativa), Google Play Billing (Android), transferencia + factura. CTA "Hablar con ventas" abre flujo manual hasta integración.
- **iOS:** diferido hasta primer cliente iOS confirmado y pago de fee Apple Developer ($100/año). Mientras tanto la web app PWA cubre iOS.
- **Sin Stripe:** Praeventio opera 100% sobre pasarelas locales/regionales (Transbank, Khipu, Google Play). Esta decisión es definitiva — no se reintroduce Stripe.
- **Cancelación:** mensual sin penalidad. Anual: prorrateo de meses no usados al cancelar.

## ${dataResidencyRows ? '9' : '8'}. Filosofía de venta

> *La seguridad no es un gasto, es una inversión en vida.*

Ninguna funcionalidad crítica de vida o muerte (evacuación, SOS, alertas climáticas extremas) está detrás de muro de pago. **Cualquier persona, en cualquier país, en cualquier momento, accede gratis al mínimo vital.** El modelo de pago financia herramientas de IA, integración empresarial y compliance avanzado para profesionales que las necesitan.

---

<sub>Última regeneración automática: ${today} · comando: \`npm run pricing:doc\` · fuente: \`src/services/pricing/tiers.ts\`</sub>
`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(TIERS_FILE)) {
    console.error(`❌ No se encontró ${TIERS_FILE}`);
    process.exit(2);
  }

  const src = fs.readFileSync(TIERS_FILE, 'utf8');
  const tiers = parseTiers(src);

  if (tiers.length === 0) {
    console.error('❌ Parser no devolvió tiers. Revisar regex contra tiers.ts');
    process.exit(2);
  }

  const md = generateMarkdown(tiers);

  if (STDOUT_ONLY) {
    process.stdout.write(md);
    return;
  }

  if (CHECK_ONLY) {
    if (!fs.existsSync(OUT_FILE)) {
      console.error(`❌ ${OUT_FILE} no existe. Ejecuta sin --check para crearlo.`);
      process.exit(1);
    }
    const current = fs.readFileSync(OUT_FILE, 'utf8');
    if (current === md) {
      console.log('✅ PRICING.md está sincronizado con tiers.ts');
      process.exit(0);
    }
    console.error('❌ Drift detectado entre PRICING.md y tiers.ts.');
    console.error('   Regenera con: npm run pricing:doc');
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, md, 'utf8');
  console.log(`✅ PRICING.md regenerado (${tiers.length} tiers, ${md.length} bytes)`);
}

main();