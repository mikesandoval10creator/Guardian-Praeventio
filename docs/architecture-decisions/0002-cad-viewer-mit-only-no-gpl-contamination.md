# ADR 0002 — CAD viewer is MIT-only; no GPL contamination from libredwg-web

* **Status:** Accepted (Sprint 17a)
* **Date:** 2026-05-02
* **Deciders:** Sprint 17a frontend + legal working group
* **Related:** ADR 0001 (organic collections), Round 19 R2 (Gemini-first
  productive AI runtime).

## Context

Praeventio Guard ships a "Visor de Planos CAD" page (formerly "Visor
AutoCAD") that lets supervisors load architectural plans on-site so that
IPER risk zones can be overlaid on top. Two facts shape the licensing
posture for this feature:

1. **AutoCAD is an Autodesk trademark** and DWG is a binary format whose
   reverse-engineered specification is owned by Autodesk. Praeventio
   does NOT hold a commercial AutoCAD license, so we must avoid both
   the trademark in user-facing copy and any logic that would legally
   imply we render Autodesk's proprietary binary format on our own.
2. **The most popular open-source DWG implementation, GNU LibreDWG, is
   licensed GPL-3.0.** Any frontend that statically links a GPL
   dependency contaminates the entire bundle with GPL-3.0 obligations
   (full source distribution including any proprietary stack we ship
   on top of it). This is incompatible with shipping Praeventio Guard
   as a closed-source SaaS / mobile binary.

The npm registry surfaces wrappers that look attractive at first
glance — `@mlightcad/libredwg-web` and `@mlightcad/libredwg-converter`
declare permissive licenses on their own `package.json`, but they
**transitively bundle libredwg compiled to WASM**. Including either of
those packages in `src/` would re-introduce the GPL contamination we
are trying to avoid.

## Decision

The CAD viewer frontend is **MIT/MPL-only**. Concretely:

* The DXF parser remains `dxf-parser` (MIT, already in `dependencies`).
* The 2D/3D renderer is `@mlightcad/three-renderer` (MIT, 0 GPL
  transitive deps). It is a thin Three.js wrapper that consumes the
  drawable shape produced by our adapter
  (`src/services/cad/dxfAdapter.ts`), so the integration boundary is
  small and any future renderer swap stays contained.
* **DWG support is deferred to a server-side conversion step.** A new
  endpoint, `POST /api/cad/convert-dwg`, accepts an uploaded DWG file
  and (in Sprint 18) shells out to **ODA File Converter** — a free
  closed-source binary distributed by the Open Design Alliance — to
  emit DXF that is then streamed back to the client. ODA File Converter
  runs only on our servers; we never distribute it to the client, which
  keeps both Autodesk's trademark and the converter's redistribution
  terms cleanly outside our shipped bundle.
* **`@mlightcad/libredwg-web` and `@mlightcad/libredwg-converter` are
  banned from `src/` and `package.json` in perpetuity.** A grep guard
  in CI (Sprint 17a verification step) enforces this.

The user-facing page name drops the "AutoCAD" trademark and is
labeled "Visor de Planos CAD". A banner explains that DWG support is
coming and recommends Autodesk DWG TrueView as the free, official
fallback for the meantime.

## Consequences

* Users with `.dwg` files must currently export to `.dxf` from their
  CAD program (`Save As → DXF`) before uploading. This is one extra
  step but is universally supported.
* The Sprint 18 server-side converter requires ODA File Converter on
  the deploy image. We will host it on Cloud Run with min-instances=0
  so cold-start is paid only when a DWG is actually uploaded.
* The frontend bundle stays compatible with permissive-only licensing
  audits and our app-store binary distributions.
* The renderer wire-up is incremental: Sprint 17a lazy-loads
  `@mlightcad/three-renderer` and falls back to inline SVG when the
  module is unavailable; a full Three.js scene wire-up lands in
  Sprint 17b once the package surface is stable across the team.

## Alternatives considered

* **`dxf-viewer` (MPL-2.0, vagran).** Rejected — same scope as our
  current `dxf-parser` + SVG fallback (DXF only, no DWG path), and
  introducing it would not reduce the work for the DWG story we
  actually need. We can revisit in a future sprint if `dxf-parser`
  hits a wall on edge-case entities.
* **`@mlightcad/libredwg-converter` (declares MIT in its
  `package.json`).** Rejected — bundles libredwg WASM transitively,
  which is GPL-3.0. Declaring MIT at the wrapper layer does not
  launder the upstream license.
* **Render DWG directly with our own WASM port.** Rejected — high
  engineering cost, no business value over the ODA File Converter
  server-side path, and risks re-deriving Autodesk's binary format
  in code we own.
* **Outsource viewing to Autodesk Viewer (free).** Rejected as the
  primary path — requires user accounts on Autodesk's platform and
  would leak project blueprints to a third party. Kept as a
  fallback recommendation in the banner.
