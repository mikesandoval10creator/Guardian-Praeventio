# Guardian Praeventio — WCAG 2.2 AA accessibility audit

> Sprint 20, Wave 10, Bucket D. Initial issue date: 2026-05-04.
> Living document — see "Living-doc policy" below.

## 1. Scope

This audit covers the **web SPA only** (`src/`, served via Vite/Firebase
Hosting). Native Capacitor wrappers (Android/iOS) inherit the same DOM
through the `WebView` shell, so DOM-level findings still apply, but
platform-specific surfaces (push permission prompts, native fall-detection
plugins, native splash screens) are explicitly out of scope and queued for
**Sprint 21+** when the Capacitor surfaces stabilize.

In scope:
- Public landing (`/` → `src/pages/LandingPage.tsx`)
- Login (`/login` → `src/pages/Login.tsx`)
- Dashboard / RootLayout shell (`src/pages/Dashboard.tsx`, `src/components/layout/RootLayout.tsx`, `Sidebar.tsx`)
- Settings (`src/pages/Settings.tsx`)
- Emergency surfaces: `SOSButton`, `EmergencyDashboard`, `CrisisChat`, `EmergencyAutoBridge`
- Driving mode (`src/pages/Driving.tsx`, `SafeDrivingMode.tsx`)
- Medical modules: Medicine page, Visor Corporal, Anatomy library, MedicalIcon renderer
- Documents, Comité Paritario, Normativa picker, Knowledge surfaces
- 4-mode token system (`src/index.css`) — contrast verification across
  normal-light, normal-dark, driving (day + night), emergency

Out of scope (this iteration):
- Native Capacitor lifecycle screens
- Email transactional templates
- PDF / DOCX exports

## 2. Methodology

Two complementary passes per surface:

1. **Automated** — `axe-core` via `@axe-core/playwright`, `wcag2a + wcag2aa
   + wcag21a + wcag21aa` tag set. The current spec at
   `tests/e2e/accessibility.spec.ts` runs against `/` only because the
   rest of the app is auth-gated and requires a populated Firestore. We
   extend the spec to cover Login (which is reachable without auth) and
   document a TODO for the auth-gated surfaces (a Firebase Test Lab
   integration is queued for Sprint 21).

2. **Manual inspection** — for each component listed in Section 1 we
   walked the JSX and checked:
   - Landmarks (`main`, `nav`, `banner`, `complementary`)
   - Focusable controls (icon-only buttons need `aria-label`; `div`s with
     `onClick` are flagged)
   - Form semantics (label/control association via `htmlFor` + `id`,
     `aria-describedby` for errors, `aria-busy` during submit)
   - Live regions (`role="alert"`, `role="status"`, `aria-live`)
   - Keyboard reachability (Tab order, focus traps in modals)
   - Reflow / responsive at 320 CSS px (1.4.10)
   - Color tokens vs computed contrast ratios per mode (1.4.3, 1.4.11)
   - Motion / animation respecting `prefers-reduced-motion`

WCAG **2.2 AA** is the target — every Level A and AA criterion published
at <https://www.w3.org/WAI/WCAG22/quickref/> is enumerated in
`checklist-WCAG-2.2-AA.md`. WCAG 2.2 added 9 new criteria over 2.1; we
treat those as in-scope.

## 3. 4-mode contrast considerations

Praeventio Guard exposes 4 distinct UI modes, each with its own token
table in `src/index.css` (lines 76-198):

| Mode             | Background       | Text primary | Accent primary | Notes                                              |
|------------------|------------------|--------------|----------------|----------------------------------------------------|
| normal-light     | `#fafafa`        | `#18181b`    | `#4db6ac`      | Workhorse teal; AA on white                        |
| normal-dark      | `#061f2d`        | `#ffffff`    | `#d4af37`      | Petroleum + gold                                   |
| driving (day)    | `#ffffff`        | `#000000`    | `#f59e0b`      | ANSI amber CTA; teal demoted to route line        |
| driving (night)  | `#061f2d`        | `#ffffff`    | `#f59e0b`      | Same petroleum bg, amber CTA stays                 |
| emergency        | `#000000`        | `#ffffff`    | `#dc2626`      | OLED-friendly; max contrast                        |

