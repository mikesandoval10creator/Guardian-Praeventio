# PERFORMANCE — Runbook

Operational runbook for the Lighthouse + size-limit budget pipeline.

The strategic rationale lives in the top-level [`PERFORMANCE.md`](../../PERFORMANCE.md);
this file is the on-call companion: how to read CI failures, how to fix them,
and what the policy is for adding new lazy-loads.

---

## Targets (current)

Defined in `lighthouserc.json`. Tightened in Sprint 20 tenth wave (PR #38, Bucket Perf C):

| Metric | Threshold | Severity |
| --- | --- | --- |
| Performance score | ≥ 0.85 | warn |
| Accessibility score | ≥ 0.90 | warn |
| Best Practices | ≥ 0.90 | warn |
| SEO | ≥ 0.90 | warn |
| PWA | ≥ 0.70 | warn |
| First Contentful Paint | ≤ 2 000 ms | warn |
| Largest Contentful Paint | ≤ 2 200 ms | warn |
| Cumulative Layout Shift | ≤ 0.1 | warn |
| Total Blocking Time | ≤ 200 ms | warn |
| Speed Index | ≤ 3 000 ms | warn |
| Time to Interactive | ≤ 3 500 ms | warn |
| Unused JavaScript | ≤ 80 KB | warn |
| Total byte weight | ≤ 1.5 MB | warn |
| Render-blocking resources | ≤ 500 ms | warn |

All assertions are `warn` (not `error`) until we have at least 4 consecutive
green Lighthouse runs in main. Promotion to `error` is tracked in `ROADMAP.md`
under the "perf-bar promotion" milestone.

Bundle-size budgets (gzipped, defined in `.size-limit.json`):

| Bundle | Limit | Notes |
| --- | --- | --- |
| `index-*.js` (main) | 300 KB | Entry chunk; trimmed by lazy-loads. |
| `vendor-react-*` | 100 KB | React core + router + scheduler. |
| `vendor-firebase-*` | 250 KB | Client SDK only. |
| `vendor-three-*` | 600 KB | Three.js + react-three-fiber/drei. |
| `vendor-mediapipe-*` | 400 KB | Vision/camera/WASM workers. |
| `vendor-viz-*` | 300 KB | d3 + recharts + framer-motion + gsap. |
| `vendor-sentry-*` | 150 KB | Sentry browser SDK. |
| `vendor-gantt-*` | 150 KB | Lazy-loaded with planning routes. |
| `RiskNetwork-*.js` | 400 KB | Soft cap on the largest lazy chunk. |
| `index-*.css` | 120 KB | Tailwind purge guard. |

---

## Lazy-load policy

A library or component should be lazy-loaded if **all** of the following hold:

1. It is not needed for first paint (Login, RootLayout shell, AppProviders).
2. It is not used during the auth flow.
3. The compressed weight is ≥ 20 KB OR it pulls a heavy transitive graph.
4. There is a clear seam — a single component, modal, or event handler that
   can dynamically import.

Conversely, do NOT lazy-load:

- React core, router, or scheduler — pinned to `vendor-react`.
- `framer-motion` — used by RootLayout, headers, banners; cost is per-import.
- Anything used inside the very first `useEffect` of `RootLayout`.

### Currently lazy

| Library / Component | Loaded by | Sprint / commit |
| --- | --- | --- |
| `react-force-graph-3d` | `KnowledgeGraph` (Risks page) | 2da ola Eta — `52ab7f0` |
| `jspdf` (Risks export) | `KnowledgeGraph` | 2da ola Eta — `52ab7f0` |
| `tesseract.js` | `DocumentOCRManager` | 2da ola Eta — `71d190a` |
| `@huggingface/transformers` | `slmWorker` (Web Worker) | 5ta ola Sigma — `ccc1fdf` |
| `onnxruntime-web` | `slmWorker` (Web Worker) | 2da ola Epsilon — `388eb89` |
| All route components | `App.tsx` `React.lazy()` | pre-Sprint-20 |
| `AsesorChat` | `RootLayout` via `AsesorChatLazy` | **10ma ola Bucket C — this PR** |
| `html2canvas` + `jspdf` (PredictiveAnalysis export) | `PredictiveAnalysis.handleDownloadPDF` | **10ma ola Bucket C — this PR** |

The full historical list is reconstructable from `git log --grep "lazy"`.

---

## Bundle analysis howto

```bash
npm run build
ls -la dist/assets/*.br | sort -k5 -nr | head -20
```

Key files to inspect:

- `dist/assets/index-*.js` — main entry. Should stay below 200 KB brotli.
- `dist/assets/vendor-*.js` — vendor chunks. See the table above for ceilings.
- `dist/assets/<RouteName>-*.js` — per-route chunks. Anything > 100 KB
  brotli is a candidate for further splitting.

To find which chunks pull a specific dependency:

```bash
grep -l '<dep-marker>' dist/assets/*.js | sort
```

Where `<dep-marker>` is something distinctive from the dep — e.g. `html2canvas`
or `react-markdown`. If main shows up in the list, the dep is in the entry
chunk and is a lazy-load candidate.

---

## Tracking + monitoring

- **Lighthouse CI** — `.github/workflows/perf.yml` runs on every PR to
  `main` and on every merge. Three runs per PR; median is asserted. Reports
  are uploaded to LHCI temporary public storage (URL printed in action log).
- **Sentry performance** — `vendor-sentry` is bundled with browser and
  React tracing. Performance transactions are sampled at 10 % in production.
  Surface large regressions via the Sentry "Performance" tab on the
  `praeventio` project.
- **size-limit** — runs in the same workflow; PR comments quote the delta
  per bundle.

---

## Regression process

When a PR exceeds budget the action fails:

1. **Bundle-size regression** (red row in the size-limit comment):
   - Run `npm run size` locally to confirm.
   - Identify the new dep / change with `git diff` plus the bundle analysis
     howto above.
   - Fix in priority order: (a) remove the dep, (b) lazy-load it, (c) move
     it to a vendor chunk if all routes need it. Only after (a)-(c) fail,
     justify the regression in the PR description.

2. **Lighthouse regression** (failing assertion):
   - Open the LHCI report URL printed in the action log.
   - Identify the failing metric — LCP, TBT, CLS, or unused-js are the
     usual suspects.
   - Apply the relevant remediation from the top-level `PERFORMANCE.md`
     "How to fix regressions" section.

3. **If the regression is genuinely justified** (e.g. shipping a critical
   feature that adds bytes):
   - Tag `@perf-owners` and document root cause + user impact + a tracking
     issue with owner + target date in the PR description.
   - A perf-owner adds the `perf-waiver` label, which records the failure
     without blocking merge.
   - Bypasses auto-expire after the next quarterly calibration; the
     regression must be paid back or the budget officially raised.

Default answer: fix the regression. Bypasses are rare.

---

## Calibration cadence

- **Quarterly** — re-baseline against production p75 metrics. Tighten any
  threshold by 5-10 % where the median has improved consistently for
  4+ weeks.
- **After major dep upgrades** (React, Vite, Tailwind majors) — re-run
  Lighthouse against staging and update both `lighthouserc.json` and
  `.size-limit.json` in the same PR.
- **When a new lazy-load lands** — update the "Currently lazy" table
  above.
