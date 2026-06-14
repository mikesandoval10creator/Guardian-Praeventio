import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, MapPin, MapPinOff } from 'lucide-react';
import { GeofenceZone } from '../../hooks/useGeofence';
import { useGeofenceWithEvents } from '../../hooks/useGeofenceWithEvents';
import { listRestrictedZonesBySite } from '../../hooks/useRestrictedZones';
import { mapActiveRestrictedZones } from '../../services/zones/restrictedZoneToGeofence';
import { useProject } from '../../contexts/ProjectContext';
import { useFirebase } from '../../contexts/FirebaseContext';
import { useNotifications } from '../../contexts/NotificationContext';
import { db, serverTimestamp, auth } from '../../services/firebase';
import { collection, addDoc } from 'firebase/firestore';
import { logger } from '../../utils/logger';

// Demo geocerca — DEV ONLY. This hardcoded HAZMAT polygon over central Santiago
// was previously shipped as the prod fallback for ANY project without configured
// zones (and nothing writes `settings.geofences`), so every worker near those
// coordinates saw a FABRICATED "Área de Químicos Peligrosos" alert — and once the
// geofence→SOS escalation is wired (below), it would have fired a FALSE SOS. It
// is now empty in prod (an unconfigured project shows no geocerca — honest) and
// kept only under import.meta.env.DEV so the UI can still be exercised locally.
//
// OLA 1 (2026-06-14): real configured zones now load from the AUDITED
// /api/zones/by-site route (listRestrictedZonesBySite), so a project that
// defines zones gets a LIVE geofence (+ geofence→SOS escalation) in prod. This
// demo is only the last-resort DEV fallback when no real zones exist.
const FALLBACK_ZONES: GeofenceZone[] = import.meta.env.DEV
  ? [
      {
        id: 'zone-1',
        name: 'Área de Químicos Peligrosos (DEMO)',
        type: 'HAZMAT',
        coordinates: [[
          [-70.6500, -33.4500],
          [-70.6400, -33.4500],
          [-70.6400, -33.4600],
          [-70.6500, -33.4600],
          [-70.6500, -33.4500]
        ]]
      },
    ]
  : [];

export function GeofenceAlert() {
  const { selectedProject } = useProject();
  const { user } = useFirebase();

  // Real configured zones from the audited server route. Empty until loaded /
  // when the project has none — geofencing degrades to "no alert" honestly.
  const [realZones, setRealZones] = useState<GeofenceZone[]>([]);
  useEffect(() => {
    const pid = selectedProject?.id;
    if (!pid) {
      setRealZones([]);
      return undefined;
    }
    let cancelled = false;
    listRestrictedZonesBySite(pid)
      .then((res) => {
        if (!cancelled) setRealZones(mapActiveRestrictedZones(res.zones ?? []));
      })
      .catch((err) => {
        if (cancelled) return;
        logger.warn('GeofenceAlert: restricted-zones fetch failed', { err: String(err) });
        setRealZones([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProject?.id]);

  const activeProjectZones = useMemo(() => {
    // Prefer real configured zones; fall back to legacy project settings, then
    // the DEV-only demo (empty in prod).
    if (realZones.length > 0) return realZones;
    if (selectedProject?.settings?.geofences && Array.isArray(selectedProject.settings.geofences)) {
      return selectedProject.settings.geofences as GeofenceZone[];
    }
    return FALLBACK_ZONES;
  }, [realZones, selectedProject]);

  const handleZoneEntry = useCallback((enteredZones: GeofenceZone[]) => {
    if (!selectedProject) return;
    addDoc(collection(db, `projects/${selectedProject.id}/zone_violations`), {
      workerId: user?.uid ?? null,
      workerName: user?.displayName ?? null,
      zones: enteredZones.map((z) => ({ id: z.id, name: z.name, type: z.type })),
      timestamp: serverTimestamp(),
    }).catch((err) => logger.error('GeofenceAlert: failed to log zone violation', { err }));
  }, [selectedProject, user]);

  // Use the event-emitting wrapper so a zone crossing emits `geofence_crossed`
  // onto the SystemEngine bus → geofenceToSosPolicy (registered in
  // SystemEngineProvider) → recommend/notify supervisors for HAZMAT/RESTRICTED.
  // Previously this used the RAW useGeofence (no emit), so the registered
  // escalation policy was starved and a worker entering a hazmat zone got only a
  // local banner + a zone_violations row — no supervisor fan-out. (Inert until a
  // project has real configured zones; the demo no longer ships in prod.)
  const tenantId = auth.currentUser?.tenantId ?? 'default';
  const { activeZones, permissionState } = useGeofenceWithEvents(
    activeProjectZones,
    { tenantId, projectId: selectedProject?.id ?? '', workerId: user?.uid ?? '' },
    handleZoneEntry,
  );

  const permissionToastFiredRef = useRef(false);
  const { addNotification } = useNotifications();
  useEffect(() => {
    if (permissionState === 'denied' && !permissionToastFiredRef.current) {
      permissionToastFiredRef.current = true;
      addNotification({
        title: 'Geocerca desactivada',
        message:
          'Concede permiso de ubicación para que Praeventio Guard te avise al entrar a una zona restringida.',
        type: 'warning',
      });
    }
    if (permissionState === 'unavailable' && !permissionToastFiredRef.current) {
      permissionToastFiredRef.current = true;
      addNotification({
        title: 'Geolocalización no disponible',
        message:
          'Tu dispositivo no permite ubicación en este momento. La geocerca no está activa.',
        type: 'error',
      });
    }
  }, [permissionState, addNotification]);

  return (
    <AnimatePresence>
      {permissionState === 'denied' && (
        <motion.div
          key="geofence-permission-denied"
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[150] w-[90%] max-w-md"
        >
          <div className="bg-amber-600 text-white p-3 rounded-2xl shadow-xl flex items-start gap-3 border border-amber-400">
            <MapPinOff className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-bold leading-tight">Geocerca desactivada</p>
              <p className="text-amber-100 text-xs mt-0.5">
                Concede permiso de ubicación para activar la alerta de zonas restringidas.
              </p>
            </div>
          </div>
        </motion.div>
      )}
      {activeZones.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[150] w-[90%] max-w-md"
        >
          <div className="bg-rose-600 text-white p-4 rounded-2xl shadow-2xl shadow-rose-600/50 flex items-start gap-4 border-2 border-rose-400 animate-pulse">
            <div className="p-2 bg-white/20 rounded-xl shrink-0">
              <AlertTriangle className="w-8 h-8 text-white" />
            </div>
            <div>
              <h3 className="font-black uppercase tracking-tighter text-lg leading-none mb-1">
                ¡ALERTA DE GEOCERCA!
              </h3>
              <p className="text-rose-100 text-xs font-bold uppercase tracking-widest mb-2">
                Ha ingresado a una zona restringida
              </p>
              <div className="space-y-1">
                {activeZones.map(zone => (
                  <div key={zone.id} className="flex items-center gap-1.5 text-sm font-medium bg-black/20 px-2 py-1 rounded-lg">
                    <MapPin className="w-3 h-3" />
                    {zone.name} ({zone.type})
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
