# 0003 — Medical iconography: Bioicons primary, BioRender exploratory only

- Status: Accepted
- Date: 2026-05-02
- Sprint: 17c
- Deciders: Praeventio core (D. Sandoval) — Gemini-first stack
- Supersedes: —
- Related: ADR-0002 (CAD viewer MIT-only), Sprint 16 Gemini-first UI plan

## Context

The medical, occupational-health, and EPP modules need a recognisable
biology / clinical glyph vocabulary (lungs, syringe, N95, harness, etc.)
that the rest of the app can reuse. Three candidate sources were on the
table:

1. **BioRender** — broad, polished biology library. Requires a paid
   *Publication License* before any of its assets may ship inside a
   commercial closed-source SaaS such as Praeventio. We do **not** hold
   that license today.
2. **Bioicons** (https://bioicons.com, GitHub `duerrsimon/bioicons`) —
   community-curated SVG library, each icon distributed under one of
   `CC0`, `CC-BY-4.0`, or `MIT`. All three are compatible with closed
   commercial use.
3. **Bespoke illustrations** — design-time custom artwork. Highest
   quality control, but at least an order of magnitude more expensive
   per glyph and slower to ship.

The frontend stack is already MIT/CC0/CC-BY pure (cf. ADR-0002 — no GPL
contamination), and Sprint 17 explicitly forbids new npm packages.

## Decision

Adopt **Bioicons as the primary medical icon source**, shipped as a
**static SVG subset** under `public/icons/biology/`, addressed through a
small registry (`src/services/medical/iconLibrary.ts`) and rendered by a
single React component (`src/components/medical/MedicalIcon.tsx`).

Concrete shape:

- Curated subset of ~33 icons spanning categories `anatomy`, `organs`,
  `ppe`, `pharma`, `instruments`, `rehabilitation`, `injuries`.
- Each registry entry carries `{ name, publicPath, license, category,
  attribution? }` so the UI can decide where attribution must appear.
- `MedicalIcon` defaults to `graceful=true`: missing icons render a
  tinted placeholder square instead of throwing, so a not-yet-curated
  glyph never crashes a page during the staged rollout.
- A prepared but currently no-op `MedicalIconAttribution` component
  renders the CC-BY footer once any CC-BY icon enters the registry.
- BioRender is **not** integrated in production. The BioRender MCP
  remains acceptable as an *exploratory* / design-time research tool
  only; nothing it produces ships in the bundle.

## Consequences

**Positive**

- Zero new npm dependencies — icons are static assets served by Vite.
- License hygiene preserved: initial subset is 100 % CC0, no
  attribution required for the v1 rollout.
- Single chokepoint (`MedicalIcon`) lets us swap, lazy-load, or tint
  every glyph from one place.
- Graceful default keeps the staged rollout safe: modules can reference
  icon names that have not yet been curated without runtime errors.

**Negative**

- Initial 33 SVGs ship as hand-written placeholders matching the final
  Bioicons names. They must be replaced by the real Bioicons SVGs in a
  follow-up curation pass (download via `gh api` from
  `duerrsimon/bioicons` once the curation list is locked).
- If we later admit CC-BY icons, every page rendering them must mount
  `MedicalIconAttribution`; the component is prepared but tracking the
  mount points becomes a checklist item.
- BioRender remains attractive for outreach material; teams must
  remember it cannot be embedded in product without a paid license.

## Alternatives considered

- **Direct CDN (`https://bioicons.com/...`)** — rejected: cross-origin
  costs at runtime, hard dependency on an external host, breaks offline
  / Capacitor builds.
- **Clone full Bioicons repo (~80 MB)** — rejected: bloats the working
  tree and the bundle; we only need a fraction of the glyphs.
- **BioRender embed** — rejected: licensing (Publication License is
  paid; redistribution inside a closed SaaS is out of scope of the free
  tier).
- **Custom illustrations** — rejected for v1 on cost/time grounds; may
  revisit per-module if a Bioicons glyph proves visually inadequate.

## Verification

- `npm run typecheck` clean on `dev/sprint-16-gemini-first-ui-2026-05-04`.
- `ls public/icons/biology | wc -l` returns 33.
- `grep -r "@biorender\|biorender.com" src/` returns nothing other than
  documentation comments.
