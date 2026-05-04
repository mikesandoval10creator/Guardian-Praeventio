# ADR 0008 — DWG conversion via isolated LibreDWG Cloud Run service

* **Status:** Accepted (Sprint 21 Bucket Q)
* **Date:** 2026-05-04
* **Deciders:** Sprint 21 backend + legal working group
* **Related:** ADR 0002 (CAD viewer is MIT-only; no GPL contamination
  from libredwg-web).

## Context

ADR 0002 deferred DWG support to a server-side conversion step using
**ODA File Converter**, a closed-source binary distributed by the Open
Design Alliance. While ODA File Converter is free for individual use,
its redistribution license is restrictive enough that bundling it into
our Cloud Run image creates a recurring legal-review burden every time
we update the deploy pipeline. ODA also requires periodic license
acceptance and gates new versions behind ODA Membership tiers that
Praeventio Guard does not hold.

Meanwhile **GNU LibreDWG** (`dwg2dxf`) is a complete, actively
maintained, open-source DWG → DXF converter. The catch is its license:
**GPL-3.0-only**. Per ADR 0002 we cannot link GPL code (including via
WASM) into the Praeventio Guard frontend or backend Node bundle without
contaminating those bundles with GPL-3.0 obligations (full source
distribution of the entire derivative work).

The pivot in Bucket Q: **run LibreDWG in a separate, single-purpose
Cloud Run service that talks to the main app over HTTP.** Under
GPL-3.0, communication between independent programs over a network
protocol is "mere aggregation" (GPL-3.0 §0 / §5), not derivative work.

## Decision

DWG → DXF conversion is delegated to an isolated Cloud Run service
defined in `infra/dwg-converter/`:

* **Image** — a Debian Bookworm slim image that compiles LibreDWG 0.13.3
  from source, copies only `dwg2dxf` + `libredwg.so` into the runtime
  stage, and wraps it with a minimal Flask + gunicorn HTTP server
  (`server.py`). The image is built and pushed to `gcr.io/$PROJECT_ID/dwg-converter`.
* **Deployment** — `gcloud run deploy dwg-converter ...` with
  `--no-allow-unauthenticated` so the service is reachable only from
  inside our project. Runbook: `docs/dwg-converter-deploy.md`.
* **Boundary** — the main Praeventio Guard app talks to this service via
  `POST /convert` over HTTPS, authenticated with a static bearer token
  (`DWG_CONVERTER_TOKEN`). The main app never imports, links, or
  packages any LibreDWG code. The express route at
  `src/server/routes/cad.ts` is a thin proxy that forwards `inputUri`
  (a `gs://...` location) and returns `{ dxfUri, dxfSignedUrl, sha256 }`.
* **Frontend** — `src/services/cad/dwgAdapter.ts` (NEW, MIT) issues a
  signed PUT upload, calls the proxy, then fetches the resulting DXF
  text. The DXF is parsed by the existing MIT-only `dxf-parser` +
  `@mlightcad/three-renderer` pipeline. No GPL code is imported,
  bundled, or shipped to the client.
* **License hygiene** — the converter image is GPL-3.0-licensed in its
  entirety (header SPDX tags reflect this). Source is published under a
  matching license inside `infra/dwg-converter/`. The main repo
  remains MIT under its existing top-level LICENSE.

## Why the HTTP boundary keeps GPL contamination scoped to the converter image

GPL-3.0 §0 defines a "covered work" as the Program or any work based on
it. §5 requires the source of the entire covered work to be conveyed
when binaries are distributed. The accepted FSF interpretation
(reaffirmed in the LGPL/GPL FAQ) is that **two programs that
communicate over a network are not part of the same combined work**;
each is an independent program, and only the GPL'd program (here, the
LibreDWG container) carries the GPL-3.0 obligation.

This is the same architectural pattern used by:

* `gcc` — invoking it from a Makefile does not GPL the source you
  compile.
* PostgreSQL extensions over `libpq` — proprietary apps talking to a
  GPL'd database remain proprietary.
* ImageMagick / Ghostscript HTTP wrappers in cloud platforms.

We are **not** statically or dynamically linking LibreDWG into the
Praeventio Guard backend. We are **not** redistributing LibreDWG as part
of the Praeventio Guard binary. We exec a separate process (in a
separate container, in a separate Cloud Run service, with a separate
Git history if we choose) and exchange JSON over HTTPS. That
separation is the standard "aggregation, not derivation" pattern.

## Consequences

* The Praeventio Guard frontend and backend bundles remain 100% MIT/MPL
  licensable, and our app-store binary distributions stay clear of
  GPL-3.0 obligations.
* The `infra/dwg-converter/` image carries GPL-3.0 obligations: source
  must be published with any binary we distribute. Since we host it
  ourselves on Cloud Run and nobody downloads the binary, GPL-3.0 §6
  ("Conveying Non-Source Forms") is largely moot — but we publish the
  Dockerfile + server.py in this repo regardless, satisfying the
  "Corresponding Source" requirement on first principles.
* Operational cost is negligible: ~$0.0000004/conversion on Cloud Run
  Gen2 with 1Gi memory and `--min-instances=0`. A typical site visit
  with 5 floor plans converts in <10s and costs sub-cent.
* Cold-start adds ~3s on the first conversion after a quiet period.
  Acceptable because conversion is a foreground operation the user is
  already waiting on.
* Rotation: the `DWG_CONVERTER_TOKEN` is rotated on Sprint cadence; the
  converter image is rebuilt monthly to pick up Debian/LibreDWG
  security patches.

## Alternatives considered

* **ODA File Converter (ADR 0002 original plan).** Rejected — closed
  source, redistribution license is restrictive and version-pinned to
  ODA Membership tiers, recurring legal-review burden.
* **Bundle LibreDWG WASM into the frontend (`@mlightcad/libredwg-web`).**
  Rejected — see ADR 0002. WASM is "object code" under GPL-3.0; the
  bundle and any code that calls it inherit GPL obligations.
* **In-process child_process.spawn(`dwg2dxf`) inside the main backend
  container.** Rejected — putting the GPL'd binary into the same
  deployable image as the main backend creates a "combined work"
  argument. Some legal interpretations would require the entire backend
  source to ship under GPL-3.0. The HTTP-boundary approach removes the
  ambiguity.
* **Render DWG via Autodesk Viewer (3rd-party hosted).** Rejected
  primary path — leaks project-confidential blueprints to Autodesk and
  requires user accounts on their platform. Kept as a fallback
  recommendation in the user-facing banner.

## Cost estimate

* Cloud Run Gen2: 1 vCPU + 1 GiB / request, ~5s avg conversion.
  * vCPU-seconds: $0.0000240 × 5 = $0.00012
  * GiB-seconds:  $0.0000025 × 5 × 1 = $0.0000125
  * Requests:    $0.40 / 1M = $0.0000004
  * Total per conversion ≈ **$0.00013** (~13 millicents).
* GCS storage: DXF outputs auto-expire via lifecycle rule at 30 days,
  ~30 KB avg → negligible.
* Egress: signed-URL DXF download from same region as backend = $0.

A site with 100 plan uploads / month costs ~$0.013 to convert. Even
1000× that is well below noise on the GCP bill.
