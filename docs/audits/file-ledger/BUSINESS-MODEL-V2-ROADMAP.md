# Modelo de negocio v2 + experiencia — roadmap durable (parte de la deuda técnica Fase 5)

> **Origen:** sesiones de co-diseño con el fundador (2026-06-14). Decisión del
> fundador: *"toda esta conversación es parte de la deuda técnica, incorporarlo
> al plan"*. Este documento es la fuente durable en repo; el detalle estratégico
> completo vive en la memoria del asistente (`product-business-model-v2-2026-06-14`).
>
> **Modo de ejecución:** mismo modelo híbrido controlado de
> [`PHASE5-REMEDIATION.md`](./PHASE5-REMEDIATION.md) — un PR por bloque, TDD
> conductual, review adversarial + CI 21-verde → merge, tracker actualizado con
> `file:line`. Cada función entra DENTRO de su ola (no aparte). Reutilizar >
> construir; conectar módulos relacionados; UI/frontend donde se necesite;
> mejorar la calidad de lo existente paso a paso.

## Principio rector

Monetizar por **escala y conveniencia**, NUNCA por capacidad. Vida gratis
(ADR 0021), Zettelkasten gratis, inteligencia completa para registrados. De 10
funciones nuevas, solo **3 abren colecciones** (5 colecciones totales); el resto
reutiliza. El rename 11→7 *reduce* deuda (menos SKUs en las 2 tablas de precio).

## A. Planes: metales + la joya (7) — remapeo 11→7

| Plan | Proyectos | Dotación | Precio/mes | Módulo legal (auto) | Hoy era |
|---|---|---|---|---|---|
| Gratis | 1 | 3 personas | $0 | alerta si crece | gratis (baja de 10→3) |
| 🟤 Cobre *(nuevo)* | hasta 3 faenas | <25 por faena | ~$9.990 (overage) | — sin Comité por faena | — |
| ⚪ Plata | hasta 10 | 25–99 | ~$19.990 (overage) | **CPHS ≥25/faena** | comite-paritario |
| 🟡 Oro | hasta 50 | 100–499 | ~$79.990 (overage) | **DPRP ≥100** | departamento-prevencion |
| ⬜ Titanio | hasta 100 | 500–1.999 | ~$249.990 (sin overage) | todos + SSO | titanio |
| ◽ Platino | hasta 500 | 2.000–9.999 | ~$899.990 | todos + multi-tenant/Vertex/API/Analytics/Branding/CSM | diamante+empresarial+corporativo |
| 💎 Diamante *(joya)* | ∞ | ∞ | **100 UF** (~$3,9M) | todos, multi-país + residencia de datos | ilimitado+global-titanio |

Capacidades enterprise = **features**, no SKUs. Solo Diamante en UF. Anual ahorra
3 meses (×9 = 25% off; el backend ya soporta `cycle:'annual'`, falta el toggle UI).
Export de documentos = pago; documentos legales obligatorios = gratis.
**3 flujos de ingreso:** suscripción por escala · API/huella (B2D + firma WebAuthn
universal) · personalización/fashion (gemas + ballenas).

## B. Doble economía + identidad visual

- **Experiencia (XP)** — BLANCA borde DORADO — progresión/nivel, **no gastable**;
  ganada por capacitaciones + eventos de prevención que crean los jefes +
  instancias preventivas. Reutiliza `positiveXp` (chokepoint positive-only ya existe).
- **Gemas** (las "joyas") — VERDE AZULADO/teal — **moneda gastable**; ganada por
  participación + comprable por ballenas (dinero real). Se gasta en el sistema
  *fashion*. ⚠️ Nombrar la moneda **"Gemas"** en UI para no chocar con el plan
  Diamante. Reutiliza el patrón txn `gamificationBackend.awardPoints` (la XP de
  hoy NO es gastable → la gema es nueva).

## C. Funciones nuevas — reutilizar / colección / ola / skill

