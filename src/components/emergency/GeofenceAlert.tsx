import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, MapPin } from 'lucide-react';
import { useGeofence, GeofenceZone } from '../../hooks/useGeofence';

// Example hardcoded zones for demonstration
const HAZMAT_ZONES: GeofenceZone[] = [
  {
    id: 'zone-1',
    name: 'Área de Químicos Peligrosos',
    type: 'HAZMAT',
    coordinates: [[
      [-70.6500, -33.4500],
      [-70.6400, -33.4500],
      [-70.6400, -33.4600],
      [-70.6500, -33.4600],
      [-70.6500, -33.4500]
    ]]
  }
];

export function GeofenceAlert() {
  const { activeZones } = useGeofence(HAZMAT_ZONES);

  return (
    <AnimatePresence>
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
