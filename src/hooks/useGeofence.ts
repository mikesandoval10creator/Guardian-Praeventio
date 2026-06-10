import { useState, useEffect, useRef, useMemo } from 'react';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point, polygon } from '@turf/helpers';
import { logger } from '../utils/logger';

export interface GeofenceZone {
  id: string;
  name: string;
  type: 'HAZMAT' | 'DANGER' | 'RESTRICTED';
  coordinates: number[][][]; // GeoJSON Polygon coordinates
}

// Module-level shared AudioContext — mobile browsers (iOS Safari, Chrome Android)
// reject `new AudioContext()` outside a user-gesture stack frame. We instantiate
// lazily on the first user pointerdown anywhere in the document, so by the time
// a worker enters a hazardous zone we already have a resumed context.
let sharedAudioCtx: AudioContext | null = null;
let pointerListenerInstalled = false;

function getAudioCtxClass(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  return (window.AudioContext || window.webkitAudioContext) ?? null;
}

function ensureAudioContextOnUserGesture() {
  if (typeof document === 'undefined') return;
  if (pointerListenerInstalled) return;
  pointerListenerInstalled = true;

  const handler = () => {
    try {
      const Ctor = getAudioCtxClass();
      if (!Ctor) return;
      if (!sharedAudioCtx) sharedAudioCtx = new Ctor();
      // resume() is a no-op if 'running' — safe to call.
      if (sharedAudioCtx.state === 'suspended') {
        void sharedAudioCtx.resume().catch(() => {});
      }
    } catch (err) {
      logger.warn('[useGeofence] AudioContext init failed on user gesture', err);
    } finally {
      document.removeEventListener('pointerdown', handler);
    }
  };

  document.addEventListener('pointerdown', handler, { once: true });
}

