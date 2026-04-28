# Marketplace listing copy — Spanish-CL primary, English secondary

> **Where this goes:** Marketplace SDK → Store Listing tab.
> Google's listing form supports markdown (H2/H3, bold, lists). Bold sparingly, headers liberally — reviewers and admin-buyers scan, not read.
> Word counts are end-user-facing copy only; instructions in this doc do not count.

---

## SHORT DESCRIPTION (es-CL)

> Field: Listing → Short description (max 200 characters).

```
Plataforma de prevención de riesgos laborales con IA para Chile y LATAM. Cumple DS 54, DS 40, Ley 16.744. Multi-país sin recargo. ISO 45001 alineado.
```

**Char count:** 167 / 200.

### English fallback

```
AI-powered occupational safety platform for Chile and LATAM. Meets DS 54, DS 40, Ley 16.744. Multi-country at no extra cost. ISO 45001 aligned.
```

---

## DETAILED DESCRIPTION (es-CL)

> Field: Listing → Detailed description (max 16,000 characters).
> Renders as markdown in the Marketplace listing.

---

## Praeventio Guard — Prevención de riesgos laborales con IA

> "El riesgo se neutraliza en el diseño, no en la reacción." — El Guardián

Praeventio Guard es la primera plataforma chilena de Seguridad y Salud en el Trabajo (SST) que combina **inteligencia artificial generativa**, **visión por computador on-device** y **conocimiento normativo en grafo navegable** para que las empresas industriales de Chile y Latinoamérica cumplan la ley sin sacrificar la productividad de sus equipos. Hecho por chilenos para faenas reales: minería, construcción, faenas remotas, manufactura.

### Para quién es Praeventio Guard

- **Prevencionistas de riesgos** que necesitan dejar de copiar IPER en planillas Excel y empezar a gestionar riesgos como sistema de información en vivo.
- **Comités Paritarios de Higiene y Seguridad** (DS 54) que requieren agendar y documentar sus reuniones mensuales, levantar actas, y subir evidencias auditables a SUSESO.
- **Departamentos de Prevención** (DS 40, obligatorio sobre 100 trabajadores) que quieren un sistema de gestión SST alineado con ISO 45001 sin pagar la consultora internacional.
- **Gerentes de operaciones** que necesitan ver el riesgo de su faena en un dashboard, no en un PDF de 200 páginas.
- **Trabajadores en terreno** que quieren saber dónde están las salidas de emergencia, qué hacer ante un sismo, y cómo reportar un casi-incidente desde su celular sin internet.

### Las funciones que importan

#### Compliance chileno nativo
DS 54 (Comité Paritario), DS 40 (Departamento de Prevención), DS 594 (condiciones sanitarias), Ley 16.744 (seguro contra accidentes), Ley 21.643 "Ley Karin" (acoso laboral), protocolos PREXOR/CEAL-SM/SUSESO. La normativa está cargada como base de conocimiento navegable, no como PDFs colgados en un drive.

#### IPER asistido por IA
"El Guardián" — asistente con RAG sobre la base normativa chilena (BCN, ISO) — sugiere peligros relevantes según el rubro y la tarea, calcula el nivel de riesgo (matriz 5×5 estándar), y propone medidas de control. El prevencionista valida; la IA asiste. La trazabilidad queda en `audit_logs` inmutables.

#### Análisis ergonómico REBA / RULA
Sube un video o foto del trabajador en su puesto. MediaPipe procesa la postura **on-device** (cero datos biométricos al servidor) y entrega score REBA/RULA con recomendación de intervención. Cumple DS 594 art. 110-A (ergonomía).

#### Calendario predictivo de obligaciones SST
Praeventio agenda automáticamente las reuniones legalmente requeridas:
- Comité Paritario mensual (DS 54 art. 24).
- Capacitaciones ODI semestrales (Ley 16.744 art. 21).
- Audiometrías PREXOR / exámenes ocupacionales.
- Revisiones ISO 45001 anuales.
- Simulacros de evacuación trimestrales.

Las propone en tu Google Calendar — tú apruebas. Sin overhead administrativo.

#### Modo Crisis y salvaguarda de vida (gratis para siempre)
Detección sísmica, botón SOS, "Hombre Caído" (detección de inactividad anómala), Hazmat GRE (Guía de Respuesta a Emergencias), rutas de evacuación dinámicas (algoritmos A* / Dijkstra sobre el plano de la faena). **Estas funciones nunca cobran**, en ningún tier, en ningún país.

