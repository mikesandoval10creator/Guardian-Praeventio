# Análisis Competitivo — Praeventio Guard

> **Estado:** draft inicial 2026-05-19 (Bloque 2.7). Marca `TODO:research` indica datos de mercado que requieren validación con prospecto/cliente real antes de citar externamente.

## Posicionamiento Praeventio (lo que NO comparte el mercado)

Lo que separa a Praeventio Guard del resto del mercado chileno de prevención de riesgos laborales:

1. **Zettelkasten como sistema nervioso del producto** — los datos de incidentes, EPP, capacitaciones, mantenimientos, inspecciones, riesgos y normativa se modelan como nodos interconectados. Una inspección de EPP que detecta un casco vencido genera (automáticamente) un nodo de inventario, que genera una orden de compra, que después dispara una capacitación de renovación. Nadie más en el mercado modela el ciclo así.
2. **A* determinístico para evacuación + rutas críticas** — la planificación de evacuación y la elección de rutas de emergencia usan un planner clásico, no Math.random ni ML black-box. La salida es auditable bit-a-bit ante SUSESO y MINSAL.
3. **5-tier AI fallback** — SLM local (Gemma 2 2B en navegador) → Zettelkasten → Firestore → Gemini → respuesta canned. La app es operativa cuando se cae la red, cuando se cae Gemini, e incluso cuando se cae Firestore. Los competidores típicos son single-tier "cloud LLM o nada".
4. **Hash chain forense en audit logs** — los logs de auditoría no se pueden modificar sin invalidar la cadena. Reusable como evidencia ante un peritaje SUSESO sin tener que pedirle a Praeventio que firme nada extra.
5. **Multi-tenant con KMS keys per-tenant** — un cliente Enterprise puede pedir su propia clave KEK en Cloud KMS. Si SUSESO o ISP allana la cuenta de otro tenant, la información del cliente Enterprise sigue cifrada con una clave a la que nadie de Praeventio puede acceder solo.
6. **Modelo 10-tier híbrido** — Free → Comité Paritario → Departamento PRP → Enterprise → verticales industria. La mayoría del mercado es 3-tier (Free / Pro / Enterprise) sin contemplar la realidad del comité paritario chileno (DS 54).
7. **Filosofía "nunca bloquear, solo recomendar"** — el sistema NO inmoviliza maquinaria por sí solo, NO push automático a SUSESO/SII/MINSAL. Genera el documento; la empresa firma y entrega. Esto es diferencia legal real con plataformas que se posicionan como "auto-reporte".
8. **Day-1 global** — arquitectura multi-país desde el día 1 (Chile DS 44/2024 + LatAm + UK HSE + CA OHS + AU WHS + JP + KR + IN + EU AI Act). Los competidores locales son CL-only y rehacen pipeline cada expansión.

## Matriz Comparativa

> Format: `?` = TODO investigar, `✗` = confirmado ausente, `≈` = parcial, `✓` = ofrecido.

| Capacidad | Praeventio Guard | SafeHS | SafetyMind | Zyght | Prodity | Twind | PrevenControl |
|---|---|---|---|---|---|---|---|
| Compliance DS 44/2024 (DS 40 derogado) | ✓ | ? | ? | ? | ? | ? | ? |
| Ley 16.744 + ISO 45001 | ✓ | ? | ? | ? | ? | ? | ? |
| Ley Karin 21.643 (riesgos psicosociales) | ✓ | ? | ? | ? | ? | ? | ? |
| WebAuthn proof-of-presence (firma biométrica) | ✓ | ? | ? | ? | ? | ? | ? |
| KMS envelope encryption (per-tenant keys) | ✓ | ? | ? | ? | ? | ? | ? |
| Hash chain forense audit logs | ✓ | ? | ? | ? | ? | ? | ? |
| SLM offline (PWA capaz operar sin red) | ✓ | ? | ? | ? | ? | ? | ? |
| Zettelkasten organizational memory | ✓ (privado) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| A* determinístico evacuación | ✓ | ? | ? | ? | ? | ? | ? |
| Foto-grametria → Digital Twin | ✓ (Modal GPU + Cloud Run COLMAP) | ? | ? | ? | ? | ? | ? |
| AR/VR mantenimiento | Day-1+ roadmap | ? | ? | ? | ? | ? | ? |
| Multi-país DS 54/16744/HSE/OHS/WHS/etc | ✓ Day-1 | ? | ? | ? | ? | ? | ✓ ES (PrevenControl Madrid + LatAm) |
| Mobile native (Android FGS + iOS) | Android ✓ / iOS bloqueado Apple Dev | ? | ? | ? | ? | ? | ? |
| Pagos LatAm (Webpay + MercadoPago + Google Play + Apple) | ✓ | ? | ? | ? | ? | ? | ? |
| Pricing modelo 10-tier híbrido | ✓ | 3-tier típico ? | ? | ? | ? | ? | ? |
| OSS / source-available | ✗ (proprietary) | ? | ? | ? | ? | ? | ? |

