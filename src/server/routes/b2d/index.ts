// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB — B2D API parent router.
//
// Mounted at `/api/b2d/v1` in server.ts. The parent mount is intentionally
// placed BEFORE `verifyAuth` so the B2D surface uses its own `b2dAuth`
// middleware (Bearer pk_*) rather than Firebase Auth (Bearer Firebase ID
// token). The two auth layers do not mix.

import express, { Router } from 'express';

import climateRouter from './climate.js';
import hazmatRouter from './hazmat.js';
import normativaRouter from './normativa.js';
import suiteRouter from './suite.js';
import { b2dFreeLimiter } from '../../middleware/limiters.js';

const b2dApiRouter = Router();

// JSON parsing is local to the B2D surface because the parent app mounts
// this router BEFORE the global `/api/` IP rate limiter and BEFORE the
// global `express.json()` parser — both of which would otherwise either
// throttle paid B2D tiers or fail POST bodies. The 64kb cap matches the
// rest of the platform.
b2dApiRouter.use(express.json({ limit: '64kb' }));

// Free-tier rate limiter applies to the entire B2D surface BEFORE auth so
// even unauthenticated probes count against the per-IP fallback bucket.
b2dApiRouter.use(b2dFreeLimiter);

b2dApiRouter.use('/climate', climateRouter);
b2dApiRouter.use('/hazmat', hazmatRouter);
b2dApiRouter.use('/normativa', normativaRouter);
b2dApiRouter.use('/suite', suiteRouter);

export default b2dApiRouter;
