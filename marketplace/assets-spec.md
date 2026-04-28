# Marketplace assets — required image specs & content brief

> **Scope of this file:** specifications for design work. Actual asset creation (PNG/JPG/MP4) is OUT OF CODE SCOPE — design team produces, dev wires file paths into manifest.json + listing form.
> **Recommended repo location:** `public/marketplace/` (served as static assets by Vite, accessible at `https://app.praeventio.net/marketplace/<filename>`).
> **Brand:** primary palette in `tailwind.config.*` if exists; otherwise design team picks Praeventio palette (azul institucional + amarillo seguridad).

---

## Required assets

### 1. App icon — 128×128

| Property | Value |
|----------|-------|
| Dimensions | 128 × 128 px (exact) |
| Format | PNG with transparency |
| File path | `public/marketplace/icon-128.png` |
| Marketplace URL | `https://app.praeventio.net/marketplace/icon-128.png` |
| Max file size | 1 MB |

**Content brief:** the Praeventio shield/scudo icon-only (no wordmark). Iconographic mark only — Google rejects logos with text inside the icon when used in Marketplace + OAuth contexts.

**TODO (design):** create from existing logo assets in `public/icons/` if available, else net-new design.

---

### 2. App icon — 32×32 (favicon-class)

| Property | Value |
|----------|-------|
| Dimensions | 32 × 32 px |
| Format | PNG with transparency |
| File path | `public/marketplace/icon-32.png` |
| Use | List view in Marketplace, browser tabs |

**Content brief:** simplified version of the 128×128 — at this size, fine details are lost; use a 1-2 element silhouette of the shield only.

---

### 3. App icon — 96×96 (Web app listings)

| Property | Value |
|----------|-------|
| Dimensions | 96 × 96 px |
| Format | PNG with transparency |
| File path | `public/marketplace/icon-96.png` |

**Content brief:** intermediate version. Web app listings (Chrome Web Store-class surfaces) sometimes pull this size.

---

### 4. App icon — 48×48

| Property | Value |
|----------|-------|
| Dimensions | 48 × 48 px |
| Format | PNG with transparency |
| File path | `public/marketplace/icon-48.png` |

**Content brief:** Workspace app launcher tile. Critical because Workspace admins see this every day after install — make it instantly recognizable.

---

### 5. OAuth Consent Screen logo — 120×120

| Property | Value |
|----------|-------|
| Dimensions | 120 × 120 px (exact) |
| Format | PNG with transparency |
| File path | `public/marketplace/oauth-logo-120.png` |
| Use | Shown on every OAuth consent dialog the user sees |

**Content brief:** same iconographic mark as #1; the size delta (128 vs 120) is a Google quirk — submit the 120 specifically to OAuth Consent Screen.

---

### 6. Application card banner — 220×140

| Property | Value |
|----------|-------|
| Dimensions | 220 × 140 px (exact) |
| Format | PNG (no transparency required) or JPG |
| File path | `public/marketplace/banner-220x140.png` |
| Use | Marketplace listing card thumbnail (the 'tile' users see when browsing) |

**Content brief:** show the product, not the logo. Recommended: dashboard screenshot of the IPER module or the Knowledge Graph 3D view, with the wordmark "Guardian Praeventio" overlaid bottom-left in white. Background: dark navy (matches industrial / SST aesthetic).

---

### 7. Screenshots — 1280×800 (1 to 5 images)

| Property | Value |
|----------|-------|
| Dimensions | 1280 × 800 px (exact) |
| Format | PNG or JPG |
| Count | 1 minimum, 5 maximum |
| File paths | `public/marketplace/screenshot-1.png` … `screenshot-5.png` |
| Use | Listing detail page carousel |

**Content brief — recommended set of 5:**

1. **`screenshot-1.png` — IPER asistido por IA.** Capture of the IPER form with the AI sidebar showing 3-4 relevant suggested hazards (use Spanish-CL labels: "Riesgo de caída", "Atrapamiento", etc.). Caption overlay (optional): "IPER asistido por IA — sugerencias contextuales de riesgo".

