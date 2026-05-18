# Praeventio Guard — Política de Precios

> **Filosofía:** la prevención de salvaguarda de vida es **siempre gratis**. Nunca un protocolo de evacuación, alerta de emergencia, ni botón de SOS estará detrás de un muro de pago. **Multi-país sin recargo:** opera en cualquier jurisdicción sin costo extra; ISO 45001 funciona como fallback global cuando GPS detecta un país sin pack normativo local.

---

## 1. Lógica dual: capacidad vs cumplimiento

Praeventio cobra en dos dimensiones independientes:

| Dimensión          | Qué mide                            | Cómo se cobra                |
|--------------------|-------------------------------------|------------------------------|
| **Capacidad**      | Trabajadores totales + proyectos    | Define el **tier** (1 a 10)  |
| **Cumplimiento**   | Normativa local por proyecto/faena  | Pack opcional **per-project**|

El tier se elige por capacidad. Los packs normativos (DS 54, DS 44/2024, NIOSH, ISO 45001…) se contratan por proyecto y se acumulan sin afectar el tier.

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

Praeventio nace cubriendo Chile (DS 54, DS 44/2024, Ley 16.744, SUSESO). El roadmap LATAM agrega packs locales sin costo extra para tiers vigentes:

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
- **Pagos consumer (gratis → Oro):** Google Play Billing en app nativa Android.
- **Pagos B2B (Titanio+):** Transbank/Webpay (CL web), Khipu (CL web alternativa), Google Play Billing (Android), transferencia + factura. CTA "Hablar con ventas" abre flujo manual hasta integración (ver `IMP5`).
- **iOS:** diferido hasta primer cliente iOS confirmado y pago de fee Apple Developer ($100/año). Mientras tanto la web app PWA cubre iOS.
- **Sin Stripe:** Praeventio opera 100% sobre pasarelas locales/regionales (Transbank, Khipu, Google Play). Esta decisión es definitiva — no se reintroduce Stripe.
- **Cancelación:** mensual sin penalidad. Anual: prorrateo de meses no usados al cancelar.

---

## 8. Filosofía de venta

> *La seguridad no es un gasto, es una inversión en vida.*

Ninguna funcionalidad crítica de vida o muerte (evacuación, SOS, alertas climáticas extremas) está detrás de muro de pago. **Cualquier persona, en cualquier país, en cualquier momento, accede gratis al mínimo vital.** El modelo de pago financia herramientas de IA, integración empresarial y compliance avanzado para profesionales que las necesitan.

---

## 9. APIs B2D — 3+1 servicios para desarrolladores e IAs

A partir de Sprint 10, Praeventio expone una capa **B2D** (Business-to-Developer / Business-to-AI) **paralela e independiente** del modelo B2B de 10 tiers. El B2B no se modifica: sigue cobrando por capacidad (trabajadores × proyectos) más packs normativos. El B2D cobra por **acceso programático a la inteligencia interna** —datos, motores de cálculo y normativas— para que otros equipos, productos o agentes de IA construyan sobre Praeventio.

> **Precios B2D iniciales** — estas tarifas son una propuesta de partida y se ajustarán con telemetría real de uso después del Sprint 16 (implementación). Documentadas como `initial pricing` en código.

### 9.1 Las 3+1 APIs

| API | Código | Superficie cubierta |
|---|---|---|
| **A — Climate & Environmental Intelligence** | `A` | Boletín climático (wrapper de Open-Meteo con lógica Praeventio), índices sísmicos USGS, tracker solar/lunar, escalamiento por altitud y la lógica de inversión cruzada de tema climático |
| **B — Hazmat & Engineering Calculations (Bernoulli)** | `B` | Las 6 funciones puras de `bernoulliEngine.ts` + los 15 casos de uso `BERNOULLI_EXTENSIONS` (presión dinámica, Venturi, carga de viento, fatiga respiratoria, rocío, etc.) |
| **C — Normativa Chilena & LATAM Compliance** | `C` | 15 normativas chilenas (DS 54, DS 44/2024, Ley 16.744, NCh, etc.) + 5 protocolos chilenos + ISO 45001 fallback global + roadmap LATAM (Q2 Perú/Colombia · Q3 México/Argentina · Q4 Brasil/Ecuador) |
| **D — Praeventio Intelligence Suite** | `D` | Combo A+B+C con descuento (~30%) + acceso al **Gemini AI Coach** con contexto Praeventio. Entrada única para integradores que quieran "todo Praeventio menos Zettelkasten" |

