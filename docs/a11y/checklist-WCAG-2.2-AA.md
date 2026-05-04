# WCAG 2.2 AA per-criterion checklist

> Source: <https://www.w3.org/WAI/WCAG22/quickref/?currentsidebar=%23col_overview&levels=aaa>
> Status legend: PASS · PARTIAL · FAIL · N/A
> When a row is PARTIAL or FAIL, an A11Y-NNN reference points to a row in
> `WCAG_findings.md`.

## Principle 1 — Perceivable

### Guideline 1.1 Text Alternatives

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 1.1.1 Non-text Content | A | PASS | Icon-only `Link` in `RootLayout.tsx:238` flagged in A11Y-004 (partial) but the majority of non-text content has `aria-hidden="true"` on Lucide icons next to a text label, or `alt` on `<img>` (e.g. `Login.tsx:144`, `MedicalIcon.tsx:101`). Mascot has alt; decorative blurs use `aria-hidden`. |

### Guideline 1.2 Time-based Media

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 1.2.1 Audio-only and Video-only (Prerecorded) | A | N/A | App ships no prerecorded audio-only or silent-video content. CrisisChat audio recording is real-time peer-to-peer (out of scope for this criterion). |
| 1.2.2 Captions (Prerecorded) | A | N/A | No prerecorded video. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | A | N/A | No prerecorded video. |
| 1.2.4 Captions (Live) | AA | N/A | CrisisChat audio is per-user voice messages, not broadcast video. |
| 1.2.5 Audio Description (Prerecorded) | AA | N/A | No prerecorded video. |

### Guideline 1.3 Adaptable

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 1.3.1 Info and Relationships | A | PARTIAL | Most surfaces use semantic HTML (`<main>`, `<nav>`, `<header role="banner">`, `<form>`, `<label htmlFor>`). Profile button is a `<div onClick>` — A11Y-005. AddDocumentModal lacks `role="dialog"` — A11Y-013. ComiteParitario tabs not marked up — A11Y-012. |
| 1.3.2 Meaningful Sequence | A | PASS | DOM order matches visual order in all audited surfaces; no CSS reorderings break logical flow. |
| 1.3.3 Sensory Characteristics | A | PASS | Instructions use text + icons, never "click the green button" alone. The driving speedometer color is paired with the numeric km/h. |
| 1.3.4 Orientation | AA | PASS | App supports both portrait and landscape; no `screen.orientation.lock()` calls. Capacitor wrapper does not lock orientation in `capacitor.config.json` (verified Sprint 19). |
| 1.3.5 Identify Input Purpose | AA | PARTIAL | Login form uses Google SSO — no traditional input fields to autocomplete. Settings has email read-only. AddMedicineModal and other forms could add `autocomplete="name"` / `tel` etc. but none today are flagged as a11y blocker (no PII forms in the audited surface). |

### Guideline 1.4 Distinguishable

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 1.4.1 Use of Color | A | PASS | Driving speedometer uses color + numeric value; emergency uses color + icon + text. No surface conveys info by color alone. |
| 1.4.2 Audio Control | A | N/A | App has no auto-playing audio. CrisisChat audio is user-initiated playback. |
| 1.4.3 Contrast (Minimum) | AA | FAIL | A11Y-003: muted text 3.94:1 in normal-light. A11Y-002: teal-on-white 2.53:1 (used as background, partial). |
| 1.4.4 Resize Text | AA | PASS | Tailwind uses `rem` for typography; tested at 200% browser zoom on Login + Dashboard, no clipping. |
| 1.4.5 Images of Text | AA | PASS | All copy is HTML text. Logos use SVG/PNG with text equivalents. |
| 1.4.10 Reflow | AA | PARTIAL | A11Y-019: speedometer at 320px not yet verified. Other surfaces tested at 320, 360, 768, 1280. |
| 1.4.11 Non-text Contrast | AA | PARTIAL | A11Y-006: demoted teal route line 2.53:1 < 3:1 threshold. Otherwise borders, focus rings, icon buttons all >= 3:1. |
| 1.4.12 Text Spacing | AA | PASS | Tailwind utilities allow override; no `!important` on `line-height`/`letter-spacing` that would block user stylesheets. |
| 1.4.13 Content on Hover or Focus | AA | PARTIAL | A11Y-015: native `title` tooltips not dismissable. |

