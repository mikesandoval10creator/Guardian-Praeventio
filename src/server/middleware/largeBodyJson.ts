// Praeventio Guard — Round 16 R5 Phase 1 split.
//
// Per-route body parser used to opt specific endpoints into a 2MB JSON
// payload limit. The default global parser is `express.json({ limit: '64kb' })`
// to bound abuse; routes that legitimately need bigger bodies (e.g.
// /api/reports/generate-pdf, which embeds report content) are routed through
// this parser FIRST so the global parser short-circuits on `req.body`
// presence and doesn't reject the request.
//
// Wiring stays in server.ts because the routing predicate (`req.path ===
// '/api/reports/generate-pdf'`) is shared with the global parser pipeline.
//
// Phase 2 (billing) and Phase 3 (curriculum/projects) and Phase 4
// (oauth/gemini) deferred to Round 17/18.

import express from 'express';

export const largeBodyJson = express.json({ limit: '2mb' });
