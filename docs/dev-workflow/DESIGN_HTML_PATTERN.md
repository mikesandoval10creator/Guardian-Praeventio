# DESIGN_HTML pattern

A pirate replica of `gstack /design-html` for Praeventio. Produces a single
self-contained HTML/CSS file (< 30 KB, zero deps) so we can iterate visually
on a mockup before committing to a React component.

## When to use

- Exploring a new screen or component layout.
- Sharing a quick visual with the team without spinning up the full app.
- Iterating fast on micro-interactions or state-machine layouts (driving,
  emergency) before locking JSX.

## When NOT to use

- For real production UI → write a React component directly under
  `src/components/<area>` with Tailwind v4 classes.
- For brand-heavy marketing pages or pitch decks → coordinate with design.
- For anything that needs router state, store, or hooks → it stops being a
  mockup; jump straight to JSX.

## Workflow

1. Run `/design-html "<brief>"`.
2. Output lands at `design-iterations/<slug>-<timestamp>.html`. Open it in a
   browser (it's stand-alone) and iterate.
3. When approved, translate to a JSX component:
   - Move the `<style>` block contents into Tailwind utility classes (or a
     scoped `.module.css` if dynamic) — role tokens already map 1:1 with the
     tokens declared in `src/index.css`.
   - Replace inline `onclick` with proper React event handlers.
   - Preserve the 4-mode awareness by keeping `dark:`, `.driving`, `.emergency`
     class swaps consistent with `BRAND.md`.
4. Delete the HTML iteration once the component lands (or move it to
   `design-iterations/_archive/` for history).

## Hard rules

- Single file. Inline CSS in `<style>`. No external scripts.
- Stay under 30 KB.
- Use the role tokens (`--accent-primary`, `--bg-surface`, …), not raw
  palette values, in your component CSS — that's what keeps light, dark,
  driving and emergency modes aligned.
- Palette mandate (per `user_color_preferences`):
  - Light primary: teal `#4db6ac` (caballito de batalla).
  - Dark accent: gold `#d4af37`.
  - Structural: petroleum `#061f2d`.
  - Coral `#b66258` is **alerts only** — never primary.

## Boilerplate

Start from `templates/design-html-shell.html`. It already includes:

- The full `:root` + dark + driving + emergency token blocks.
- Inter / JetBrains Mono via Google Fonts (same imports as production).
- Marked sections for component-local styles and mockup body.

## Translating to JSX (cheat-sheet)

| HTML iteration | React equivalent |
| --- | --- |
| `<style> .card { background: var(--bg-surface) } </style>` | `<div className="bg-[var(--bg-surface)] dark:bg-[var(--bg-surface)] …">` |
| `class="driving"` body | `<DrivingModeProvider>` from `src/contexts/UxModeContext` |
| inline `onclick="alert('x')"` | `onClick={() => …}` handler |
| Google Fonts `<link>` | already loaded globally in `src/index.css` |

## Inspirations

- gstack `/design-html` slash command (the original we're replicating).
- Praeventio `BRAND.md` cognitive rationale for the 4 modes.