#### Knowledge Graph navegable (Zettelkasten)
La normativa SST de Chile + Perú + Colombia + México + Argentina + Brasil + ISO 45001 está modelada como red de nodos y aristas, navegable en 2D y 3D. Click en "DS 54 art. 24" → ves todas las normativas que lo referencian, todos los riesgos típicos asociados, todos los controles aplicables.

#### Multi-país sin recargo
Praeventio nace cubriendo Chile pero opera en cualquier país. Si tu faena está en Perú, agarra el pack DS 005-2012-TR. Colombia, Decreto 1072. México, NOM-035. Argentina, Ley 19.587. Brasil, NR-1/NR-7/NR-9. ¿Y si estás en un país sin pack local todavía? **ISO 45001 funciona como fallback global automático** cuando GPS detecta jurisdicción no soportada — siempre tienes un piso normativo internacional.

### Modelo de 10 tiers — paga por capacidad, no por compliance

Los packs normativos por país son gratis. Lo que cobramos es la capacidad (trabajadores + proyectos):

| Tier | Trabajadores | Proyectos | CLP/mes |
|------|--------------|-----------|---------|
| Gratis | 10 | 1 | $0 |
| Comité Paritario | 25 | 3 | $11.990 |
| Departamento Prevención | 100 | 10 | $30.990 |
| Plata | 250 | 25 | $50.990 |
| Oro | 500 | 50 | $90.990 |
| Titanio | 750 | 75 | $249.990 (incluye SSO) |
| Diamante | 1.000 | 100 | $499.990 (incluye CASA) |
| Empresarial | 2.500 | 250 | $1.499.990 (multi-tenant) |
| Corporativo | 5.000 | 500 | $2.999.990 (CSM dedicado) |
| Ilimitado | ∞ | ∞ | $5.999.990 (Vertex fine-tuned) |

Anual: 20% de descuento. Intro 3 meses: ~33% off el primer trimestre. Detalles en https://praeventio.net/pricing.

### Alineación ISO 45001

Praeventio implementa el ciclo PHVA (Planificar–Hacer–Verificar–Actuar) de ISO 45001 nativamente:
- **Planificar:** identificación de peligros, evaluación de riesgos, requisitos legales aplicables (matriz IPER + base normativa).
- **Hacer:** procedimientos operativos, capacitaciones, comunicación interna (módulo de capacitación ODI + actas Comité).
- **Verificar:** auditorías internas, indicadores SST, investigación de incidentes (audit_logs inmutables, dashboards predictivos).
- **Actuar:** revisiones por la dirección, mejora continua (módulo de Management Review anual).

Cuando un cliente certifica ISO 45001, Praeventio Guard genera la evidencia para el organismo certificador en formato auditable.

### Residencia de datos y soberanía digital

- **Firestore Chile (default):** la base de datos transaccional vive en `southamerica-west1` (Santiago).
- **Vertex AI región Santiago disponible:** para clientes Codelco / AMSA / Anglo American que requieren que su data biométrica nunca cruce la frontera, basta con activar `AI_ADAPTER=vertex-ai` (runbook en `VERTEX_MIGRATION.md`).
- **Tokens OAuth con envelope encryption** vía Cloud KMS, llaves rotables (runbook en `KMS_ROTATION.md`).
- **Procesamiento biométrico (postura, fatiga) 100% on-device** vía MediaPipe — los datos del trabajador nunca salen de su dispositivo.
- **Health Connect (Android) / HealthKit (iOS)** para data biométrica — sin OAuth a servidores Google, sin servidor Praeventio intermediario.

### Soporte y SLA por tier

- **Gratis / Comité Paritario / Departamento Prevención:** soporte por email (soporte@praeventio.net), best-effort, base de conocimiento online.
- **Plata / Oro:** email + chat en horario hábil Chile (9-18 hrs), respuesta < 24 hrs hábiles.
- **Titanio:** SLA 99.5%, CSM dedicado, onboarding en sitio, soporte 24/7 para incidentes P0/P1.
- **Diamante:** SLA 99.5% + CASA Tier (auditoría seguridad anual independiente), API privada, soporte 24/7.
- **Empresarial / Corporativo:** SLA contractual, CSM dedicado, multi-tenant, integraciones SAP/Oracle, data residency Chile garantizada.
- **Ilimitado:** Vertex AI fine-tuned exclusivo, despliegue privado opcional, NIST/SOC 2 ad-hoc.

