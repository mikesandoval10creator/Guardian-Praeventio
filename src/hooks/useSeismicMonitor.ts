import { useState, useEffect } from 'react';
import { logger } from '../utils/logger';

export interface Earthquake {
  id: string;
  magnitude: number;
  place: string;
  time: number;
  coordinates: [number, number, number]; // lng, lat, depth
  url: string;
}

export function useSeismicMonitor(projectLat: number = -33.4489, projectLng: number = -70.6693) {
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [criticalAlert, setCriticalAlert] = useState<Earthquake | null>(null);
  // Audit 2026-07-02 §3.1 bug 10: consumers (e.g. EmergenciaAvanzada.tsx)
  // rendered "Cargando datos sísmicos..." forever because the catch below
  // swallowed every network/parse failure and the hook never exposed a
  // loading/error signal. `loading` starts true and flips to false once the
  // first fetch settles (success OR failure) so callers can render an
  // honest error state instead of an eternal spinner.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchQuakes = async () => {
      try {
        // Fetch all earthquakes from the last 24 hours
        const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
        const data = await res.json();

        const quakes = data.features.map((f: any) => ({
          id: f.id,
          magnitude: f.properties.mag,
          place: f.properties.place,
          time: f.properties.time,
          coordinates: f.geometry.coordinates,
          url: f.properties.url
        }));

        if (cancelled) return;
        setEarthquakes(quakes);
        setError(null);

        // Check for critical alerts near project
        // Criteria: Magnitude >= 4.5, Distance <= 500km, within the last 2 hours
        const recentCritical = quakes.find((q: Earthquake) => {
           const dist = calculateDistance(projectLat, projectLng, q.coordinates[1], q.coordinates[0]);
           const isRecent = (Date.now() - q.time) < 1000 * 60 * 60 * 2; // Last 2 hours
           return dist < 500 && q.magnitude >= 4.5 && isRecent;
        });

        setCriticalAlert(recentCritical ?? null);
      } catch (e) {
        // Audit 2026-07-02 §3.1 bug 10 — previously silently swallowed
        // (commented-out logger.error) so a persistent USGS outage was
        // indistinguishable from "no earthquakes today". Surface it via
        // logger.warn (non-fatal — this is a discreet enriching feed, not
        // a life-safety source of truth on its own) and expose `error` so
        // consumers can render an honest state instead of the previous
        // eternal "Cargando..." spinner.
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        logger.warn('useSeismicMonitor: USGS fetch failed', { message });
        setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchQuakes();
    const interval = setInterval(fetchQuakes, 60000 * 2); // Check every 2 minutes
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectLat, projectLng]);

  return { earthquakes, criticalAlert, loading, error };
}

// Haversine formula to calculate distance between two coordinates in km
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