| # | Función | Reutiliza (file) | Colección nueva | Ola | Skill principal |
|---|---|---|---|---|---|
| 1 | Metales + Cobre + Diamante-UF + toggle anual | `pricing.ts`, `invoice.ts` (cycle ya existe), `currency.ts` | 0 | OLA 2 | tdd-guide, typescript-reviewer |
| 2 | **Gate por escala server-side** (report-only→enforce) | `requireTier.ts` (ya existe), `tierGatingGovernance.test`, `TIER-GATING-SERVER-SIDE-SPEC.md` | 0 | OLA 2 | security-reviewer, /cso-praeventio |
| 3 | Desbloqueo legal por dotación + alerta (CPHS 25/faena, DPRP 100) | `legalRuleEngine.ts` (reglas ya existen), SystemEngine `tierChangeReactivity`, `projects/{pid}/notifications` | 1 `legal_requirements` | OLA 2 | database-reviewer, tdd-guide |
| 4 | Página Departamento de Prevención | plantillas `Legal*.tsx` | 0 | OLA 3 | frontend-design, a11y-architect |
| 5 | CV portable + mostrar/ocultar por ítem | `portableHistoryExporter.ts`, `claims.ts`, patrón `visibility` (wallEngine) | 0 (campo user doc) | OLA 3 | tdd-guide, frontend-design |
| 6 | Soft-delete "cascarón" | `userLifecycle.deactivateUser`, MFA, audit inmutable, `portableHistoryExporter` | 1 `anonymization_events` | OLA 2 | security-reviewer, /cso-praeventio |
| 7 | Doble moneda + fashion + UGC + agente moderador | `awardPoints` (txn), `iapAdapter`, whitelist Gemini (`moderateImageUgc`) | 3 `cosmetics_*` | OLA 3/6 | security-reviewer, tdd-guide |
| 8 | **Widgets contextuales por menú** | 11 widgets dashboard, bus `system_events`, `CalmRecommendation` (Directiva 4) | **0** (tag `surface`) | OLA 3 | frontend-design, ui-ux-pro-max |
| 9 | Wellbeing filosofía + crisis/anti-suicidio | `WisdomCapsule` (semilla Sun Tzu), `AdviceBanner`, Karin/culturePulse | 0 | OLA 1/3 | a11y-architect, healthcare-reviewer |
| 10 | Residencia de datos por geolocalización | `locationNormativa` (detección país ya existe), regímenes privacidad | 0 (campo `regionCode`) | OLA 6/7 | architect, security-reviewer |

## D. Widgets contextuales (la inteligencia visible)

Inicio queda intacto. Cadena clima→calendario→tareas **VIVA**
(`calendarPreWarn.ts:142-301` avisa 24h antes; `Calendar.tsx:72-100` pinta forecast
3 días; `dailyClimateRiskScan` cron→nodos→FCM). Seam (80% reuse, 0 colecciones):
tag `surface:{menuModules[]}` en `RiskNodePayload` (`zettelkasten/types.ts:67-82`)
+ hook `useMenuInsights(módulo)` + `ContextualInsightCard` + `PageShell` (no existe
wrapper de página hoy). Pares: clima↔calendario VIVO; incidente→IPER/lección→capacitación
parcial; umbral-legal→obligaciones parcial; fatiga→asignación, MOC→recapacitación,
handover→turno, equipo-QR→brigada greenfield.

## E. Comunidad/Manager · Privacidad/mundo · Wellbeing

- **Comunidad/Manager:** métricas por proyecto (TRIR/LTIFR/DART en
  `safetyMetrics/osha.ts`) y comparador intra-empresa existen; cross-empresa +
  benchmarks + marketplace de procesos = greenfield (ola posterior). Data flywheel
  + moat de comunidad.
- **Cascarón (Ley 21.719, bloquea Apple):** anonimización irreversible a cascarón,
  conserva uid + historial inmutable, 2FA, username comunidad, export JSON/CSV antes.
- **Residencia por geo:** UE→UE, por país; **China DIFERIDO** (post-mundo, entidad/ICP).
- **Crisis/anti-suicidio:** hueco crítico — señalética calmada (Salud Responde),
  educativa, fuera del flujo de pánico (Directiva 4), sin diagnóstico (ADR 0012).

## F. Secuencia (atada a las olas)

1. Cascarón (bloquea Apple) + verificar cuenta Play = Organization. *(OLA 2)*
2. **Metales + Cobre + Diamante-UF + toggle anual + gate por escala server-side.** *(OLA 2)*
3. Desbloqueo legal por dotación + alerta + página DPRP. *(OLA 2→3)*
4. Crisis/anti-suicidio (señalética). *(OLA 1)*
5. Widgets contextuales por menú (empezar montando clima→calendario, ya vivo). *(OLA 3)*
6. CV trabajador (mostrar/ocultar + skills). *(OLA 3)*
7. Doble moneda + fashion + UGC + moderación. *(OLA 3/6)*
8. Wellbeing filosofía. *(OLA 3)*
9. Residencia por geo + Taiwán → mundo. *(OLA 6/7)*

## G. Impacto de deuda

Colecciones nuevas: **5 total** (legal_requirements, anonymization_events,
cosmetics×3) — cada una: regla + ≥5 rules-tests + Dirty Dozen. Widgets = 0
colecciones (extienden el bus existente). Invariantes: audit_logs awaited en todo
cambio de estado; vida NUNCA gated; paridad i18n es/en/pt-BR; `runTransaction` en
read-modify-write; identidad desde token.