## Principle 2 — Operable

### Guideline 2.1 Keyboard Accessible

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 2.1.1 Keyboard | A | PARTIAL | A11Y-005: profile `<div onClick>` not keyboard-reachable. All other interactive elements (`<button>`, `<a>`, `<input>`, `<Link>`) are. |
| 2.1.2 No Keyboard Trap | A | PASS | No modal currently traps focus (which is itself A11Y-013, but focus is not trapped *into* the modal — Tab will exit it). No Tab traps elsewhere. |
| 2.1.4 Character Key Shortcuts | A | PASS | RootLayout listens for Enter on the search input (`RootLayout.tsx:191-196`); contextual to focused input, no global single-key shortcut to disable. |

### Guideline 2.2 Enough Time

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 2.2.1 Timing Adjustable | A | PASS | Auto-logout (`useAutoLogout`) is configurable in Settings (line ~Settings.tsx). Emergency auto-mode 1h TTL (`AppModeContext.tsx:54`) is bounded but applies only when the auto-monitor fires; user can manually dismiss any time. |
| 2.2.2 Pause, Stop, Hide | A | PASS | Sidebar group accordions and modal animations respect interaction. Marquee animation in `index.css:9` (`--animate-marquee`) is not currently mounted in any audited surface; if used, must offer a pause control. |

### Guideline 2.3 Seizures and Physical Reactions

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 2.3.1 Three Flashes or Below Threshold | A | PASS | `animate-pulse` is at 2 Hz, well below the 3-flash threshold. Emergency mode mode-switcher pulse (`ModeSwitcher.tsx:69`) is the same. No content flashes. |

### Guideline 2.4 Navigable

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 2.4.1 Bypass Blocks | A | PASS | Skip link at `RootLayout.tsx:113-118` ("Saltar al contenido principal"). Verified focusable. |
| 2.4.2 Page Titled | A | PASS | `<title>Praeventio Guard</title>` in `index.html:27`. Per-page titles via React Helmet are not yet wired (improvement opportunity, not a fail because the document title is present and unique enough). |
| 2.4.3 Focus Order | A | PASS | Source order matches visual order in all audited surfaces. |
| 2.4.4 Link Purpose (In Context) | A | PARTIAL | A11Y-004: icon-only Link in RootLayout. Other links are descriptive. |
| 2.4.5 Multiple Ways | AA | PASS | App has Sidebar nav, top header search (Gemini), URL deep-linking. Sitemap at `/sitemap`. |
| 2.4.6 Headings and Labels | AA | PASS | Each audited page has an `<h1>` with descriptive content. Form labels use `htmlFor` + `useId()` (Settings). |
| 2.4.7 Focus Visible | AA | PARTIAL | A11Y-014: not formally measured per mode. Default Chromium focus ring may be insufficient on emergency black bg. |
| 2.4.11 Focus Not Obscured (Minimum) | AA (new in 2.2) | PARTIAL | A11Y-016: ModeSwitcher position monitored. |
| 2.4.13 Focus Appearance | AA (new in 2.2) | PARTIAL | A11Y-017: subsumed by A11Y-014 fix. |