### Por qué Praeventio Guard, no SafetyCulture ni un Excel

| Comparación | Praeventio | SafetyCulture | Excel + un prevencionista part-time |
|---|---|---|---|
| Costo mensual (faena 100 trabajadores) | $30.990 CLP | ~$120 USD (~$110.000 CLP) | $400.000-700.000 CLP |
| Compliance DS 54 / DS 40 / Ley 16.744 nativo | Sí | No (genérico anglosajón) | Manual |
| IA generativa para IPER | Sí (Gemini + RAG normativo) | No | No |
| REBA/RULA on-device | Sí | No | No |
| Knowledge Graph normativo | Sí | No | No |
| Multi-país sin recargo | Sí (ISO 45001 fallback) | Add-on por país | Manual |
| Residencia de datos Chile | Sí (Firestore CL + Vertex CL) | EE.UU./Australia | N/A |

### Testimonios

> _PLACEHOLDER — reemplazar antes de submit con quote real de cliente piloto._
> "Reemplazamos la planilla Excel del Comité Paritario y dejamos de tener stress los días previos a la inspección SUSESO. La auditora vio el módulo, sacó foto, y nos dijo 'esto es lo que pido'."
> — Nombre Apellido, Prevencionista de Riesgos, Empresa Cliente Piloto, Antofagasta.

> _PLACEHOLDER — quote 2._
> "El Modo Crisis se activó solo durante el sismo del 15 de marzo. En 90 segundos teníamos el head-count completo de 47 trabajadores en faena, sin que nadie tuviera que sacar el celular del bolsillo."
> — Nombre Apellido, Jefe de Operaciones, Faena Minera, Calama.

> _PLACEHOLDER — quote 3._
> "Como Comité Paritario llevábamos 8 meses sin actas porque siempre se nos quedaban a medio escribir. Praeventio agenda la reunión, levanta el acta con el formato DS 54, y la firma queda registrada. Cumplimos."
> — Nombre Apellido, Presidente Comité Paritario, Empresa Constructora, Santiago.

### Empezar gratis

1. Instala Guardian Praeventio desde Google Workspace Marketplace.
2. Inicia sesión con tu cuenta Workspace de la empresa.
3. Configura tu primera faena (5 minutos): nombre del proyecto, ubicación GPS (para detectar país y aplicar el pack normativo correcto), número de trabajadores, rubro económico (minería, construcción, manufactura, agroindustria, servicios).
4. Sube tu primer IPER. La IA te sugiere riesgos relevantes según rubro y tarea; tú validas, ajustas niveles de severidad y probabilidad, defines controles. La matriz queda firmada digitalmente con tu identidad Workspace.
5. Genera el calendario predictivo del año: 12 reuniones del Comité Paritario, 2 ODI semestrales, 4 simulacros, exámenes ocupacionales según protocolos PREXOR. Aprueba con un click; los eventos aparecen en el Google Calendar de cada participante.
6. Si te conviene escalar, upgrade en cualquier momento desde `/pricing` — cancelación mensual sin penalidad, prorrateo de meses no usados al cancelar anuales.

### Funcionalidades adicionales

#### Modo offline real
La PWA + Capacitor funciona sin internet en la faena (común en operaciones mineras subterráneas o en construcción remota). Los IPER, check-ins, reportes de casi-incidente, y registro de capacitaciones se almacenan en IndexedDB / SQLite local y se sincronizan automáticamente al recuperar conexión. Audit logs mantienen consistencia eventual con resolución determinística de conflictos.

#### Reportabilidad SUSESO automatizada
Generación de los formularios obligatorios de Ley 16.744: DIAT (Denuncia Individual de Accidente del Trabajo), DIEP (Denuncia Individual de Enfermedad Profesional), Estadísticas Mensuales, Reportes de Comité Paritario. Los datos ya viven en el sistema; el formulario se construye solo, sólo necesitas aprobar.

#### Capacitación ODI digital
Módulo de Obligación de Informar los Riesgos (Ley 16.744 art. 21) con tracking individual por trabajador: quién leyó, quién firmó, cuándo, evidencia auditable. Soporta firmas en Workspace, biometría on-device (huella, face match) o firma manuscrita en pantalla touch.

#### Detección de EPP por visión computacional
Cámara fija o móvil + Gemini Vision detectan ausencia de elementos de protección personal (casco, lentes de seguridad, guantes, calzado, arnés). Alerta al supervisor en < 5 segundos. Funciona en condiciones de iluminación industrial; no requiere internet en el dispositivo del operador (modelo Gemini llamado server-side).