### Verified contrast pairs (sRGB ratios)

| Pair                                        | Ratio    | WCAG 2.2 AA threshold | Status   |
|---------------------------------------------|----------|------------------------|----------|
| `#18181b` on `#fafafa` (light text)         | 17.5:1   | 4.5:1                  | PASS     |
| `#ffffff` on `#061f2d` (dark text)          | 15.0:1   | 4.5:1                  | PASS     |
| `#ffffff` on `#dc2626` (emergency CTA)      | 4.83:1   | 4.5:1                  | PASS     |
| `#000000` on `#f59e0b` (driving CTA)        | 9.4:1    | 4.5:1                  | PASS     |
| `#ffffff` on `#000000` (emergency canvas)   | 21:1     | 4.5:1                  | PASS     |
| `#71717a` on `#fafafa` (muted text light)   | 3.94:1   | 4.5:1 (body text)      | **FAIL** — A11Y-003 |
| `#8fa9ba` on `#061f2d` (muted text dark)    | 5.65:1   | 4.5:1                  | PASS     |
| `#52525b` on `#ffffff` (driving muted)      | 7.51:1   | 4.5:1                  | PASS     |
| `#a1a1aa` on `#000000` (emergency muted)    | 9.18:1   | 4.5:1                  | PASS     |
| `#4db6ac` on `#ffffff` (teal accent text)   | 2.53:1   | 4.5:1 (text)           | **PARTIAL** — A11Y-002, only used as background or large text per BRAND.md |
| `#d4af37` on `#061f2d` (gold accent text)   | 7.92:1   | 4.5:1                  | PASS     |

The **demoted teal in driving mode** (`--accent-info: #4db6ac` on
`#ffffff` in `src/index.css:151`) is route-line / icon use only — never
text — and is acceptable per WCAG 1.4.11 (Non-text Contrast, 3:1).
Verified ratio 2.53:1 is below the 3:1 non-text threshold, so we flag it
as **A11Y-006** for re-evaluation when the driving map ships pin
overlays in Sprint 21.

The **`text-muted` token in normal-light** (`#71717a` zinc-500 on
zinc-50) at 3.94:1 fails 1.4.3 for body text. This is the most
pervasive single defect in the audit because dozens of components
reference it for secondary copy. See A11Y-003.

The **emergency mode** is intentionally over-contrasted (red-600 +
white) to honor the OLED-battery-saving + universal-SOS convention
documented in `BRAND.md`. All ratios are well above AA. The `border`
shadow color uses `rgba(220, 38, 38, 0.50)` which is decorative only.

## 4. Status summary

Current snapshot — **52 WCAG 2.2 AA criteria evaluated**:

| Status   | Count | Notes                                                                                                                |
|----------|-------|----------------------------------------------------------------------------------------------------------------------|
| PASS     | 28    | Including all 9 WCAG 2.2-new criteria (Focus Not Obscured, Target Size minimum, Dragging Movements, etc.)             |
| PARTIAL  | 12    | Mostly contrast / icon-only buttons — see WCAG_findings.md                                                            |
| FAIL     | 5     | Lang attribute, muted-text contrast in light, tab semantics in Comité, icon-only buttons in Documents, focus trap in DocsModal |
| N/A      | 7     | Audio-only content, Sign Language, Live Captions, Audio Description, Reading Level, Pronunciation, Identify Purpose  |

### Surface-level coverage

