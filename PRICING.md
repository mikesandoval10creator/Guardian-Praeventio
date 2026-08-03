# Praeventio Guard — Política de Precios

> **Filosofía:** la prevención de salvaguarda de vida es **siempre gratis**. Nunca un protocolo de evacuación, alerta de emergencia, ni botón de SOS estará detrás de un muro de pago. **Multi-país sin recargo:** opera en cualquier jurisdicción sin costo extra; ISO 45001 funciona como fallback global cuando GPS detecta un país sin pack normativo local.

> **Fuente única de verdad:** este documento se regenera automáticamente desde `src/services/pricing/tiers.ts`. Para actualizar precios, modifica el array `TIERS` y ejecuta `npm run pricing:doc`. La última regeneración aparece en el footer.

---

## 1. Lógica dual: capacidad vs cumplimiento

Praeventio cobra en dos dimensiones independientes:

| Dimensión          | Qué mide                            | Cómo se cobra                |
|--------------------|-------------------------------------|------------------------------|
| **Capacidad**      | Trabajadores totales + proyectos    | Define el **tier** (7 disponibles) |
| **Cumplimiento**   | Normativa local por proyecto/faena  | Pack opcional **per-project**|

El tier se elige por capacidad. Los packs normativos (DS 54, DS 44/2024, NIOSH, ISO 45001…) se contratan por proyecto y se acumulan sin afectar el tier.

## 2. Los tiers (vigentes)

| # | Tier | Trabajadores | Proyectos | CLP/mes regular | CLP intro 3m | CLP anual | USD/mes | Workspace |
|---|---|---|---|---|---|---|---|---|
| 1 | Gratis | 3 | 1 | $0 | $0 | $0 | $0 | — |
| 2 | Cobre | 24 | 3 | $9.990 | $6.990 | $89.910 | $11 | — |
| 3 | Plata | 99 | 5 | $19.990 | $13.990 | $179.910 | $22 | — |
| 4 | Oro | 499 | 10 | $79.990 | $55.990 | $719.910 | $88 | — |
| 5 | Titanio | 1999 | 20 | $249.990 | $174.990 | $2.249.910 | $270 | SSO básico |
| 6 | Platino | 9999 | 30 | $899.990 | $629.990 | $8.099.910 | $970 | Multi-tenant + CSM |
| 7 | Diamante | ∞ | 50 | $3.900.000 | $2.730.000 | $35.100.000 | $4,200 | Vertex fine-tuned |

> **Anual = clpRegular × 9** (≈25% off, "ahorra 3 meses"). **Intro 3 meses** = descuento sobre el primer trimestre.

Todos los tiers incluyen:
- Calendar predictions completas (sin caps).
- Multi-país ilimitado.
- ISO 45001 fallback universal cuando GPS detecta un país sin pack local.
- Zettelkasten (RAG normativo).
- Toda función vida-safety (ADR 0021 — nunca tier-gated).

## 3. Tabla de overage (tiers con capacidad flexible)

Sólo los tiers **Cobre, Plata, Oro** permiten overage. Los premium (**Gratis, Titanio, Platino, Diamante**) **no** tienen overage — propuesta predecible, hard upgrade si excedes.

| Tier | Trabajador extra (CLP) | Proyecto extra (CLP) |
|---|---|---|
| Cobre | $990 | $5.990 |
| Plata | $490 | $4.990 |
| Oro | $290 | $3.990 |

**Regla sugerencia upgrade:** si tu overage mensual supera el delta al siguiente tier, el sistema te recomienda subir. Implementado en `suggestUpgrade()` en `src/services/pricing/tiers.ts`.

## 4. Workspace Native (premium en adelante)