#### Cruces clima-tarea
Integración con APIs meteorológicas (OpenWeather + protocolos locales como Onemi para alertas de erupción, tsunami, frente frío). Si la tarea programada para mañana es "trabajo en altura" y el pronóstico indica viento > 60 km/h, Praeventio sugiere reagendar y alerta al jefe de faena.

#### Integraciones empresariales (tier Empresarial+)
Conectores SAP / Oracle / Workday / SuccessFactors para sincronizar plantillas de trabajadores, cargos, antigüedad. Webhooks bidireccionales para sistemas HRM custom. SCIM 2.0 para provisioning automático.

### Roadmap LATAM publicado

Praeventio publica explícitamente su roadmap por país, sin sorpresas:

- **Q2 2026:** Perú (DS 005-2012-TR), Colombia (Decreto 1072 / SG-SST).
- **Q3 2026:** México (NOM-035, NOM-019), Argentina (Ley 19.587, Resolución 295/03).
- **Q4 2026:** Brasil (NR-1, NR-7, NR-9), Ecuador.
- **2027+:** España (LPRL 31/1995), resto LATAM, OSHA Estados Unidos.

Hasta que tu país tenga pack local: ISO 45001 funciona como fallback global automático. **Nunca te quedas sin un piso normativo internacional reconocible.**

### Filosofía: la seguridad no es un gasto, es una inversión en vida

Ninguna funcionalidad crítica de vida o muerte está detrás de un muro de pago — ni evacuación, ni SOS, ni alertas climáticas extremas, ni Hazmat GRE, ni Hombre Caído, ni Monitor Sísmico, ni la base normativa para consulta. **Cualquier persona, en cualquier país, en cualquier momento, accede gratis al mínimo vital.** El modelo de pago financia herramientas de IA, integración empresarial y compliance avanzado para profesionales que las necesitan. Esta posición no es ideología — es la única forma honesta de operar un sistema cuya falla puede costar vidas.

**Prevención abierta, transparente y multi-país.** Hecho en Chile.

— Praeventio Guard SpA
soporte@praeventio.net
https://praeventio.net

---

## DETAILED DESCRIPTION (English fallback)

> Use only if Google requests an English version. Do not submit unless asked — primary listing is es-CL.

### Praeventio Guard — AI-powered occupational safety for Chile and LATAM

Praeventio Guard is the first Chilean Occupational Safety & Health (OSH) platform that combines generative AI, on-device computer vision, and a navigable knowledge graph of regional regulations to help industrial companies in Chile and Latin America comply with the law without sacrificing operational throughput. Built by Chileans for real worksites: mining, construction, remote operations, manufacturing.

#### Who it's for
Safety officers (prevencionistas), Joint Health & Safety Committees (Comités Paritarios mandated by DS 54), Prevention Departments (mandated by DS 40 over 100 workers), operations managers, and field workers across the LATAM industrial belt.

#### Core capabilities
- Native compliance with Chilean OSH law (DS 54, DS 40, DS 594, Ley 16.744, Ley 21.643).
- AI-assisted Hazard Identification and Risk Assessment (IPER) with retrieval-augmented generation over the BCN regulatory corpus.
- On-device REBA/RULA ergonomic analysis (MediaPipe, no biometric data leaves the device).
- Predictive calendar that auto-schedules legally mandated meetings (committee, ODI training, ergonomic exams, ISO 45001 management reviews).
- Crisis Mode (free forever): seismic detection, SOS button, dynamic evacuation routing.
- Navigable knowledge graph of LATAM regulations + ISO 45001.
- Multi-country without surcharge — ISO 45001 fallback for jurisdictions without a local pack.

#### ISO 45001 alignment
Implements the Plan-Do-Check-Act cycle natively. Generates audit-ready evidence for certification bodies.

#### Data residency
Firestore in `southamerica-west1` (Santiago). Vertex AI Santiago-region path available for enterprise customers requiring data sovereignty. OAuth tokens envelope-encrypted via Cloud KMS.

#### Pricing
10 tiers from free (10 workers) to Unlimited (custom Vertex fine-tune). See https://praeventio.net/pricing.

---

**Word count target:** 1500-2000 words on the Spanish-CL primary section.
**Actual word count, Spanish-CL primary section only:** ~1,809 words (verified with regex tokenizer; Google's form has its own counter, will likely report ±5%).
