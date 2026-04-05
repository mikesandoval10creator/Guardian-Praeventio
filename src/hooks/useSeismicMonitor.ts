import { useState, useEffect } from 'react';

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

  useEffect(() => {
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

        setEarthquakes(quakes);

        // Check for critical alerts near project
        // Criteria: Magnitude >= 4.5, Distance <= 500km, within the last 2 hours
        const recentCritical = quakes.find((q: Earthquake) => {
           const dist = calculateDistance(projectLat, projectLng, q.coordinates[1], q.coordinates[0]);
           const isRecent = (Date.now() - q.time) < 1000 * 60 * 60 * 2; // Last 2 hours
           return dist < 500 && q.magnitude >= 4.5 && isRecent;
        });

        if (recentCritical) {
          setCriticalAlert(recentCritical);
        } else {
          setCriticalAlert(null);
        }

      } catch (e) {
        // Silently fail to avoid console clutter on network errors
        // console.error("Error fetching seismic data", e);
      }
    };

    fetchQuakes();
    const interval = setInterval(fetchQuakes, 60000 * 2); // Check every 2 minutes
    return () => clearInterval(interval);
  }, [projectLat, projectLng]);

  return { earthquakes, criticalAlert };
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
