# ADR 0025 — HRO mindfulness as design compass (Weick & Sutcliffe's 5 principles applied to Guardian)

Status: **Proposed** (2026-08-17)

## Context

Guardian Praeventio is an occupational risk-prevention platform whose first
purpose is to save lives (Ley 16.744, DS 54, DS 44, ISO 45001). The system is
designed around the conviction that the **accident that has not yet happened**
is the most important one to prevent — and that its precursors are visible
weeks or months in advance as weak signals (near-misses, SIF precursors,
unchanged-but-wrong procedures, ambiguity in role coverage, repeated small
exceptions that nobody escalated).

The platform already embodies several practices that High Reliability
Organizations (HRO — Weick & Sutcliffe, *Managing the Unexpected*; origin in
US Navy nuclear propulsion, aviation, air-traffic control) use to operate
with near-zero serious-incident rates in environments of high intrinsic
risk. **Formalising those practices as the design compass** for every new
feature does three things at once:

1. It gives reviewers and contributors a **shared criterion** for whether a
   new feature reinforces or erodes Guardian's reliability posture.
2. It connects the engineering work to a **proven organisational
   philosophy** that safety regulators, mutual-security bodies (ACHS,
   Mutual de Seguridad), and enterprise risk buyers already recognise.
3. It provides a **narrative for sales and trust**: Guardian is not "an
   app that records incidents" — it is an HRO-grade mindfulness
   infrastructure that makes the whole organisation more reliable.

This ADR proposes to **adopt Weick & Sutcliffe's five principles as a
non-binding design compass**, complementary to the existing
`life-safety-features-free-all-tiers` (ADR 0021) and the regulatory
compliance baseline (ISO 45001, DS 44, ISO 31000). It does not introduce a
new mandatory process; it makes the implicit explicit.

## Decision

Adopt the **five principles of HRO mindfulness** as the design compass for
every feature that touches the worker's reality (field data, alerts,
emergency, supervision, learning). The principles are not a checklist to
"tick off"; they are a lens to interrogate a feature design.

### Principle 1 — Preoccupation with failure

> Treat every near-miss, every anomaly, every "small" deviation as a window
> into a vulnerability that *will* become a serious incident if left alone.

**Where Guardian already does this:**
- `near-miss` is a first-class node type in the knowledge graph (see
  `docs/architecture-decisions/PLAN_MAESTRO_2026-Q3.md` block 469 "CV
  near-miss capture automático").
- SIF (Serious Injury or Fatality) precursors are tracked in
  `src/pages/Inbox.tsx` via the `SIFAlert` component and the `useSif`
  hook; the dedicated SIF precursors page was a deliberate mount of an
  orphaned feature (`docs/audits/branch-review/FULL-ANALYSIS.tsv`, PR
  `claude/ola1-sif-page`, 2026-06-14).
- The Vida-XX (`vida_safety`) module treats the absence of an event
  signal as a *symptom to investigate*, not as proof that everything is
  fine.

**Where to reinforce (open tickets):**
- `[P0] Notificaciones críticas pueden perderse o duplicarse (sin
  outbox transaccional)` — PR #1351 (already merged) and #1489 (just
  merged) made the critical-alert path transactional; the *weak signal*
  path (SIF precursors, near-miss escalations) still depends on a
  boolean flag and a noisy heartbeat. Aligning both paths is a future
  ticket.
- `[P0][VIDA] Emergencia automática por clima desconectada (sin
  productor de evento)` — the absence of a climate alert when one was
  expected is itself a signal worth raising.
- `[P1] Validación FÍSICA de funciones vitales (BLE/sensores/
  background/FCM/offline)` — not just "does the sensor fire?" but
  "what is the *absence* of a fire telling us about the worker's
  state?" (e.g. an immobile worker + missing accelerometer frames).

### Principle 2 — Reluctance to simplify

> Resist the temptation to collapse complex reality into a single number,
> a single metric, or a single "the risk is X" dashboard. The grafo
> tipado is already the embodiment of this principle.

**Where Guardian already does this:**
- The typed knowledge graph (`src/services/zk/edges.ts` with
  `EDGE_TYPES`, `src/services/zk/nodes.ts`) has 512 node types and a
  strict edge schema; reducing "the safety posture" to a single number
  is not possible without breaking the type system. This is
  intentional.
- The risk engine (`src/services/riskEngine`) computes risk per
  control/worker/context, not a single org-wide score.
- The `[Idea] Formalizar el modelo de barreras (queso suizo) con salud
  de barrera — Vision Zero` ticket explicitly refuses the Swiss-cheese
  collapse into "how many barriers failed?".

