// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.5 â€” B2D Normativa API.
//
// Mounted via `app.use('/api/b2d/v1/normativa', normativaRouter)`.
//
// Endpoints:
//   â€¢ GET  /api/b2d/v1/normativa/search        â€” full-text search
//   â€¢ GET  /api/b2d/v1/normativa/by-id/:id     â€” fetch by id
//   â€¢ POST /api/b2d/v1/normativa/validate      â€” compliance gap check
//
// Reuse: `src/services/normativa/countryPacks.ts` (CL/PE/CO/MX/AR/BR/ISO).
//
// Privacy boundary: all data here is the public regulation catalogue. No
// tenant compliance state ever touches this API.

import { Router } from 'express';
import { z } from 'zod';

import { b2dAuth } from '../../middleware/b2dAuth.js';
import { trackB2dUsage } from '../../../services/b2d/usage.js';
import {
  COUNTRY_PACKS,
  type CountryCode,
  type Regulation,
} from '../../../services/normativa/countryPacks.js';

const router = Router();

const VALID_COUNTRIES: CountryCode[] = ['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'ISO'];

function isCountry(value: string): value is CountryCode {
  return (VALID_COUNTRIES as string[]).includes(value);
}

function flattenAll(): { country: CountryCode; reg: Regulation }[] {
  const out: { country: CountryCode; reg: Regulation }[] = [];
  for (const country of VALID_COUNTRIES) {
    const pack = COUNTRY_PACKS[country];
    for (const reg of pack.regulations) {
      out.push({ country, reg });
    }
  }
  return out;
}

router.get('/search', b2dAuth('normativa.search'), async (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const countryRaw = String(req.query.country ?? 'CL').toUpperCase();
  const type = String(req.query.type ?? '').toUpperCase(); // optional filter, e.g. "DS", "LEY"

  if (!q) return res.status(400).json({ error: 'missing_query' });
  if (!isCountry(countryRaw)) {
    return res.status(400).json({ error: 'invalid_country', allowed: VALID_COUNTRIES });
  }

  const pack = COUNTRY_PACKS[countryRaw];
  let matches = pack.regulations.filter((r) => {
    const haystack = `${r.title} ${r.scope} ${r.reference}`.toLowerCase();
    return haystack.includes(q);
  });

  if (type) {
    matches = matches.filter((r) => r.title.toUpperCase().includes(type) || r.reference.toUpperCase().includes(type));
  }

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  return res.json({
    country: countryRaw,
    query: q,
    count: matches.length,
    results: matches,
    citations: [`Pack normativo ${countryRaw} v1`],
    computedAt: new Date().toISOString(),
  });
});

router.get('/by-id/:id', b2dAuth('normativa.search'), async (req, res) => {
  const id = String(req.params.id ?? '').trim();
  if (!id) return res.status(400).json({ error: 'missing_id' });

  const all = flattenAll();
  const hit = all.find((entry) => entry.reg.id === id);
  if (!hit) return res.status(404).json({ error: 'not_found' });

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  return res.json({
    country: hit.country,
    regulation: hit.reg,
    citations: [hit.reg.reference],
    computedAt: new Date().toISOString(),
  });
});

const ValidateSchema = z.object({
  industry: z.string().min(1),
  country: z.enum(['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'ISO']).default('CL'),
  riskCategory: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  mitigations: z.array(z.string()).default([]),
});

router.post('/validate', b2dAuth('normativa.validate'), async (req, res) => {
  const parsed = ValidateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_input', issue: parsed.error.flatten() });
  }
  const { industry, country, riskCategory, mitigations } = parsed.data;
  const pack = COUNTRY_PACKS[country];

  // Heuristic compliance gap check: flag the canonical SST building blocks
  // every project must have. Real engine arrives in Sprint 24 (Bucket FF).
  const required = pack.regulations.slice(0, 5).map((r) => r.id);
  const haveAsLower = mitigations.map((m) => m.toLowerCase());
  const gaps = required.filter(
    (regId) => !haveAsLower.some((m) => m.includes(regId.toLowerCase())),
  );

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  return res.json({
    industry,
    country,
    riskCategory,
    compliant: gaps.length === 0,
    gaps: gaps.map((id) => {
      const reg = pack.regulations.find((r) => r.id === id);
      return {
        regulationId: id,
        title: reg?.title ?? id,
        reference: reg?.reference ?? '',
        suggestion: `Documentar la mitigaciÃ³n que cubre ${reg?.title ?? id}.`,
      };
    }),
    citations: pack.regulations.slice(0, 5).map((r) => r.reference),
    computedAt: new Date().toISOString(),
  });
});

export default router;