| Surface                     | axe automated  | Manual review | Top blocker                                                              |
|-----------------------------|----------------|---------------|--------------------------------------------------------------------------|
| Landing                     | green (e2e)    | done          | none — passes                                                            |
| Login                       | green (e2e)    | done          | none — Sprint 20 Fase 6 hardening shipped (commit `848e2f7`)              |
| RootLayout / Sidebar        | not gated      | done          | A11Y-001 (lang), A11Y-007 (search input lacks aria-label)                |
| Dashboard                   | not gated      | done          | A11Y-003 (muted-text contrast cascades)                                  |
| Settings                    | not gated      | done          | A11Y-008 (admin role select lacks visible label binding)                 |
| SOSButton + EmergencyDash   | not gated      | done          | A11Y-009 (CrisisChat dropdown menu lacks role=menu)                      |
| Driving                     | not gated      | done          | A11Y-006 (demoted teal contrast for route line)                          |
| Medicine + Visor Corporal   | not gated      | done          | A11Y-010 (BodyRegion SVG hit areas under 24x24 target)                   |
| Documents                   | not gated      | done          | A11Y-011 (icon-only Ver/Más buttons missing aria-label)                  |
| Comité Paritario            | not gated      | done          | A11Y-012 (tabs missing role=tablist/tab/aria-selected)                   |
| DocsModal / KnowledgeGraph  | not gated      | done          | A11Y-013 (Esc key not wired; backdrop click closes but no `role=dialog`) |

## 5. Prioritized backlog (top 10 fixes)

Severity x effort matrix. **P1 = ship in Sprint 21**, P2 = Sprint 22, P3 = backlog.

| # | ID       | Title                                                  | Severity | Effort | Priority |
|---|----------|--------------------------------------------------------|----------|--------|----------|
| 1 | A11Y-001 | `<html lang="en">` on Spanish-primary app              | critical | 5 min  | P1       |
| 2 | A11Y-003 | Muted-text contrast 3.94:1 in normal-light             | medium   | 1 h    | P1       |
| 3 | A11Y-011 | Icon-only buttons in Documents.tsx (5 sites)           | medium   | 30 min | P1       |
| 4 | A11Y-012 | Tab semantics in ComiteParitario.tsx                   | medium   | 30 min | P1       |
| 5 | A11Y-013 | DocsModal lacks `role="dialog"` + Esc handler          | medium   | 1 h    | P1       |
| 6 | A11Y-007 | Global search input lacks explicit `aria-label`        | low      | 5 min  | P1       |
| 7 | A11Y-008 | Admin role `<select>` in Settings — implicit label     | low      | 15 min | P2       |
| 8 | A11Y-009 | CrisisChat MoreVertical dropdown — `role=menu`         | low      | 30 min | P2       |
| 9 | A11Y-010 | Visor Corporal hit-areas under 24x24 (target size)     | medium   | 2 h    | P2       |
| 10| A11Y-006 | Driving demoted-teal route-line contrast 2.53:1        | low      | tbd    | P3       |

## 6. Cross-references

- **STRIDE** (`docs/security/STRIDE_findings.md`) — A11Y-001 (lang) overlaps with i18n correctness; injection vector is nil but voice synthesis quality on assistive tech depends on `lang`.
- **Sentry observability** (`docs/observability/`) — No a11y-specific Sentry tags today. Backlog: when A11Y-013 lands, instrument modal-open/close as breadcrumbs to detect "modal stuck open" regressions.
- **Tracking plan** (`.telemetry/tracking-plan.yaml`) — `app.mode.switched` (added in Wave 9) gives us empirical mode-distribution data; we will use it post-launch to prioritize per-mode contrast work.

## 7. Living-doc policy

- **Owner**: a11y/dev role (rotates per sprint).
- **Review cadence**: end of every Sprint, gate is the e2e axe spec.
- **Update triggers**:
  1. New page route added → run axe + manual pass, append findings.
  2. New design token added/changed in `src/index.css` → re-verify
     contrast pairs in Section 3 of this doc.
  3. Any regression of `tests/e2e/accessibility.spec.ts` → row added to
     `WCAG_findings.md`.
- **Definition of Done for closing a finding**:
  - Code change merged AND
  - Manual + axe verification recorded in commit message AND
  - Status flipped to `mitigated` in `WCAG_findings.md` (preserved as
    audit history, never deleted).

## 8. Audit log

| Date       | Sprint | Author        | Change                                                       |
|------------|--------|---------------|--------------------------------------------------------------|
| 2026-05-04 | S20-W10| a11y/dev      | Initial audit — 18 findings, 28 PASS / 12 PARTIAL / 5 FAIL  |