2. **`screenshot-2.png` — Calendario predictivo.** Calendar view showing 12 months populated with auto-scheduled committee meetings + ODI sessions + drills, color-coded by category. Caption: "Calendario que cumple solo — DS 54 + ODI + ISO 45001".

3. **`screenshot-3.png` — Knowledge Graph 3D.** The Zettelkasten 3D view with nodes for DS 54, Ley 16.744, ISO 45001 visibly clustered. Caption: "Normativa SST navegable — 6 países + ISO 45001".

4. **`screenshot-4.png` — Modo Crisis / dashboard.** Real-time worker headcount post-seismic-alert, evacuation route overlay on faena floorplan. Caption: "Modo Crisis — head-count en 90 segundos, gratis para siempre".

5. **`screenshot-5.png` — Pricing & 10-tier dashboard.** Screenshot of the `/transparencia` page showing the bucket calculator. Caption: "Multi-país sin recargo. Salvaguarda de vida gratis. Siempre.".

**TODO (design + product):** capture from staging environment with seeded demo data. Use the test account `marketplace-demo@praeventio.net`.

---

### 8. Promo video (optional but recommended)

| Property | Value |
|----------|-------|
| Format | YouTube unlisted link, embeddable |
| Length | 30-90 seconds |
| Resolution | 1080p minimum |
| Caption track | Spanish-CL + English (auto-translate disabled, hand-curated) |
| URL field | `https://www.youtube.com/watch?v=XXXXXXXXXXX` |

**Storyboard brief:**

- **0:00-0:05** — Faena minera vista aérea; texto: "Cada accidente laboral en Chile cuesta $50M CLP en promedio."
- **0:05-0:15** — Cut a prevencionista en oficina con planilla Excel; texto: "El compliance no debería ser una hoja de cálculo."
- **0:15-0:35** — Demo rápido: IPER con IA, REBA on-device, Calendar predictivo, Modo Crisis.
- **0:35-0:50** — "Multi-país sin recargo. ISO 45001 como fallback global. Soberanía de datos en Santiago."
- **0:50-1:00** — Logo Praeventio, "soporte@praeventio.net", "Instalar gratis en Google Workspace".

**TODO (design + marketing):** out of scope for code. Recommend studio quote post-MVP.

---

## File path inventory (for manifest.json wiring)

```
public/marketplace/
├── icon-128.png
├── icon-96.png
├── icon-48.png
├── icon-32.png
├── oauth-logo-120.png
├── banner-220x140.png
├── screenshot-1.png
├── screenshot-2.png
├── screenshot-3.png
├── screenshot-4.png
└── screenshot-5.png
```

These are referenced from:
- `marketplace/manifest.json` — `branding.iconUrl`, `branding.promoBannerUrl`.
- `marketplace/oauth-consent-screen.md` — Field 3 (App logo).
- The Marketplace SDK Listing form (manual upload at submission time).

---

## Pre-submission asset checklist

- [ ] All PNGs at exact pixel dimensions (Google's validator is strict; off-by-one rejects).
- [ ] All PNGs under 1 MB.
- [ ] App icons have no embedded text (wordmark-free).
- [ ] Screenshots show real product UI, not mockups (Google rejects vector mockups).
- [ ] Spanish-CL captions where applicable (our market is Chile).
- [ ] No PII / real worker names / real company logos in screenshot data — use seeded demo accounts.
- [ ] Banner does not exceed 30% text coverage (Google's "no billboard" rule).
- [ ] Video on a YouTube channel owned by the same Google account submitting the listing (not a personal account).

---

## TODOs flagged for the user

1. **Design team to produce all assets above.** Out of code scope.
2. **Decide:** do we want the promo video for v1, or ship without and add at v1.1? Recommendation: ship without; add when we have a real customer happy to be filmed.
3. **Once assets exist:** drop them in `public/marketplace/` and they will be served at `https://app.praeventio.net/marketplace/<filename>` automatically by Vite static handling. No code change needed.
4. **Verify domain `app.praeventio.net` resolves and serves these assets** before referencing them in `manifest.json` — Google's validator dereferences the URLs and fails if 404.
