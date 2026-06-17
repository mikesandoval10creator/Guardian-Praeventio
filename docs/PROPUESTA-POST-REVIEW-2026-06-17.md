# Propuesta post-review — Guardian Praeventio (2026-06-17)

> **Estado: BORRADOR para revisar juntos.** No es un compromiso de ejecución.
> Nace de (a) un review externo módulo-por-módulo y (b) la verificación de sus
> afirmaciones contra HEAD actual + el backlog ya verificado por workflows.
> Norte del fundador: **honesto = real** (nada que finja funcionar), vida/legal
> primero, lanzamiento global, elegir un primer vertical y hacerlo impecable.

---

## 1. Contexto — de dónde partimos hoy

Esta sesión cerró **10 PRs en main** (#956–#965): los 7 hallazgos vida/legal del
backlog + 6 del lote anterior = **13/23** del backlog de mejoras. Quedan **10
ítems de deuda chica** (hygiene, ya verificados con specs) + las **brechas
estratégicas** que levantó el review.

El review es **creíble y bien hecho** (leyó código real, cita PRs/file:line
correctos). Pero, igual que con los docs viejos, lo crucé contra el código:

- **Stale / ya resuelto:** "PDCA no escribe a ZK" → FALSO hoy
  (`incidentFlow.ts:40,81-93`, resuelto #957). Toda su sección SOS/Incidentes/EPP
  es **previa a los 10 PRs de hoy** y no los conoce.
- **Impreciso:** "tier-gating en report-only" → el middleware `requireTier` ya
  default-ea a **enforce** (`requireTier.ts:73,82`); el riesgo real es por
  call-site, no global. "Falta LTIFR" → **existe** en
  `monthlyClientReportBuilder.ts:27-28,184-185`, solo que **no está en el
  ExecutiveDashboard** (es surfaceo, no construcción).
- **Correcto e importante:** EPP detección por color da falsa confianza
  (`colorBasedEppDetector.ts` existe); SII = scaffolding real
  (`sii/index.ts:12` "every PSE except noop throws"); bowtie con test
  wire-up-only (anti-patrón); mesh signing por confirmar.

---

## 2. Track A — Cierre de deuda hygiene (en curso, **yo ejecuto como merge-gate**)

10 ítems no-vida ya verificados (workflow `verify-spec-perf-backlog`): 7 siguen
abiertos con spec exacto + 3 ya se cerraron antes (#953 Equipment-QR, etc.). No
requieren tu decisión — es cierre de deuda dentro del mandato autónomo. Cola
serial, 1 PR por bloque, TDD conductual + review en el sensible:

| # | Bloque | Riesgo | Review |
|---|---|---|---|
| 1 | **N16** jsPDF+html2canvas → dynamic import (6 páginas) | bajo | no |
| 2 | **N15** ExecutiveDashboard useMemo (colisiona con N16 → secuenciar) | bajo | no |
| 3 | **N6mural** MuralDinamico: comentarios in-place + kebab + like-catch | medio | no |
| 4 | **N13** N+1 sweep `useZettelkastenIntelligence` (2 getDocs + writeBatch) | medio | no |
| 5 | **N18** Settings toggles 2FA→/security-shield + persistir prefs reales | medio | no |
| 6 | **N7b2d** cron MRR en deploy.yml + regla `b2d_mrr_snapshots` + rules-tests | medio | **SÍ** |

Esto baja el backlog a **23/23** y deja el árbol limpio. Lo arranco sin esperar.

---

## 3. Track B — Brechas estratégicas (**esto lo revisamos juntos**)

Cada brecha: *qué problema · qué hay hoy (file:line) · propuesta acotada ·
esfuerzo · riesgo · depende-de · por-qué (honestidad/regulatorio/ingreso)*.

### FASE 1 — Honestidad + el KPI que importa (mi recomendación de los "3 impecables")

Estos tres son **alto leverage**: se apoyan en datos/engines REALES ya
existentes (no es construir de cero, es honestizar + surfacear), y los tres
encarnan tu directiva *honesto = real*.

**1.1 — EPP honesto + ciclo de vida** ⭐ (el punto más fuerte del review)
- **Hoy:** `colorBasedEppDetector.ts` existe y se surface en `VisionAnalyzer.tsx`.
  Detecta por color → no distingue casco de sombrero del mismo color → **falsa
  confianza** (un feature que falla en silencio es peor que no tenerlo).
  Asignación/inspección QR pre-uso ya real (#953).
- **Propuesta (2-3 PRs):**
  1. **Honestizar la detección:** relabel a "ayuda visual — NO verificación",
     disclaimer explícito, y que NUNCA marque ✅ cumplimiento por sí sola
     (la verificación queda en el check humano / QR). O gatearla tras un modelo
     real (YOLO-tiny) como flag off. Cero falsa confianza.
  2. **Trazabilidad de ciclo de vida del EPP:** comprado → entregado → firmado →
     inspeccionado → vence → reemplazo, sobre los datos de asignación que ya
     existen.
  3. **Dashboard "EPP vencidos / por reemplazar"** + alertas push 30/15/7 días
     antes (reusar el pipeline de notificaciones).
- **Esfuerzo:** medio · **Riesgo:** bajo · **Depende de:** nada · **Por qué:**
  honestidad directa + valor real diario para el prevencionista. El review lo
  pone como el módulo más débil (6/10).

**1.2 — Surfacear LTIFR / Índice de Frecuencia en analytics**
- **Hoy:** TRIR/LTIFR se computan en `monthlyClientReportBuilder.ts:27-28` pero
  **no aparecen en el ExecutiveDashboard** (grep vacío). El KPI que la industria
  minera/construcción usa para compararse no está a la vista.
- **Propuesta (1-2 PRs):** montar IF/LTIFR en el ExecutiveDashboard (reusar la
  computación del builder, no reimplementar) + comparativa entre faenas +
  alerta de anomalía (si incidentes suben >X% semana, avisar).
- **Esfuerzo:** bajo-medio · **Riesgo:** bajo · **Depende de:** nada · **Por
  qué:** es dato REAL ya calculado, solo no surfaceado; alto impacto gerencial.

**1.3 — Dashboard de salud "exámenes vencidos" como home del prevencionista**
- **Hoy:** `VigilanciaScheduler.tsx` existe (usado en Medicine/Hygiene) pero no
  hay un home que muestre "quién tiene examen vencido"; anatomía 3D / dx
  diferencial son llamativos pero no es lo primero que el prevencionista necesita.
  DS 594 art.51-53 (vigilancia de ruido/sílice/químicos) sin cableado a alertas.
- **Propuesta (2 PRs):** widget/home "exámenes médicos + EPP vencidos/por vencer"
  + cablear `VigilanciaScheduler` → alerta automática cuando un examen está
  vencido + (si encaja) enlazar al calendario legal.
- **Esfuerzo:** medio · **Riesgo:** bajo · **Depende de:** nada · **Por qué:**
  regulatorio (DS 594) + surface de datos reales + UX que el review pide explícito.

### FASE 2 — Regulatorio + seguridad

**2.1 — Activar SII: implementar 1 adapter PSE real** (regulatorio Chile)
- **Hoy:** `sii/index.ts:12` "SCAFFOLDING ONLY — every PSE except noop throws".
  Los rieles + cola de reintento son reales y fail-closed (#959/#869), pero el
  adapter que habla con LibreDTE/OpenFactura **no está implementado** → no se
  emite DTE de verdad. En Chile la factura electrónica es obligatoria.
- **Propuesta:** implementar UN adapter real (LibreDTE tiene API abierta;
  OpenFactura es alternativa) detrás de la interfaz que ya existe + contract
  tests. Lo dejo **flip-ready**: emite de verdad cuando pongas la credencial.
- **Esfuerzo:** medio-alto · **Riesgo:** medio · **Review:** SÍ · **Depende de:**
  credencial PSE tuya para emisión LIVE (la implementación no te necesita).

**2.2 — Mesh packet signing (spike de seguridad)** ⚠
- **Hoy:** no pude confirmar el `meshPacket.ts:237 "unsigned-dev"` exacto (el
  mesh vive en `packages/capacitor-mesh/src` + `MeshProvider.tsx`; existe
  `meshKeys.rules.test.ts` → hay infra de llaves). Si los paquetes que llevan
  **alertas de emergencia** van sin firmar, un atacante en la malla podría
  inyectar falsas alertas.
- **Propuesta:** spike de 1 día para confirmar el estado real; si está sin
  firmar, firmar con HMAC/llave de la infra existente + verificación en RX.
- **Esfuerzo:** spike + (si aplica) medio · **Riesgo:** —  · **Review:** SÍ ·
  **Por qué:** seguridad de un canal de vida.

**2.3 — Anticipación del calendario legal (CPHS/DPRP)**
- **Hoy:** hay advisory cuando la dotación cruza el umbral, pero el día que cruza.
- **Propuesta:** alertar **30 días antes** de cruzar el umbral (proyectar dotación
  + fecha estimada de cruce).
- **Esfuerzo:** bajo-medio · **Riesgo:** bajo · **Por qué:** regulatorio + da
  tiempo real de reacción.

### FASE 3 — Inteligencia conectada (cableados entre piezas que ya existen)

- **3.1 Tendencia predictiva de incidentes:** regresión lineal sobre 12 meses →
  "si sigue así, N incidentes el próximo trimestre". Esfuerzo bajo.
- **3.2 Priorización de sincronización offline:** emergencia > permisos >
  incidentes > telemetría al reconectar; resolución de conflictos auto para
  datos de seguridad (servidor gana). Esfuerzo medio. Vida-relevante para faenas
  remotas.
- **3.3 Pre-calificación automática de contratistas:** antes de entrar a faena,
  verificar capacitación/EPP/examen/seguro vigentes; si falta, bloquear acceso
  (recomendar, no impedir físico — coherente con la directiva). Esfuerzo medio-alto.
- **3.4 Costo económico del riesgo (IPER):** "este riesgo cuesta ~$X/mes
  esperado". Diferenciador. Esfuerzo medio.
- **3.5 Bowtie con test conductual real** (hoy `bowtie.test.ts` es
  `router.stack`, anti-patrón) + confirmar persistencia. Esfuerzo bajo.

### FASE 4 — Diferenciadores

- **4.1 REBA/RULA auto-ángulo con MediaPipe Pose** (ya integrado): la cámara mide
  ángulos, el prevencionista solo confirma → de 15 min a 2. Esfuerzo medio-alto.
- **4.2 Gemelo 2.5D útil con IoT** (priorizar sobre 3D/WebXR): capas de riesgo +
  rutas de evacuación + posiciones de equipo + overlays de sensores de gas/temp.
  Esfuerzo medio.
- **4.3 Coach IA por dominio** (minería/construcción/salmonera) + explicabilidad
  ("según DS 594 art.110, REBA=7 requiere acción"). Esfuerzo medio.

### Day-2 / correctamente bloqueado (NO invertir ahora — coincido con el review)
WebXR / COLMAP fotogrametría (sin hardware nativo), HealthConnect/HealthKit
(keystores), Vertex Trainer / fine-tuning. Quedan flip-ready o esperando tu
desbloqueo externo.

### Transversal — consolidación (oportunista)
El review marca fragmentación (7 dirs de riesgo, 4 de salud, 5 de cumplimiento).
**No un refactor big-bang** (riesgoso): consolidar UI en dashboards con tabs
*cuando ya estemos tocando ese dominio* por otra razón.

---

## 4. Marco de priorización

Ordeno por **(honestidad ∨ vida ∨ regulatorio) × (apóyate en lo real existente) ÷
esfuerzo**, y dejo lo bloqueado/externo al final:

1. **Track A hygiene** (en curso) — cierre de deuda, sin decisión tuya.
2. **Fase 1** (EPP honesto · LTIFR · salud-vencidos) — los "3 impecables": máximo
   leverage honestidad×valor, todo sobre datos/engines reales.
3. **Fase 2** (SII adapter · mesh spike · calendario anticipado) — regulatorio +
   seguridad; SII y mesh requieren review.
4. **Fase 3** (predictivo · sync-prio · pre-qual · costo riesgo · bowtie test).
5. **Fase 4** (REBA auto-ángulo · twin 2.5D · coach por dominio).

---

## 5. Decisiones que son tuyas (no del código)

1. **Vertical primero:** ¿minería o construcción? El review insiste (y coincido)
   en hacer 3 módulos impecables para UN vertical antes que mejorar todo. Esto
   afina qué priorizo dentro de Fase 1-2.
2. **¿Apruebas los "3 impecables" de Fase 1** (EPP honesto, LTIFR, salud-vencidos)
   como el primer frente estratégico tras hygiene? ¿O reordenas?
3. **SII:** ¿implemento ya el adapter PSE real (flip-ready) o lo dejamos para
   cuando tengas la credencial? (puedo dejar la implementación lista esperando
   solo el secreto).
4. **Mesh signing:** ¿autorizas el spike de seguridad? (1 día, solo lectura;
   si está sin firmar, lo elevo a bloque con review).

---

## 6. Mi recomendación

- **Ahora:** ejecuto **Track A** (hygiene, 6 bloques) — es deuda, bajo riesgo,
  cierra el backlog a 23/23.
- **Primer frente estratégico:** **Fase 1 completa** (EPP honesto + LTIFR +
  salud-vencidos). Es lo más alineado con *honesto = real*, se apoya en lo que ya
  es real, y ataca justo los módulos que el review puntúa más bajo (EPP 6, salud
  7, analytics 7) — subiéndolos sin humo.
- **En paralelo (async, no bloquea):** dejo el **adapter SII real flip-ready** y
  corro el **spike de mesh-signing**.
- Fases 3-4 quedan como roadmap, se priorizan según el vertical que elijas.

> Dime qué ajustas de esto (vertical, orden, alcance de cada fase) y lo
> convierto en el plan de ejecución definitivo.