async function playZoneAlarm() {
  // Always attempt vibration (independent of audio).
  try {
    navigator.vibrate?.([200, 100, 200, 100, 500]);
  } catch {}

  const Ctor = getAudioCtxClass();
  if (!Ctor) return;

  // Use the shared, gesture-primed context. If somehow it wasn't created yet
  // (e.g. zone entry before any user interaction — unlikely in a real PWA flow),
  // we still try to instantiate; mobile browsers may silently no-op, but desktop
  // will play.
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new Ctor();
    } catch (err) {
      logger.warn('[useGeofence] could not create AudioContext, vibration only', err);
      return;
    }
  }

  if (sharedAudioCtx.state === 'suspended') {
    try {
      await sharedAudioCtx.resume();
    } catch (err) {
      logger.warn('[useGeofence] AudioContext.resume() rejected — vibration only', err);
      return;
    }
  }

  try {
    const ctx = sharedAudioCtx;
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.setValueAtTime(1200, ctx.currentTime + 0.2);
    gainNode.gain.setValueAtTime(0.5, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch (err) {
    logger.warn('[useGeofence] alarm tone playback failed', err);
  }
}

/**
 * Sprint 44 P2 (audit H11) — exported for unit-testing. Produces a stable
 * dependency hash that changes when a zone's id OR coordinates mutate, but
 * is invariant to mere array-reference flips. Order of zones in the input
 * array does not affect the hash.
 */
export function buildZonesGeometryHash(zones: GeofenceZone[]): string {
  return JSON.stringify(
    zones
      .map((z) => ({ id: z.id, c: z.coordinates ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}

export type GeofencePermissionState =
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'pending';

export function useGeofence(
  zones: GeofenceZone[],
  onZoneEntry?: (zones: GeofenceZone[]) => void,
) {
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [activeZones, setActiveZones] = useState<GeofenceZone[]>([]);
  const [permissionState, setPermissionState] =
    useState<GeofencePermissionState>('pending');
  const onZoneEntryRef = useRef(onZoneEntry);
  onZoneEntryRef.current = onZoneEntry;
  // Track which zone IDs the worker is currently inside to avoid repeated alarms
  const insideZoneIdsRef = useRef<Set<string>>(new Set());
  // Latest `zones` value so the watchPosition callback always sees fresh polygons
  // even though the effect re-subscription is keyed on a hash of zone ids only.
  const zonesRef = useRef<GeofenceZone[]>(zones);
  zonesRef.current = zones;

  // Install the user-gesture audio primer once when the hook mounts.
  useEffect(() => {
    ensureAudioContextOnUserGesture();
  }, []);

  // Trade-off: callers may pass a fresh `zones` array reference each render
  // (e.g. computed via `.filter(...)` without `useMemo`). If we used `[zones]`
  // directly, watchPosition would tear down and resubscribe on every render —
  // wasteful, and on resub the very first geolocation callback would treat
  // every currently-occupied zone as a "just entered" event because
  // insideZoneIdsRef still holds the previous set BUT the user expects no
  // alarm on a no-op rerender. We could clear the ref on resub, but that
  // would *also* miss legitimate transitions when the zones list genuinely
  // changes membership.
  //
  // Simpler: derive a stable dep from zone IDs only. Polygon geometry mutations
  // for the SAME id won't restart watchPosition (acceptable — geofence zones
  // are effectively immutable per id in this app), but adding/removing zones
  // does. Geometry is read fresh from `zonesRef.current` inside the callback.
  // Sprint 29 (audit H11) — include geometry in the dep hash, not just
  // ids. Editing a polygon in-place (same id, distinct vertices) used to
  // leave the watcher bound to the OLD polygon, a silent geofence
  // bypass. We sort by id then serialize the polygon coordinates so the
  // hash is stable across array-reference flips but changes when the
  // shape genuinely mutates.
  //
  // Sprint 44 P2 (audit H11 re-fix) — the previous implementation hashed
  // `(z as any).polygon ?? (z as any).points` which neither field exists
  // on `GeofenceZone` (the real geometry lives in `coordinates`). The
  // hash therefore degenerated to `null` for every zone and in-place
  // polygon edits were still silently bypassed. We now hash by
  // `coordinates` directly, matching the field the watcher reads.
  const zonesIdHash = useMemo(() => buildZonesGeometryHash(zones), [zones]);

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setPermissionState('unavailable');
      return undefined;
    }

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setCurrentLocation({ lat: latitude, lng: longitude });
        setPermissionState('granted');

        const userPoint = point([longitude, latitude]);
        const currentZones = zonesRef.current;

        const insideZones = currentZones.filter((zone) => {
          try {
            const poly = polygon(zone.coordinates);
            return booleanPointInPolygon(userPoint, poly);
          } catch {
            return false;
          }
        });

        setActiveZones(insideZones);

        // Fire alarm only on zone ENTRY (transition from outside â†’ inside)
        const prevIds = insideZoneIdsRef.current;
        const newIds = new Set(insideZones.map((z) => z.id));
        const justEntered = insideZones.filter((z) => !prevIds.has(z.id));
        insideZoneIdsRef.current = newIds;

        if (justEntered.length > 0) {
          void playZoneAlarm();
          onZoneEntryRef.current?.(justEntered);
        }
      },
      (err) => {
        // Sprint 29 (audit H27) — surface PERMISSION_DENIED so el trabajador
        // no crea que tiene protección activa cuando no la tiene. Exponemos
        // `permissionState='denied'` en el return para que el UI consumer
        // muestre un toast (no toast aquí — el hook está desacoplado de
        // NotificationContext).
        if (err && typeof err === 'object' && 'code' in err) {
          if (err.code === 1) {
            setPermissionState('denied');
            logger.warn(
              '[useGeofence] Geolocalización denegada — protección desactivada.',
            );
          } else if (err.code === 2) {
            setPermissionState('unavailable');
          }
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 5000 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };

  }, [zonesIdHash]);

  return { currentLocation, activeZones, permissionState };
}