**Where to reinforce:**
- Refuse feature requests that read "give me one risk score for the
  whole company". The honest answer is "the system cannot produce that
  without lying; here are the five most material risks per project,
  here are their precursors, here is what changed this week."
- The `[P2] Falta un registro central de veracidad de capacidades`
  ticket (NOT to be tackled in this ADR, but linked) is *aligned* with
  this principle: declaring a capability as "implemented/configured"
  with no boolean shortcut forces the system to remain faithful to
  operational reality.

### Principle 3 — Sensitivity to operations

> Stay close to the reality of the floor. The worker reports, the system
> lives from the field, not from the office. The chain of insight flows
> **up** from the worker, not **down** from the supervisor.

**Where Guardian already does this:**
- Field workers are first-class nodes (not just "users"); they can
  report hazards, near-misses, and SIF precursors without supervisor
  permission.
- The Android foreground service (`src/services/mobile/fgsService.ts`)
  collects health-vitals data even when the app is in the background;
  the data sovereignty ADR (0012-health-data-sovereignty-no-diagnosis)
  ensures the platform never invents a diagnosis from below.
- Geofence and SOS are *worker-initiated* with `[Vida-XX]`. The system
  does not need a manager's click to trigger the emergency path.

**Where to reinforce:**
- The `[Idea][VIDA] Mecánicas cooperativas 'proteger al de al lado'`
  ticket captures the HRO principle that *the peer closest to the
  anomaly is the first responder of the system* — not the hierarchy.
- The `[Idea] Ciencia conductual para adopción de hábitos de
  seguridad` ticket should be evaluated against this principle: does
  the proposed nudge respect the worker's autonomy (sensitivity) or
  does it produce surveillance optics (loss of preoccupation + false
  sense of simplicity)?

### Principle 4 — Commitment to resilience

> Prepare for the unexpected; recover fast when it happens. The system
> degrades — it does not crash — and degraded service is *honest
> service* (no setTimeout + fake success).

**Where Guardian already does this:**
- `ADR 0019-ai-quota-resilience-strategy.md` documents a five-tier
  cascade (Gemini → SLM → RAG → canned) when AI quota is exhausted;
  the platform never silently fabricates a non-answer.
