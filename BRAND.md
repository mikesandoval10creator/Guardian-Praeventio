# Guardian Praeventio — Brand & 4-Mode Color System

This document is the source of truth for the color system. All app code
should reference **semantic role tokens** (`--bg-canvas`,
`--accent-primary`, ...) — never raw hex values, never raw palette
classes like `bg-teal-400`. Raw classes are tolerated only on the
public marketing landing (`src/pages/LandingPage.tsx`), which is
pre-login and SEO-fixed to `normal-light`.

## 1. The Four Modes

Each mode is a distinct cognitive profile, not a theme.

| Mode | Bg | Primary | Warning | Hazard | Why |
|---|---|---|---|---|---|
| `normal-light` | `zinc-50` `#fafafa` | teal-400 `#4db6ac` | amber-500 `#f59e0b` | red-600 `#dc2626` | Daily comfort, low cognitive load, medical trust. |
| `normal-dark`  | petroleum-800 `#061f2d` | gold-400 `#d4af37` | amber-500 `#f59e0b` | red-500 `#ef4444` | OLED-friendly luxury, gold = prestige restraint. |
| `driving`      | white (day) / petroleum-800 (night), auto-detected | amber-500 `#f59e0b` (signal-grade ANSI) | red-600 `#dc2626` | red-700 `#b91c1c` | Glanceable, low distraction, automotive convention. Teal demoted to "secondary route line" only. |
| `emergency`    | `#000000` | red-600 `#dc2626` (SOS universal) | amber-500 | white | OLED battery save, max contrast, red = unambiguous urgency. Auto-activates: company emergency, adverse climate, sismo. Auto-deactivates after 1 h. User-dismissible. |

Modes are mounted as a class on `<html>`:

- `:root` (no class) → `normal-light`
- `.dark` → `normal-dark`
- `.driving` → driving day; with `@media (prefers-color-scheme: dark)` and no `.driving-force-day` it flips to driving-night
- `.emergency` → emergency

Modes never stack — `AppModeContext` removes other classes before
applying the current one.

## 2. Color Theory — Split-Complementary

The brand sits on a split-complementary harmony anchored in a single
hue, with two structural neutrals.

| Role | HSL | Hex | Function |
|---|---|---|---|
| Teal (primary, light) | `hsl(173, 41%, 51%)` | `#4db6ac` | Caballito de batalla. Calm, medical, trustworthy. |
| Gold (primary, dark)  | `hsl(46, 65%, 52%)`  | `#d4af37` | Prestige restraint on OLED black. |
| Petroleum (structural) | `hsl(202, 76%, 10%)` | `#061f2d` | Deep neutral; never used as accent. |
| Coral (complement, accent only) | `hsl(8, 41%, 53%)` | `#b66258` | Reserved for narrow emphasis (charts, illustrations). |
| Amber (signal, driving + warning) | `hsl(38, 92%, 50%)` | `#f59e0b` | Ergonomic ANSI signal hue. |
| Red (hazard, emergency) | `hsl(0, 73%, 50%)` | `#dc2626` | Universal SOS. |

Teal ↔ coral are direct complements (≈ 180° on the wheel). Gold sits
~120° from teal, giving the dark mode a triadic feel without leaving
the brand axis. Petroleum is teal's deepest cousin (same hue, ~10%
luminance) — using it for surfaces guarantees harmony with the primary.

## 3. Decision Tree — When to Use Which Mode

```
┌─ Is this an active emergency (auto-trigger or user choice)?
│      └─ yes → emergency
│
└─ Is the user driving / commuting / phone-mounted?
       │
       ├─ yes → driving (auto day/night via prefers-color-scheme)
       │
       └─ no  → normal
                ├─ appearance = light → normal-light
                ├─ appearance = dark  → normal-dark
                └─ appearance = auto  → follows prefers-color-scheme
```

Only `mode` and `appearance` are persisted (`localStorage` key
`gp.appmode.v1`). Emergency state is **never** persisted — a hard
reload always returns to `normal`.

## 4. Using Semantic Tokens

Always reach for the role, not the palette.

```tsx
// Good — semantic, mode-aware
<div
  className="rounded-xl p-4"
  style={{
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    boxShadow: '0 4px 12px var(--shadow-color)',
  }}
>
  <button
    style={{
      backgroundColor: 'var(--accent-primary)',
      color: 'var(--accent-on-primary)',
    }}
  >
    Confirmar
  </button>
</div>
```

```tsx
// Bad — hard-codes a single mode and breaks driving / emergency.
<div className="bg-white text-zinc-900 border-zinc-200">
  <button className="bg-teal-400 text-white">Confirmar</button>
</div>
```

### The role token vocabulary

| Token | Use |
|---|---|
| `--bg-canvas` | The page-level background. |
| `--bg-surface` | Cards, panels, the next layer above canvas. |
| `--bg-elevated` | Modals, popovers, the floating layer. |
| `--text-primary` | Headlines, body copy. |
| `--text-secondary` | Subdued labels still meant to be read. |
| `--text-muted` | Hints, captions, metadata. |
| `--accent-primary` | The single CTA color of the mode. |
| `--accent-on-primary` | Text/icon color on top of `--accent-primary`. |
| `--accent-warning` | Pre-failure attention (amber). |
| `--accent-hazard` | Failure / harm (red). |
| `--accent-success` | Confirmed safe state. |
| `--accent-info` | Neutral / informative. In driving, this is the demoted teal. |
| `--border-default` | Default card / input borders. |
| `--border-strong` | Pressed, focused, active. |
| `--border-subtle` | Dividers, faint grid lines. |
| `--shadow-color` | Pass to `box-shadow` so elevation tints match the mode. |

### Hardcoded hex — when?

Almost never. The two exceptions:
1. The public landing (`LandingPage.tsx`) — pre-login, SEO-fixed.
2. The teal/petroleum/gold scale variables in `:root` (`--color-teal-400`, ...) — those are the palette itself.

If you find yourself writing a hex inside a feature component, you are
either redefining a role (extend this doc and the CSS) or shipping a
bug.

## 5. Switching Modes Programmatically

```tsx
import { useAppMode } from '@/contexts/AppModeContext';

function MyButton() {
  const { mode, setMode, dismissEmergency } = useAppMode();
  // ...
}
```

The `<ModeSwitcher>` component in `src/components/shared/ModeSwitcher.tsx`
is the canonical UI entry point and is mounted as a floating dock in
`RootLayout`.

## 6. Future Work

- **Real driving UI** — full-screen route guidance, voice-only flows, larger touch targets. Today only the color profile flips; the layout doesn't.
- **Real emergency UI** — overlay with SOS, evac map, contacts. The existing `EmergencyOverlay` and `EmergencyContext` (`src/contexts/EmergencyContext.tsx`, `src/components/shared/EmergencyOverlay.tsx`) need to bridge into `AppModeContext` so company-declared emergencies promote the UX mode automatically.
- **Sensor integration** — `src/services/emergency/autoTrigger.ts` ships with conservative `false`-returning predicates. Wire each to its real source (sensors, weather backend, Firestore emergency_events) per the comments in that file.
- **Persisted appearance schedule** — currently `appearance: 'auto'` follows OS preference; the older `ThemeContext` had hourly day/night logic that we may want to subsume.

This brand system is the foundation the rest of the design system
builds on. Extend it; don't bypass it.
