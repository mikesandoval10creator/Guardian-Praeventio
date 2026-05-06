# /design-html — zero-deps Praeventio mockup

Translate a mockup brief (text description, screenshot URL, Figma export note)
into a single standalone HTML/CSS file using the Praeventio design system.

## Usage

```
/design-html "<mockup brief or URL>"
```

## Mandatory rules

1. **Read the design tokens first** — open `BRAND.md`, `src/index.css` (the
   `@theme` and `:root` blocks), and any `tailwind.config.*` if present.
   Honour the 4-mode role tokens (`--bg-canvas`, `--accent-primary`, etc.).
2. **Palette** — teal `#4db6ac` is the workhorse light primary (per
   `user_color_preferences`). Petroleum `#061f2d` and gold `#d4af37` for
   dark/prestige. Coral `#b66258` ONLY for alerts (demoted per memory).
3. **Output** — single `.html` file under
   `design-iterations/<slug>-<YYYYMMDD-HHmmss>.html`. Max 30 KB. CSS inline
   in a `<style>` block. JS only inline `onclick` if strictly needed.
4. **Zero new deps** — no CDN scripts, no external fonts beyond the Inter +
   JetBrains Mono pair already in `src/index.css` (acceptable to import via
   the same Google Fonts URL used in production).
5. **4-mode awareness** — if the mockup involves user-facing screens, include
   a `prefers-color-scheme: dark` media block AND a `.driving` / `.emergency`
   class swap if applicable.
6. **Boilerplate** — start from `templates/design-html-shell.html` and fill
   only the marked sections.
7. **Accessibility** — semantic HTML, AA contrast (use the role tokens, they
   are pre-validated), focus states visible.

## Output checklist

- [ ] Single self-contained HTML
- [ ] < 30 KB
- [ ] Uses role tokens, not raw palette values, in component CSS
- [ ] Teal primary in light, gold accent in dark
- [ ] Saved to `design-iterations/<slug>-<timestamp>.html`
- [ ] Echo path back to user

## When NOT to use

- For production React components → write JSX directly into `src/components`.
- For brand-heavy marketing pages → coordinate with design before iterating.

## Follow-up

Once the mockup is approved, translate to a JSX component per
`docs/dev-workflow/DESIGN_HTML_PATTERN.md`.
