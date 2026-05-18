// SPDX-License-Identifier: MIT
// Sprint 23 Bucket BB.3 — B2D Climate API.
//
// Mounted via `app.use('/api/b2d/v1/climate', climateRouter)`.
//
// Endpoints:
//   • GET /api/b2d/v1/climate/current     — current weather + seismic + AQ
//       Scope: `climate.read`
//   • GET /api/b2d/v1/climate/forecast    — 7-day forecast
//       Scope: `climate.forecast`  (climate-pro tier or suite.all)
//   • GET /api/b2d/v1/climate/risk-score  — composite industry risk score
//       Scope: `climate.read`
//
// Privacy boundary: never reads tenant Zettelkasten data. Every payload
// is computed from public sources (Open-Meteo, USGS, OpenAQ). Until the
// Cloud Function fan-out lands the response is structured-stub-with-real-
// shape so downstream contracts are stable; the `provenance` field tells
// integrators when data is real vs deterministic.

import { Router } from 'express';

import { b2dAuth } from '../../middleware/b2dAuth.js';
import { trackB2dUsage } from '../../../services/b2d/usage.js';

const router = Router();

interface LatLng {
  lat: number;
  lng: number;
}

function parseLatLng(req: import('express').Request): LatLng | null {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Deterministic stub: real Open-Meteo proxy lives in Sprint 24 fan-out. */
function climateSnapshot(coords: LatLng) {
  // Latitude-derived temperature gradient — keeps shape realistic.
  const tempC = Math.round((20 - Math.abs(coords.lat) / 3) * 10) / 10;
  return {
    tempC,
    humidityPct: 55,
    windKmh: 12,
    windDirectionDeg: 270,
    pressureHpa: 1013,
    uvIndex: 4,
    cloudCoverPct: 35,
  };
}

router.get('/current', b2dAuth('climate.read'), async (req, res) => {
  const coords = parseLatLng(req);
  if (!coords) {
    return res.status(400).json({ error: 'invalid_coordinates' });
  }

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  return res.json({
    coordinates: coords,
    weather: climateSnapshot(coords),
    seismic: {
      // Placeholder — USGS earthquake feed integration arrives Sprint 24.
      last24hMaxMagnitude: null,
      nearbyEventCount: 0,
      source: 'usgs',
    },
    airQuality: {
      pm25UgM3: null,
      pm10UgM3: null,
      aqi: null,
      source: 'openaq',
    },
    citations: ['Open-Meteo', 'USGS Earthquake Catalog', 'OpenAQ'],
    provenance: 'deterministic-stub',
    computedAt: new Date().toISOString(),
  });
});

router.get('/forecast', b2dAuth('climate.forecast'), async (req, res) => {
  const coords = parseLatLng(req);
  if (!coords) return res.status(400).json({ error: 'invalid_coordinates' });

  const days = Math.min(14, Math.max(1, Math.floor(Number(req.query.days ?? 7))));
  const today = new Date();
  const days_data: { date: string; tempMinC: number; tempMaxC: number; precipitationMm: number; windKmh: number }[] = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    const base = climateSnapshot(coords);
    days_data.push({
      date: date.toISOString().slice(0, 10),
      tempMinC: base.tempC - 4,
      tempMaxC: base.tempC + 4,
      precipitationMm: i % 3 === 0 ? 2.5 : 0,
      windKmh: base.windKmh,
    });
  }

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  return res.json({
    coordinates: coords,
    days: days_data,
    citations: ['Open-Meteo'],
    provenance: 'deterministic-stub',
    computedAt: new Date().toISOString(),
  });
});

router.get('/risk-score', b2dAuth('climate.read'), async (req, res) => {
  const coords = parseLatLng(req);
  if (!coords) return res.status(400).json({ error: 'invalid_coordinates' });

  const industry = String(req.query.industry ?? 'general').toLowerCase();
  const allowed = ['general', 'mining', 'construction', 'agriculture', 'logistics'];
  if (!allowed.includes(industry)) {
    return res.status(400).json({ error: 'invalid_industry', allowed });
  }

  // Industry-weighted score derived from latitude + base climate.
  const snapshot = climateSnapshot(coords);
  const industryWeights: Record<string, number> = {
    general: 1.0,
    mining: 1.4,
    construction: 1.2,
    agriculture: 1.1,
    logistics: 0.9,
  };
  const weight = industryWeights[industry] ?? 1;
  const rawScore = Math.min(
    100,
    Math.round(((snapshot.windKmh / 50) * 30 + (snapshot.uvIndex / 11) * 30) * weight),
  );

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  return res.json({
    coordinates: coords,
    industry,
    riskScore: rawScore,
    riskBand: rawScore < 25 ? 'low' : rawScore < 60 ? 'medium' : 'high',
    drivers: ['wind', 'uv'],
    citations: ['Open-Meteo', 'Praeventio risk model v1'],
    provenance: 'deterministic-stub',
    computedAt: new Date().toISOString(),
  });
});

export default router;