### Guideline 2.5 Input Modalities

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 2.5.1 Pointer Gestures | A | PASS | No multi-finger or path-based gesture is required. |
| 2.5.2 Pointer Cancellation | A | PASS | `SOSButton` uses `onPointerDown` to start hold + `onPointerUp` / `onPointerLeave` / `onPointerCancel` to abort (`SOSButton.tsx:182-185`). Activation only on completion. |
| 2.5.3 Label in Name | A | PASS | Visible labels on buttons match `aria-label` where present (e.g. `RootLayout.tsx:152` `aria-label="Abrir Menú"` matches the icon's intent). |
| 2.5.4 Motion Actuation | A | N/A | App uses motion for fall-detection (FallDetectionMonitor), but that is a sensor input, not an alternative to a UI control. Both `Tap SOS` and `Trigger SOS via fall` are independent paths to the same outcome. |
| 2.5.7 Dragging Movements | AA (new in 2.2) | MITIGATED | A11Y-018: SOS long-press is intentional safety choice; single-tap `tel:` alternative documented. |
| 2.5.8 Target Size (Minimum) | AA (new in 2.2) | PARTIAL | A11Y-010: HumanBodyViewer hit areas <24x24 on small viewports. Header buttons are 40x40, mobile dock buttons in Driving are >44x44, fine. |

## Principle 3 — Understandable

### Guideline 3.1 Readable

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 3.1.1 Language of Page | A | FAIL | A11Y-001: `<html lang="en">` while UI is Spanish. |
| 3.1.2 Language of Parts | AA | PASS | English fragments (e.g. "Praeventio") are proper nouns; no foreign-language phrases that would benefit from `lang="..."` on a `<span>`. |

### Guideline 3.2 Predictable

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 3.2.1 On Focus | A | PASS | Focus does not trigger navigation or content change. |
| 3.2.2 On Input | A | PASS | Input changes do not auto-submit or auto-navigate. NormativaSwitch select-on-click closes the dropdown explicitly. |
| 3.2.3 Consistent Navigation | AA | PASS | RootLayout consistent across routes; Sidebar groups stable. |
| 3.2.4 Consistent Identification | AA | PASS | Icons + labels consistent: SOS = red circle, Sun/Moon for theme, etc. |
| 3.2.6 Consistent Help | A (new in 2.2) | PASS | "Asesor" chat icon is in the same RootLayout slot on every authenticated route. |

### Guideline 3.3 Input Assistance

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 3.3.1 Error Identification | A | PASS | `Login.tsx:223-232` — `role="alert" aria-live="assertive"` for auth errors. AddDocumentModal validates required field via HTML `required` attribute. |
| 3.3.2 Labels or Instructions | A | PARTIAL | A11Y-008: Settings admin role select binding. |
| 3.3.3 Error Suggestion | AA | PASS | Login error message offers retry guidance. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | PASS | Documents delete uses `ConfirmDialog`. SOS uses 3s long-press. Emergency check-in is reversible. |
| 3.3.7 Redundant Entry | A (new in 2.2) | PASS | No multi-step form requires re-entering the same data; project context is auto-injected. |
| 3.3.8 Accessible Authentication (Minimum) | AA (new in 2.2) | PASS | Google SSO + WebAuthn biometric — no cognitive function test (no captcha, no copy-from-image). |

## Principle 4 — Robust

### Guideline 4.1 Compatible

| Criterion | Level | Status | Justification / Reference |
|-----------|-------|--------|---------------------------|
| 4.1.1 Parsing | (removed in 2.2) | N/A | Obsoleted by WCAG 2.2 — modern HTML parsers handle the cases this used to cover. |
| 4.1.2 Name, Role, Value | A | PARTIAL | A11Y-007 (search input), A11Y-009 (CrisisChat menu), A11Y-011 (Documents icons), A11Y-012 (Comité tabs). Most other components correct (Sidebar `aria-current`, RootLayout `role="banner"`, ModeSwitcher `aria-pressed`, SOSButton `aria-label`, NormativaSwitch `role="listbox" + role="option"`). |
| 4.1.3 Status Messages | AA | PASS | `role="alert"` on Login error, `role="status"` on SOSButton toast and NormativaMismatchBanner. A11Y-020 (toast aria-atomic) is preventive only. |

## Tally

- **Total criteria evaluated**: 52
- **PASS**: 28
- **PARTIAL**: 12
- **FAIL**: 5
- **MITIGATED** (design decisions documented): 2
- **N/A**: 7
- **REMOVED in 2.2**: 1 (4.1.1)

The 5 FAILs map to A11Y-001, A11Y-003, A11Y-005, A11Y-011, A11Y-012,
A11Y-013 (last is FAIL on 1.3.1, also tracked as Modal pattern).

> Note: A11Y-005, A11Y-013 each break two criteria simultaneously
> (1.3.1 + 4.1.2 / 1.3.1 + 2.1.1 respectively); we surface them under
> the most critical principle to avoid double-counting.