## Perfiles por competidor

### SafeHS

* **Origen:** Chile (TODO:research — confirmar fundador + año).
* **Mercado:** prevención de riesgos laborales chileno, foco PYME y grandes.
* **Diferenciadores propios:** TODO:research.
* **Gaps vs Praeventio:** TODO:research.
* **Fuente:** TODO:url.

### SafetyMind

* **Origen:** Chile (TODO:research).
* **Mercado:** TODO:research.
* **Diferenciadores propios:** TODO:research (¿AI-first? ¿integración con IoT EPP?).
* **Gaps vs Praeventio:** TODO:research.
* **Fuente:** TODO:url.

### Zyght

* **Origen:** Chile (TODO:research).
* **Mercado:** SST + EHS, foco minería (TODO:confirmar).
* **Diferenciadores propios:** TODO:research.
* **Gaps vs Praeventio:** TODO:research.
* **Fuente:** TODO:url.

### Prodity

* **Origen:** Chile (TODO:research).
* **Mercado:** TODO:research.
* **Diferenciadores propios:** TODO:research.
* **Gaps vs Praeventio:** TODO:research.
* **Fuente:** TODO:url.

### Twind

* **Origen:** Chile (TODO:research).
* **Mercado:** TODO:research (¿industria especifica? ¿construcción?).
* **Diferenciadores propios:** TODO:research.
* **Gaps vs Praeventio:** TODO:research.
* **Fuente:** TODO:url.

### PrevenControl

* **Origen:** España (Madrid) con expansión LatAm.
* **Mercado:** SST europeo + LatAm. Empresa establecida ~2010s.
* **Diferenciadores propios:** marca consolidada en España, cobertura normativa EU/ES robusta (Ley 31/1995 prevención riesgos laborales española).
* **Gaps vs Praeventio:** TODO:research — particularmente si tiene compliance Chile DS 44/2024 nativo (no traducido).
* **Fuente:** TODO:url (sitio web público).

## Estrategia de posicionamiento

### Mensaje primario a prospectos chilenos

> "Tu prevencionista ya hace el trabajo. Praeventio Guard organiza la evidencia, mantiene la cadena custodia inmutable, y traduce los eventos del terreno al lenguaje que SUSESO necesita ver. Y sigue operativa cuando se va la luz en faena."

### Anti-mensaje (lo que NO somos)

- NO somos un "ChatGPT del prevencionista". El SLM local es un asistente; el sistema no toma decisiones autónomas que requieran firma humana.
- NO somos un sistema de cumplimiento automatizado. NO firmamos por la empresa. NO mandamos formularios a SUSESO/MINSAL por su cuenta. Generamos el documento; la empresa decide y firma.
- NO somos un dispositivo médico. NO diagnosticamos (Ley 20.584 + 21.719). La cartera médica portable transporta evidencia; el diagnóstico lo hace el médico tratante.

### Cómo responder a "y el competidor X hace Y"

Tabla de respuestas estandarizadas en TODO:research — necesita validación con un prospecto real antes de fijarlas como discurso comercial.

## Mantención de este documento

* **Frecuencia:** trimestral. Después de Day-1 global, mensual durante 6 meses.
* **Owner:** rol producto (Daho directamente hasta que haya equipo).
* **Fuentes a revisar:** sitios web de los 6 competidores, casos de uso publicados, presencia en ferias (EXPO PREVENCIÓN Chile, ExpoMin para vertical minera), reviews de clientes en Google Maps de las oficinas.
* **Gate de honestidad:** NO citar un competidor como "carente de X" sin tener al menos UNA fuente pública o demo grabada. La diferencia con la realidad se nota rápido si un prospecto pregunta.

## Referencias

- Master plan §2.7 (Bloque 2.7) — origen del backlog item D-COMP.
- `docs/audits/AUDIT_EXHAUSTIVA_2026-05-19.md` §3385 — referencia al gap.
- `docs/audits/PLAN_CONTINUACION_LOCAL_2026-05-19.md` §290 — listado competidores.