### 9.2 Pricing B2D (USD/mes)

| API | Tier `base` | Tier `pro` | Requests/mes (base) | Requests/mes (pro) |
|---|---|---|---|---|
| A — Climate | $79 | $199 | 100.000 | 1.000.000 |
| B — Hazmat (Bernoulli) | $129 | $329 | 50.000 | 500.000 |
| C — Normativa | $149 | $399 | 50.000 | 500.000 |
| D — Suite (A+B+C+Coach) | $399 | $899 | 200.000 | 2.000.000 |

Suma A+B+C base = $357 · Suite base = $399. **El descuento real está en `pro`:** A+B+C pro = $927 vs Suite pro = $899 (≈3% directo) **+** acceso al Gemini AI Coach que individualmente no se vende → el ahorro efectivo supera 30% para clientes que necesitan razonamiento contextual.

> Anual: 20% off sobre regular × 12 (mismo deal que B2B). Sin tier intro de 3 meses por ahora — el ramp-up de adopción dev se mide distinto.

### 9.3 Frontera de privacidad — el Zettelkasten **NUNCA** es API

> **Regla inviolable, escrita en código y en contrato.**

Las APIs B2D **NO** exponen ningún dato del Zettelkasten interno de Praeventio:

- ❌ Nodos del proyecto del usuario (proyectos, faenas, hallazgos IPER).
- ❌ Telemetría de campo (ubicación de trabajadores, alertas SOS, evacuaciones).
- ❌ EPP por trabajador (talles, vencimientos, asignaciones).
- ❌ Resultados de evaluaciones psicosociales o de salud individuales.
- ❌ Documentos legales firmados por la empresa.
- ❌ Cualquier subcolección de Firestore bajo `tenants/{tenantId}/...`.

**Lo que sí exponen las APIs B2D:**

- ✅ Datos públicos enriquecidos (clima, sísmica, solar, normativa).
- ✅ Funciones puras de cálculo físico (Bernoulli y derivados).
- ✅ Catálogo normativo con su fallback ISO 45001.
- ✅ Razonamiento del Coach de IA *sobre el input del integrador*, no sobre tenants Praeventio.

Esta frontera está reflejada en `aiTier.ts:privacyNote` (campo obligatorio por tier) y se valida en CI.

### 9.4 Casos de uso por API

**A — Climate & Environmental Intelligence**
- Apps agro/forestales que necesitan boletín climático CL/LATAM con misma fuente que Praeventio.
- Plataformas de seguros paramétricos que precisan índices sísmicos consistentes.
- Asistentes de IA que tutorean planificación de faenas exteriores con altitud + inversión.

**B — Hazmat & Engineering Calculations (Bernoulli)**
- Software CAD/BIM que quiera incrustar cálculo de carga de viento sobre estructuras.
- LMS de prevención que necesite simular presiones de incidente ante alumnos.
- IDEs de IA agentic (Cursor, Cline, Codex) generando hojas de cálculo de hazmat correctas a la primera.

**C — Normativa Chilena & LATAM Compliance**
- Bufetes laborales que quieran auto-checks de cumplimiento DS 54 / DS 44/2024.
- Plataformas SaaS verticales (mineras, construcción) que necesiten un motor normativo CL al día.
- Agentes de IA legal que respondan "¿esta faena cumple DS 594?" con la matriz oficial.

**D — Praeventio Intelligence Suite**
- Integradores enterprise que quieran "todo Praeventio sobre nuestro stack" sin construir B2B.
- Productos de IA generalistas que monten un *Coach de prevención* vertical.

### 9.5 Modelo de autenticación