| Workspace | Lo que incluye |
|---|---|
| `sso-basic` | SSO (SAML/OIDC) básico · CSM dedicado · SLA 99.5% · onboarding en sitio |
| `sso-casa` | Todo `sso-basic` + CASA Tier · auditoría seguridad anual · API privada · soporte 24/7 |
| `multi-tenant` | Multi-tenant nativo · multi-RUT · integraciones SAP/Oracle · data residency CL |
| `multi-tenant-csm` | Todo `multi-tenant` + CSM dedicado · roadmap influence cuarterly · pen-testing |
| `vertex-finetuned` | Modelo Vertex AI fine-tuned propio · despliegue privado opcional · NIST/SOC2 ad-hoc |

## 5. Residencia de datos y multi-jurisdicción

| Tier | Jurisdicciones simultáneas | Residencia | Multi-jurisdicción |
|---|---|---|---|
| Diamante | ∞ | Multi-jurisdicción | ✅ |

## 6. Roadmap LATAM + ISO 45001

Praeventio nace cubriendo Chile (DS 54, DS 44/2024, Ley 16.744, SUSESO). El roadmap LATAM agrega packs locales sin costo extra para tiers vigentes:

- **Q2 2026:** Perú (DS 005-2012-TR), Colombia (Decreto 1072 / SG-SST).
- **Q3 2026:** México (NOM-035, NOM-019), Argentina (Ley 19.587, Res. 295/03).
- **Q4 2026:** Brasil (NR-1, NR-7, NR-9), Ecuador.
- **2027+:** España (LPRL 31/1995), resto LATAM, OSHA US.

Mientras tanto: **ISO 45001 es el fallback global**. Cualquier país sin pack local activa automáticamente la matriz ISO 45001, garantizando un piso normativo internacional reconocible.

## 7. Cómo cobramos (transparencia radical)

La página `/transparencia` documenta:
- El **bucket 2D** (trabajadores × proyectos) con diagrama interactivo.
- Tabla de overage con ejemplos.
- Tabla "cuándo conviene upgradear (y cuándo NO)".
- Comparación con alternativas reales: prevencionista part-time CL ($400k–700k CLP), SafetyCulture (~$120 USD), multas SUSESO ($1–25M CLP), accidente grave (~$50M CLP).
- Calculadora interactiva consumiendo `calculateMonthlyCost()` desde `tiers.ts` (single source of truth).

Ruta: `/transparencia` → `./src/pages/Transparencia.tsx`.

## 8. Facturación y datos legales

- **Moneda dual:** CLP (default Chile, geo-detectado) o USD (override manual persistente en `localStorage`).
- **IVA 19% incluido** en precios CLP retail. Boleta/factura electrónica chilena.
- **RUT emisor:** 78231119-0 (Praeventio Guard SpA).
- **Helper de IVA:** `withIVA(subtotal)` en `tiers.ts` retorna `{subtotal, iva, total}` con redondeo techo para mantener coherencia con la cifra `.990` mostrada al usuario.
- **Pagos consumer (gratis → Oro):** Google Play Billing en app nativa Android.
- **Pagos B2B (Titanio+):** Transbank/Webpay (CL web), Khipu (CL web alternativa), Google Play Billing (Android), transferencia + factura. CTA "Hablar con ventas" abre flujo manual hasta integración.
- **iOS:** diferido hasta primer cliente iOS confirmado y pago de fee Apple Developer ($100/año). Mientras tanto la web app PWA cubre iOS.
- **Sin Stripe:** Praeventio opera 100% sobre pasarelas locales/regionales (Transbank, Khipu, Google Play). Esta decisión es definitiva — no se reintroduce Stripe.
- **Cancelación:** mensual sin penalidad. Anual: prorrateo de meses no usados al cancelar.

## 9. Filosofía de venta

> *La seguridad no es un gasto, es una inversión en vida.*

Ninguna funcionalidad crítica de vida o muerte (evacuación, SOS, alertas climáticas extremas) está detrás de muro de pago. **Cualquier persona, en cualquier país, en cualquier momento, accede gratis al mínimo vital.** El modelo de pago financia herramientas de IA, integración empresarial y compliance avanzado para profesionales que las necesitan.

---

<sub>Última regeneración automática: 2026-08-03 · comando: `npm run pricing:doc` · fuente: `src/services/pricing/tiers.ts`</sub>
