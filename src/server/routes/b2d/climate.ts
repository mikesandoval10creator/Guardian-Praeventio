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
// is computed from public sources (Open-Meteo, USGS, OpenAQ).
//
// §2.16 (cierre Fase C.4, 2026-05-21):
//   Antes este endpoint era 100% determinístico (provenance:
//   'deterministic-stub'), contradiciendo la promesa marketing "Open-Meteo
//   + USGS + OpenAQ". Ahora invoca las 3 fuentes externas vía
//   `services/b2d/externalClimate.ts` (cache 1h server-side, timeouts 8s,
//   no expone tenantId/customerId al upstream). Si alguna fuente falla
//   (timeout, 5xx, parse error), CAE GRACEFULLY a stub determinístico de
//   ESA fuente individual — Regla #3 inviolable. El campo `provenance`
//   reporta qué fuentes son reales vs stub para cada request.

import { Router } from 'express';

import { b2dAuth } from '../../middleware/b2dAuth.js';
import { trackB2dUsage } from '../../../services/b2d/usage.js';
import {
  fetchOpenMeteoCurrent,
  fetchOpenMeteoForecast,
  fetchUsgsEarthquakesNearby,
  fetchOpenAqAirQuality,
  type OpenMeteoCurrent,
} from '../../../services/b2d/externalClimate.js';

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

/**
 * Fallback determinístico (Regla #3) — solo cuando Open-Meteo falla.
 * Gradient simple por latitud para que el shape sea realista.
 */
function climateSnapshotFallback(coords: LatLng): OpenMeteoCurrent {
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

  // §2.16 — invocar las 3 fuentes en paralelo (cache 1h server-side).
  // Cada Promise puede resolver con `null` si la fuente falla.
  const [openMeteo, usgs, openAq] = await Promise.all([
    fetchOpenMeteoCurrent(coords.lat, coords.lng),
    fetchUsgsEarthquakesNearby(coords.lat, coords.lng, 200),
    fetchOpenAqAirQuality(coords.lat, coords.lng, 25),
  ]);

  const weather = openMeteo?.data ?? climateSnapshotFallback(coords);
  const weatherSource: 'openmeteo' | 'deterministic-fallback' = openMeteo
    ? 'openmeteo'
    : 'deterministic-fallback';

  const seismic = {
    last24hMaxMagnitude: usgs?.data.last24hMaxMagnitude ?? null,
    nearbyEventCount: usgs?.data.nearbyEventCount ?? 0,
    source: 'usgs' as const,
    available: usgs !== null,
  };

  const airQuality = {
    pm25UgM3: openAq?.data.pm25UgM3 ?? null,
    pm10UgM3: openAq?.data.pm10UgM3 ?? null,
    aqi: openAq?.data.aqi ?? null,
    source: 'openaq' as const,
    available: openAq !== null,
  };

  return res.json({
    coordinates: coords,
    weather,
    weatherSource,
    seismic,
    airQuality,
    citations: ['Open-Meteo', 'USGS Earthquake Catalog', 'OpenAQ'],
    provenance: {
      weather: weatherSource,
      seismic: usgs ? 'usgs-live' : 'unavailable',
      airQuality: openAq ? 'openaq-live' : 'unavailable',
    },
    computedAt: new Date().toISOString(),
  });
});

router.get('/forecast', b2dAuth('climate.forecast'), async (req, res) => {
  const coords = parseLatLng(req);
  if (!coords) return res.status(400).json({ error: 'invalid_coordinates' });

  const days = Math.min(14, Math.max(1, Math.floor(Number(req.query.days ?? 7))));

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  // §2.16 — Open-Meteo forecast real con fallback determinístico.
  const forecast = await fetchOpenMeteoForecast(coords.lat, coords.lng, days);

  if (forecast) {
    return res.json({
      coordinates: coords,
      days: forecast.data,
      citations: ['Open-Meteo'],
      provenance: 'openmeteo-live',
      computedAt: new Date().toISOString(),
    });
  }

  // Fallback determinístico — gradient simple por latitud + días.
  const today = new Date();
  const base = climateSnapshotFallback(coords);
  const days_data = [];
  for (let i = 0; i < days; i += 1) {
    const date = new Date(today.getTime() + i * 24 * 60 * 60 * 1000);
    days_data.push({
      date: date.toISOString().slice(0, 10),
      tempMinC: base.tempC - 4,
      tempMaxC: base.tempC + 4,
      precipitationMm: i % 3 === 0 ? 2.5 : 0,
      windKmh: base.windKmh,
    });
  }

  return res.json({
    coordinates: coords,
    days: days_data,
    citations: ['Open-Meteo (fallback)', 'Praeventio climate stub'],
    provenance: 'deterministic-fallback',
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

  const customerId = req.b2dKey?.customerId as string;
  await trackB2dUsage(customerId);

  // §2.16 — el risk-score se calcula sobre el snapshot REAL si Open-Meteo
  // responde. Si no, sobre el snapshot determinístico (Regla #3 — el
  // score sigue calculándose, no se etiqueta como "no disponible").
  const openMeteo = await fetchOpenMeteoCurrent(coords.lat, coords.lng);
  const snapshot = openMeteo?.data ?? climateSnapshotFallback(coords);
  const weatherSource: 'openmeteo' | 'deterministic-fallback' = openMeteo
    ? 'openmeteo'
    : 'deterministic-fallback';

  const industryWeights: Record<string, number> = {
    general: 1.0,
    mining: 1.4,
    construction: 1.2,
    agriculture: 1.1,
    logistics: 0.9,
  };
  const weight = industryWeights[industry] ?? 1;
  const uv = snapshot.uvIndex ?? 4;
  const rawScore = Math.min(
    100,
    Math.round(((snapshot.windKmh / 50) * 30 + (uv / 11) * 30) * weight),
  );

  return res.json({
    coordinates: coords,
    industry,
    riskScore: rawScore,
    riskBand: rawScore < 25 ? 'low' : rawScore < 60 ? 'medium' : 'high',
    drivers: ['wind', 'uv'],
    weatherSnapshot: snapshot,
    citations: ['Open-Meteo', 'Praeventio risk model v1'],
    provenance: weatherSource,
    computedAt: new Date().toISOString(),
  });
});

export default router;