- The Android FGS health PR (#1481) makes the foreground service
  permissions and battery-optimization exclusions *honest*: the user
  sees when protection is degraded, and the deploy does not go green
  while a vital background service is silently killed.
- The `[P0] Alertas vitales pueden no quedar provisionadas y el
  deploy sigue verde` ticket is the *exact* failure mode HRO Principle
  4 forbids: a "success" deploy that quietly dropped life-safety
  provisioning.
- The mesh (capacitor-mesh plugin) is the runtime embodiment of
  "the system degrades, it does not crash": when a phone loses signal,
  the store-carry-forward ticket (`[P0][VIDA] Mesh no implementa
  store-carry-forward`) keeps the SOS local until a peer reappears.

**Where to reinforce:**
- Every new "happy path" feature MUST be paired with at least one
  **degraded-path test** that asserts the user is told the truth
  about what just happened (no `success: true` + mock timeout).
- Resilience patterns from `ADR 0019` (cascading fallbacks) should
  become the *default* for new AI-touching features, not a special
  opt-in.

### Principle 5 — Deference to expertise

> When the unexpected happens, the decision migrates to whoever knows
> best in that moment — regardless of formal rank. The worker on the
> floor, the brigade chief at the scene, the safety lead with the
> actual context.

**Where Guardian already does this:**
- The SOS path is *worker-initiated*; the chain of escalation is
  configurable (supervisor → gerente → prevencionista) but the
  trigger does not require any of them.
- The Zettelkasten (`src/services/zk`) explicitly stores who-said-what-
  with-what-evidence, so expertise is surfaced as data, not as
  hierarchy.
- The `[P1][seguridad] ERP no falla cerrado por tenant/rol/plan` ticket
  (PRs #1491+) is the operational embodiment of this principle at the
  administrative layer: only the person who actually owns the
  integration can trigger it, never a generic role.

**Where to reinforce:**
- The `[Idea] Deferencia a la expertise — micro-roles de campo`
  ticket (not yet created) should map **field realities** (brigade
  chief on scene, lone-worker with first-aid training, prevention
  advisor with site-specific knowledge) as roles that *temporarily*
  override the formal hierarchy for the duration of an incident.
- Permission UX decisions (`src/services/geofence/permissionUXDecision.ts`)
  should defer to the worker when the worker has the local context
  and the system does not.

## Consequences

### Positive

- **Review criterion**: when a contributor proposes a feature that
  weakens any of the five principles (e.g. "let's auto-resolve near-
  miss reports older than 30 days" weakens Preoccupation with
  failure), reviewers can cite this ADR.
- **Sales narrative**: the platform can credibly say it operates
  under HRO mindfulness, which is a recognised organisational
  standard that ACHS / Mutual de Seguridad / SUSESO buyers already
  audit against.
- **Vision-Zero alignment**: HRO and Vision Zero are siblings; this
  ADR makes the engineering posture align with the regulatory
  ambition.
- **ZK as the memory that makes mindfulness possible**: the
  Zettelkasten is the *organisational memory* that HRO requires to
  operate (Weick & Sutcliffe emphasise that mindfulness without
  memory collapses into improvisation). The `[Idea] Zettelkasten
  como memoria organizacional HRO` ticket (not yet created) should
  articulate this link formally.

### Negative / risks

- The principles are **non-binding by design**; if they become a
  mandatory gating checklist, they will be ticked-off rather than
  used as a lens. This is the same anti-pattern as compliance
  theatre.
- The wording ("mindfulness", "preoccupation with failure") can read
  as soft / corporate-spirituality to a sceptical engineer. We use
  the operational definitions (above) in code review, not the
  marketing names.

### Neutral

- This ADR **does not change the tech stack**, the CI ratchets, the
  plan tiers, the legal posture, or the Notion ticket status of any
  existing ticket. It is a *framing* ADR that future reviews cite.
- It does **not create new mandatory tests**; reviewers are
  *encouraged* to ask "which HRO principle does this PR reinforce or
  weaken?" but they are not required to add a test for the principle
  itself.

## Mapping table (initial — to be expanded in follow-up ADR per feature area)

| Feature / ticket                                                  | P1 Preoccupation | P2 Reluctance | P3 Sensitivity | P4 Resilience | P5 Deference |
|-------------------------------------------------------------------|:---:|:---:|:---:|:---:|:---:|
| SOS / ManDown (ADR 0021 free tier)                                | ✓ | ✓ | ✓ | ✓ | ✓ |
| SIF precursors page (claude/ola1-sif-page PR)                    | ✓ |   | ✓ |   |   |
| Critical-alert outbox (PR #1351, #1489)                          | ✓ |   |   | ✓ |   |
| Foreground service health (PR #1481)                              | ✓ |   |   | ✓ |   |
| Mesh store-carry-forward (P0 ticket pending)                      | ✓ |   | ✓ | ✓ |   |
| Geofence privacy consent (PR #1479, Ley 21.719)                   |   | ✓ | ✓ |   |   |
| Zettelkasten (typed graph, 512 nodes)                              |   | ✓ | ✓ |   | ✓ |
| AI quota cascade (ADR 0019)                                        | ✓ |   |   | ✓ |   |
| ERP fail-closed (PR #1491+)                                        | ✓ |   |   | ✓ | ✓ |
| PGP disclosure key (PR #1490)                                      | ✓ |   |   |   |   |
| Vision Zero barriers (Spec'd ticket)                              | ✓ | ✓ |   | ✓ |   |
| Cooperative peer-protection (Idea ticket)                          |   |   | ✓ | ✓ | ✓ |

This table is **illustrative**, not exhaustive. New features should
appear in it; features that weaken a principle should be challenged.

## References

- Weick, K. E., & Sutcliffe, K. M. (2007, 2nd ed.). *Managing the
  Unexpected: Resilient Performance in an Age of Uncertainty*. Jossey-Bass.
- Origin domains: US Navy nuclear propulsion (USS *Nautilus*
  onward), commercial aviation, air-traffic control.
- `docs/architecture-decisions/0021-life-safety-features-free-all-tiers.md`
  (complementary — defines the *commercial* layer below which
  life-safety is sacred).
- `docs/architecture-decisions/0024-retention-by-default-no-discretionary-deletion.md`
  (complementary — the HRO Principle 1 in retention form: never
  delete the evidence of a near-miss).
- `docs/architecture-decisions/PLAN_MAESTRO_2026-Q3.md` blocks 465–484
  (current operationalisation of the principles).
- Vision Zero (Swedish Transport Administration / EU-OSHA) — the
  public-policy sibling of HRO.
- ISO 45001:2018 §6.1.2 (hazard identification and assessment of
  risks and opportunities) — regulatory sibling.

---

**Proposed, awaiting review.** Not yet linked from `CLAUDE.md` (no
process change required); suggested for citation in
`docs/architecture-decisions/INDEX.md` once accepted.