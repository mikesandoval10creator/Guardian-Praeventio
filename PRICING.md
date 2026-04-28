# Praeventio Guard — Política de Precios

> **Filosofía:** la prevención de salvaguarda de vida es **siempre gratis**. Nunca un protocolo de evacuación, alerta de emergencia, ni botón de SOS estará detrás de un muro de pago. **Multi-país sin recargo:** opera en cualquier jurisdicción sin costo extra; ISO 45001 funciona como fallback global cuando GPS detecta un país sin pack normativo local.

---

## 1. Lógica dual: capacidad vs cumplimiento

Praeventio cobra en dos dimensiones independientes:

| Dimensión          | Qué mide                            | Cómo se cobra                |
|--------------------|-------------------------------------|------------------------------|
| **Capacidad**      | Trabajadores totales + proyectos    | Define el **tier** (1 a 10)  |
| **Cumplimiento**   | Normativa local por proyecto/faena  | Pack opcional **per-project**|

El tier se elige por capacidad. Los packs normativos (DS 54, DS 40, NIOSH, ISO 45001…) se contratan por proyecto y se acumulan sin afectar el tier.

---

## 2. Los 10 tiers (definitivos)

| # | Tier                       | Trabajadores | Proyectos | CLP/mes regular | CLP intro 3m | CLP anual    | USD/mes | Workspace          |
|---|----------------------------|--------------|-----------|-----------------|--------------|--------------|---------|--------------------|
| 1 | Gratis                     | 10           | 1         | $0              | $0           | $0           | $0      | —                  |
| 2 | Comité Paritario           | 25           | 3         | $11.990         | $7.990       | $96.990      | $13     | —                  |
| 3 | Departamento Prevención    | 100          | 10        | $30.990         | $21.990      | $288.990     | $33     | —                  |
| 4 | Plata                      | 250          | 25        | $50.990         | $35.990      | $480.990     | $54     | —                  |
| 5 | Oro                        | 500          | 50        | $90.990         | $63.990      | $864.990     | $96     | —                  |
| 6 | Titanio                    | 750          | 75        | $249.990        | $174.990     | $2.399.990   | $263    | SSO básico         |
| 7 | Diamante                   | 1.000        | 100       | $499.990        | $349.990     | $4.799.990   | $526    | SSO + CASA         |
| 8 | Empresarial                | 2.500        | 250       | $1.499.990      | $1.049.990   | $14.399.990  | $1.578  | Multi-tenant       |
| 9 | Corporativo                | 5.000        | 500       | $2.999.990      | $2.099.990   | $28.799.990  | $3.158  | Multi-tenant + CSM |
| 10| Ilimitado                  | ∞            | ∞         | $5.999.990      | $4.199.990   | $57.599.990  | $6.315  | Vertex fine-tuned  |

> **Anual = 20% off** sobre el regular × 12. **Intro 3 meses ≈ −33%** sobre el primer trimestre.

Todos los tiers incluyen:
- Calendar predictions completas (sin caps).
- Multi-país ilimitado.
- ISO 45001 fallback universal cuando GPS detecta un país sin pack local.

---

## 3. Tabla de overage (tiers básicos)

Sólo los tiers Comité Paritario, Departamento, Plata y Oro permiten overage. Los premium (Titanio+) **no** tienen overage — propuesta predecible, hard upgrade si excedes.

| Tier                       | Trabajador extra (CLP) | Proyecto extra (CLP) |
|----------------------------|------------------------|----------------------|
| Comité Paritario           | $990                   | $5.990               |
| Departamento Prevención    | $490                   | $4.990               |
| Plata                      | $290                   | $3.990               |
| Oro                        | $190                   | $2.990               |

**Regla sugerencia upgrade:** si tu overage mensual supera el delta al siguiente tier, el sistema te recomienda subir. Implementado en `suggestUpgrade()` en `src/services/pricing/tiers.ts`.

---

## 4. Workspace Native (Titanio en adelante)

| Tier         | Workspace | Lo que incluye                                                                     |
|--------------|-----------|------------------------------------------------------------------------------------|
| Titanio      | sso-basic | SSO (SAML/OIDC) básico · CSM dedicado · SLA 99.5% · onboarding en sitio            |
| Diamante     | sso-casa  | Todo Titanio + CASA Tier · auditoría seguridad anual · API privada · soporte 24/7 |
| Empresarial  | multi-tenant | Multi-tenant nativo · multi-RUT · integraciones SAP/Oracle · data residency CL |
| Corporativo  | multi-tenant-csm | Todo Empresarial + CSM dedicado · roadmap influence cuarterly · pen-testing |
| Ilimitado    | vertex-finetuned | Modelo Vertex AI fine-tuned propio · despliegue privado opcional · NIST/SOC2 ad-hoc |

---

## 5. Roadmap LATAM + ISO 45001

Praeventio nace cubriendo Chile (DS 54, DS 40, Ley 16.744, SUSESO). El roadmap LATAM agrega packs locales sin costo extra para tiers vigentes:

- **Q2 2026:** Perú (DS 005-2012-TR), Colombia (Decreto 1072 / SG-SST).
- **Q3 2026:** México (NOM-035, NOM-019), Argentina (Ley 19.587, Res. 295/03).
- **Q4 2026:** Brasil (NR-1, NR-7, NR-9), Ecuador.
- **2027+:** España (LPRL 31/1995), resto LATAM, OSHA US.

Mientras tanto: **ISO 45001 es el fallback global**. Cualquier país sin pack local activa automáticamente la matriz ISO 45001, garantizando un piso normativo internacional reconocible.

---

## 6. Cómo cobramos (transparencia radical)

La página `/transparencia` documenta:
- El **bucket 2D** (trabajadores × proyectos) con diagrama interactivo.
- Tabla de overage con ejemplos.
- Tabla "cuándo conviene upgradear (y cuándo NO)".
- Comparación con alternativas reales: prevencionista part-time CL ($400k–700k CLP), SafetyCulture (~$120 USD), multas SUSESO ($1–25M CLP), accidente grave (~$50M CLP).
- Calculadora interactiva consumiendo `calculateMonthlyCost()` desde `tiers.ts` (single source of truth).

Ruta: [`/transparencia`](./src/pages/Transparencia.tsx).

---

## 7. Facturación y datos legales

- **Moneda dual:** CLP (default Chile, geo-detectado) o USD (override manual persistente en `localStorage`).
- **IVA 19% incluido** en precios CLP retail. Boleta/factura electrónica chilena.
- **RUT emisor:** 78231119-0.
- **Helper de IVA:** `withIVA(subtotal)` en `tiers.ts` retorna `{subtotal, iva, total}` con redondeo techo para mantener coherencia con la cifra `.990` mostrada al usuario.
- **Pagos consumer (gratis → Oro):** Google Play Billing en app nativa.
- **Pagos B2B (Titanio+):** Stripe / Webpay / transferencia + factura. CTA "Hablar con ventas" abre flujo manual hasta integración (ver `IMP5`).
- **Cancelación:** mensual sin penalidad. Anual: prorrateo de meses no usados al cancelar.

---

## 8. Filosofía de venta

> *La seguridad no es un gasto, es una inversión en vida.*

Ninguna funcionalidad crítica de vida o muerte (evacuación, SOS, alertas climáticas extremas) está detrás de muro de pago. **Cualquier persona, en cualquier país, en cualquier momento, accede gratis al mínimo vital.** El modelo de pago financia herramientas de IA, integración empresarial y compliance avanzado para profesionales que las necesitan.

---

*Praeventio Guard · Prevención abierta, transparente y multi-país.*