- API key estática por cliente, formato `pvtio_live_<32 chars>` o `pvtio_test_<32 chars>`.
- Header obligatorio: `X-Praeventio-Api-Key: <key>`.
- Rotación auto-self-service desde el panel B2D (pendiente Sprint 17).
- Rate limit por tier (ver `aiTier.ts:rateLimit`):
  - `*-base`: 10 req/s, 50.000 req/día.
  - `*-pro`: 50 req/s, 500.000 req/día.
  - `suite-*` aplica el doble que sus análogos individuales.
- Headers de respuesta: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch UTC).

### 9.6 Cuotas mensuales y overage

Cada tier tiene una cuota `requestsPerMonth`. El overage se cobra por bloques de 10.000 requests adicionales:

| Tier | Bloque overage (10k req) |
|---|---|
| `*-base` | $9 USD |
| `*-pro` | $5 USD |
| `suite-*` | $4 USD |

`calculateApiCost(tier, projectedRequests)` en `aiTier.ts` retorna costo total proyectado. Si el overage mensual de un cliente supera el delta al tier `pro`, el panel B2D recomienda upgrade (mismo patrón que `suggestUpgrade` en B2B).

### 9.7 Sample requests

**A — Climate**

```bash
curl -H "X-Praeventio-Api-Key: pvtio_live_..." \
  "https://api.praeventio.net/v1/climate/bulletin?lat=-33.45&lng=-70.66"
```

```js
// JS (fetch)
const r = await fetch('https://api.praeventio.net/v1/climate/seismic?radius=200', {
  headers: { 'X-Praeventio-Api-Key': process.env.PRAEVENTIO_KEY ?? '' },
});
```

**B — Hazmat (Bernoulli)**

```bash
curl -X POST -H "X-Praeventio-Api-Key: pvtio_live_..." \
  -H "Content-Type: application/json" \
  -d '{"velocity":12.5,"density":1.225}' \
  https://api.praeventio.net/v1/hazmat/bernoulli/dynamic-pressure
```

**C — Normativa**

```bash
curl -H "X-Praeventio-Api-Key: pvtio_live_..." \
  "https://api.praeventio.net/v1/normativa/chile/ds-594"
```

**D — Suite (AI Coach)**

```bash
curl -X POST -H "X-Praeventio-Api-Key: pvtio_live_..." \
  -H "Content-Type: application/json" \
  -d '{"question":"¿Qué EPP exige DS 594 para trabajos en altura?"}' \
  https://api.praeventio.net/v1/suite/ai-coach
```

> El AI Coach **NO** consulta tenants Praeventio — opera solo sobre el input del integrador y la base normativa pública. Documentado en §9.3.

---

## 10. Filosofía B2D

> *El conocimiento de prevención debe ser una primitiva, no un silo.*

El mercado B2B mide vidas dentro de una organización. El mercado B2D mide **cuántas otras organizaciones podemos elevar** poniendo nuestra inteligencia detrás de un endpoint. Si una IA generalista responde mejor de prevención porque habla con la API C, ganamos todos: el integrador, el usuario final y el operario al borde de un riesgo que nadie iba a calcular a tiempo.

Reglas auto-impuestas:

1. **Los datos del usuario nunca se monetizan.** El Zettelkasten queda fuera de la API por contrato (§9.3). Si algún día abrimos *partes* del Zettelkasten, será con consentimiento explícito por-usuario y marcado como tier separado, no escondido en una clave.
2. **Los precios del Sprint 10 son iniciales.** Después de seis meses con telemetría B2D real (Sprint 16 lanza endpoints; Sprint 22 lee métricas), revisamos. Lo que no cambia es la regla de privacidad.
3. **Lo gratis sigue gratis también acá:** existirá un tier `free` B2D (1.000 req/mes, sin SLA, sin Coach) para que makers y devs prueben antes de pagar. Aún no documentado en `aiTier.ts` — pendiente para cuando se monte el panel B2D.
4. **Los desarrolladores no son enemigos de los prevencionistas.** Son la palanca para escalar el método Praeventio a contextos donde no llegamos directo: educación, legaltech, agro, seguros paramétricos, asistentes verticales.

---

*Praeventio Guard · Prevención abierta, transparente y multi-país. APIs B2D 3+1 con frontera de privacidad inviolable.*
