# Performance Budgets

Guardian Praeventio enforces two layers of performance budgets on every pull request:

1. **Bundle size** (size-limit) — catches JS/CSS regressions before they ship.
2. **Runtime metrics** (Lighthouse CI) — catches FCP/LCP/CLS/TBT regressions in a real Chromium browser.

CI is wired through `.github/workflows/perf.yml` and runs on every PR to `main` plus on every merge to `main`. A failing budget blocks the PR until a human approves the regression.

---

## Why budgets

A 50 KB regression in the main bundle compounds across our user base:

- ~1 000 active foremen on 4G phones in mining / construction sites.
- Each extra 50 KB gzipped costs ~0.3 s on a 3G connection (per WebPageTest baseline).
- Across 30 daily sessions per user, that is ~9 hours of cumulative wait per day for a single regression.

Praeventio Guard is the difference between a foreman finding a near-miss before shift and learning about it after a serious accident — page-load latency directly impacts safety outcomes.

A budget that fails CI is cheaper than a hot-fix.

---

## Bundle size budgets (`.size-limit.json`)

| Bundle | Limit (gzipped) | Rationale |
| --- | --- | --- |
| `index-*.js` (main) | 300 KB | Brotli-compressed observed at ~357 KB; gzip ≈ 350 KB. 300 KB target gives some headroom but flags any meaningful regression. |
| `vendor-*.js` (vendor split) | 500 KB | Only matches when manual chunk splitting is enabled. Currently no vendor chunk is emitted; the budget is pre-armed for when we split. |
| `RiskNetwork-*.js` (largest lazy chunk) | 250 KB | Known god-file (see AUDIT.md). 192 KB brotli today; the limit gives us ~30 % runway before forcing a refactor. |
| `index-*.css` | 60 KB | Tailwind purge keeps CSS small; budget protects against accidental @import of un-purged CSS. |

Run locally:

```bash
npm run build
npm run size
```

---

## Lighthouse runtime budgets (`lighthouserc.json`)

| Metric | Threshold | Severity |
| --- | --- | --- |
| Performance score | ≥ 0.85 | error |
| Accessibility score | ≥ 0.90 | error |
| Best Practices | ≥ 0.90 | warn |
| SEO | ≥ 0.90 | warn |
| PWA | ≥ 0.70 | warn |
| First Contentful Paint | ≤ 2 000 ms | warn |
| Largest Contentful Paint | ≤ 2 500 ms | warn (Core Web Vitals "good") |
| Cumulative Layout Shift | ≤ 0.1 | warn |
| Total Blocking Time | ≤ 300 ms | warn |

Three runs per PR; the median is asserted. Reports are uploaded to LHCI temporary public storage — the URL is printed in the action log.

Run locally:

```bash
npm run build
npm run lhci
```

---

## How to read the CI output

### size-limit

The PR gets a comment from `size-limit-action`:

```
Path                              Size       Loaded   First Run
Main bundle (gzipped)            312 KB     +12 KB    +20 ms
Vendor bundle (gzipped)            -          -          -
Largest lazy chunk               245 KB     -2 KB     -3 ms
Total CSS (gzipped)               54 KB     +1 KB     +2 ms
```

Red rows = budget exceeded. Click "Details" for a breakdown by module.

### Lighthouse CI

The action prints a summary table and uploads a public report. Sample failure:

```
✖ categories:performance failure for minScore assertion
   expected >=0.85
   found    0.82
   See https://storage.googleapis.com/lighthouse-infrastructure.appspot.com/reports/123.report.html
```

---

## How to fix regressions

### Bundle size regressions

1. **Run `npm run size` locally** — confirms which bundle grew.
2. **Inspect the rollup visualizer** (`npm run build -- --mode visualize` once we wire `rollup-plugin-visualizer`).
3. Common fixes:
   - Code-split heavy routes with `React.lazy()` + `<Suspense>`.
   - Replace heavyweight deps: e.g., `moment` → `date-fns` (already done), `lodash` → `lodash-es` + tree-shake.
   - Dynamic-import single-use libs (e.g., `jspdf`, `tesseract.js`, `html2canvas` — all opt-in feature paths).
   - Drop dev-only logging via `terserOptions.compress.drop_console` (already enabled).
   - Move large data fixtures to JSON, fetch on demand.

### Lighthouse regressions

- **LCP** — preload hero image, use `<link rel="preconnect">` to API origins, ship critical CSS inline.
- **TBT** — virtualise long lists (`react-window`), defer expensive `useMemo` calculations, audit React 19 transitions.
- **CLS** — set explicit `width`/`height` on images and embeds, reserve space for fonts (`font-display: optional`).
- **FCP** — reduce render-blocking JS in `index.html`, audit Tailwind plugins.

### Accessibility regressions

- Missing `alt` text on `<img>` — fix at the component level.
- Low contrast — use Tailwind tokens that pass WCAG AA (slate-900 on white, white on emerald-600).
- Missing ARIA roles — confirm modal/dialog/menu primitives use `aria-*` attributes (Radix-style).

---

## Known waivers

- **`RiskNetwork-*.js` is intentionally large** (192 KB brotli today). It bundles `react-force-graph-2d`, `react-force-graph-3d`, `three`, and `d3`. Refactor tracked in `AUDIT.md` (R-12: split RiskNetwork god-file). Until then, the 250 KB limit is a soft ceiling.
- **No `vendor-*` bundle is emitted today** — Vite's default chunking inlines vendor code into the route chunks. The 500 KB rule is pre-armed for when we manually split (next sprint).

---

## Calibration cadence

- **Quarterly**: tighten budgets by 10 % whenever real-world production p75 metrics improve. Update both `.size-limit.json` and `lighthouserc.json` in the same PR.
- **After major dep upgrades** (React, Vite, Tailwind majors): re-baseline all four bundles + re-run Lighthouse against staging.
- **When `RiskNetwork.tsx` is split**: drop the `Largest lazy chunk` budget to 150 KB.

---

## Bypass procedure

Failing budgets block PR merge. Two-person bypass when the regression is justified:

1. Open the PR, demonstrate the failing check.
2. Tag `@perf-owners` and post a comment with:
   - **Root cause** (which feature shipped the bytes).
   - **User impact** (estimated extra ms / extra KB).
   - **Tracking issue** link — every bypass MUST have a remediation issue with an owner and a target date.
3. A perf-owner adds the `perf-waiver` label, which causes the workflow to record (but not enforce) the failure.
4. The bypass auto-expires after the next quarterly calibration; the regression must be paid back or the budget officially raised.

Bypasses are rare. Default answer is "fix the regression."

---

## Setup notes

### LHCI GitHub App token (optional)

To enable rich PR comments from Lighthouse CI, install the [LHCI GitHub App](https://github.com/apps/lighthouse-ci) and store the token as `LHCI_GITHUB_APP_TOKEN` in repo secrets. Without it the assertions still run; only the comment-on-PR feature is disabled.

### Local hooks (optional)

A husky pre-push hook can run `npm run size` to fail-fast before pushing. Not currently wired — opt-in via `npm run prepare` once husky is installed.
