import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Map as MapIcon,
  Navigation,
  AlertCircle,
  Compass,
  Loader2,
  CheckCircle2,
  XCircle,
  MapPin,
  Clock,
  Trash2,
  Hand,
} from 'lucide-react';
import { useUniversalKnowledge } from '../../contexts/UniversalKnowledgeContext';
import { useProject } from '../../contexts/ProjectContext';
import { NodeType } from '../../types';
import { auth } from '../../services/firebase';
import { subscribeSiteGeometry } from '../../services/digitalTwin/siteGeometryStore';
import type { SiteGeometryFeature } from '../../services/digitalTwin/siteGeometry';
import {
  planEvacuationRoute,
  featuresBounds,
  type LngLat,
} from '../../services/routing/evacuationGrid';
import { useGeolocationTracking } from '../../hooks/useGeolocationTracking';
import { VectorialEvacuationMap } from './VectorialEvacuationMap';
import { EvacuationGridMap } from './EvacuationGridMap';
import { logger } from '../../utils/logger';

// Conservative evacuation walking pace (m/s) — brisk but accounts for stress,
// debris and congestion. Used only for an ETA estimate, clearly labelled.
const EVAC_PACE_MS = 1.2;

function formatEta(distanceMeters: number): string {
  const seconds = Math.round(distanceMeters / EVAC_PACE_MS);
  if (seconds < 60) return `~${seconds} s`;
  return `~${Math.round(seconds / 60)} min`;
}

export function DynamicEvacuationMap() {
  const { nodes } = useUniversalKnowledge();
  const { selectedProject } = useProject();
  const { lastLocation } = useGeolocationTracking();

  const projectId = selectedProject?.id ?? null;
  const tenantId = auth.currentUser?.tenantId ?? 'default';

  const [features, setFeatures] = useState<SiteGeometryFeature[]>([]);
  const [geoLoading, setGeoLoading] = useState(true);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<LngLat[]>([]);
  const [showDeadReckoning, setShowDeadReckoning] = useState(false);

  // Live subscription to the project's Digital Twin footprint (site_geometry).
  useEffect(() => {
    if (!projectId) {
      setFeatures([]);
      setGeoLoading(false);
      return undefined;
    }
    setGeoLoading(true);
    const unsub = subscribeSiteGeometry(
      tenantId,
      projectId,
      (next) => {
        setFeatures(next);
        setGeoError(null);
        setGeoLoading(false);
      },
      (err) => {
        logger.error('site_geometry subscription failed', { err: String(err) });
        setGeoError('No se pudo cargar la geometría del sitio.');
        setGeoLoading(false);
      },
    );
    return unsub;
  }, [tenantId, projectId]);

  const worker: LngLat | null = useMemo(
    () => (lastLocation ? { lng: lastLocation.lng, lat: lastLocation.lat } : null),
    [lastLocation],
  );

  // Critical nodes that justify recomputing / flagging an emergency.
  const activeEmergencies = useMemo(() => {
    return nodes.filter((n) => {
      if (n.type === NodeType.EMERGENCY && n.metadata?.status === 'active') return true;
      if (n.type === NodeType.INCIDENT) return true;
      if (n.type === NodeType.RISK && n.metadata?.level === 'Crítico') return true;
      return false;
    });
  }, [nodes]);

  const bounds = useMemo(() => featuresBounds(features), [features]);
  const hasGeometry = features.length > 0 && bounds !== null;
  const hasExit = useMemo(
    () => features.some((f) => f.properties.type === 'evacuation'),
    [features],
  );

  // The REAL evacuation route — A* over the twin-derived grid.
  const route = useMemo(() => {
    if (!worker || features.length === 0) return null;
    return planEvacuationRoute(features, worker, { extraBlocked: blocked });
  }, [features, worker, blocked]);

  const handleBlockPoint = useCallback((p: LngLat) => {
    setBlocked((prev) => [...prev, p]);
  }, []);

  const handleRemoveBlocked = useCallback((index: number) => {
    setBlocked((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleClearBlocked = useCallback(() => setBlocked([]), []);

  return (
    <section className="bg-zinc-900/50 border border-white/10 rounded-2xl sm:rounded-3xl p-5 sm:p-8 space-y-4 sm:space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl sm:rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500 border border-blue-500/20 shrink-0">
            <Navigation className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h3 className="text-lg sm:text-xl font-black text-zinc-900 dark:text-white uppercase tracking-tight leading-tight">Rutas Dinámicas</h3>
            <p className="text-[10px] sm:text-xs text-zinc-500 font-medium uppercase tracking-widest mt-0.5">Evacuación A* sobre el Gemelo Digital</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            onClick={() => setShowDeadReckoning((v) => !v)}
            // Audit P0 §1.1 — WCAG 2.5.5 + Apple HIG 44pt + Material 48dp: min 44x44 touch target.
            className={`min-h-11 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border transition-all ${
              showDeadReckoning
                ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                : 'bg-zinc-800/60 border-white/10 text-zinc-400 hover:text-white'
            }`}
          >
            <Compass className="w-3 h-3 shrink-0" />
            {showDeadReckoning ? 'Navegación Inercial' : 'Mapa del Sitio'}
          </button>
          {activeEmergencies.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-rose-500/10 border border-rose-500/20 rounded-full animate-pulse">
              <AlertCircle className="w-3 h-3 text-rose-500 shrink-0" />
              <span className="text-[9px] sm:text-[10px] font-black text-rose-500 uppercase tracking-widest">Emergencia Detectada</span>
            </div>
          )}
        </div>
      </header>

      <div className="relative aspect-square sm:aspect-video bg-white dark:bg-black/40 rounded-xl sm:rounded-2xl border border-zinc-200 dark:border-white/5 overflow-hidden flex items-center justify-center">
        <AnimatePresence mode="wait">
          {showDeadReckoning ? (
            // Inertial navigation — real dead-reckoning for GPS-denied areas.
            <VectorialEvacuationMap showDeadReckoning />
          ) : !projectId ? (
            <div className="text-center space-y-3 p-4">
              <MapIcon className="w-10 h-10 text-zinc-400 dark:text-zinc-700 mx-auto" />
              <p className="text-xs sm:text-sm font-bold text-zinc-500">Selecciona un proyecto para ver su mapa de evacuación.</p>
            </div>
          ) : geoLoading ? (
            <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              <p className="text-[10px] sm:text-xs font-black text-zinc-500 uppercase tracking-widest">Cargando geometría del sitio…</p>
            </div>
          ) : geoError ? (
            <div className="text-center space-y-3 p-4">
              <XCircle className="w-10 h-10 text-rose-500 mx-auto" />
              <p className="text-xs sm:text-sm font-bold text-rose-500">{geoError}</p>
            </div>
          ) : !hasGeometry || !bounds ? (
            // Honest empty state — no fabricated floor plan.
            <div className="text-center space-y-3 sm:space-y-4 p-4 max-w-md">
              <div className="w-12 h-12 sm:w-16 sm:h-16 bg-zinc-100 dark:bg-white/5 rounded-full flex items-center justify-center mx-auto border border-zinc-200 dark:border-white/5">
                <MapIcon className="w-6 h-6 sm:w-8 sm:h-8 text-zinc-400 dark:text-zinc-700" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-bold text-zinc-700 dark:text-zinc-300">Aún no has construido el gemelo digital de esta faena.</p>
                <p className="text-[10px] sm:text-xs font-medium text-zinc-500 leading-relaxed mt-2">
                  Captura la geometría del sitio —perímetro, zonas de peligro y zonas de evacuación— desde el Gemelo Digital
                  para habilitar el cálculo de rutas de evacuación reales (A*).
                </p>
              </div>
            </div>
          ) : (
            <motion.div
              key="grid-map"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 w-full h-full"
            >
              <EvacuationGridMap
                features={features}
                bounds={bounds}
                worker={worker}
                route={route}
                blocked={blocked}
                onBlockPoint={handleBlockPoint}
              />

              {/* Honest route status banner */}
              <div className="absolute left-0 right-0 bottom-0 p-2 sm:p-3 bg-gradient-to-t from-black/80 to-transparent">
                {!worker ? (
                  <div className="flex items-center gap-2 text-blue-300 bg-black/50 rounded-lg px-3 py-2">
                    <MapPin className="w-4 h-4 shrink-0 animate-pulse" />
                    <span className="text-[10px] sm:text-xs font-bold">Esperando tu ubicación GPS para trazar la ruta…</span>
                  </div>
                ) : route ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-emerald-300 bg-black/60 rounded-lg px-3 py-2">
                    <span className="flex items-center gap-1.5 text-xs sm:text-sm font-black uppercase tracking-wide">
                      <CheckCircle2 className="w-4 h-4 shrink-0" /> Ruta segura encontrada
                    </span>
                    <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold">
                      <Navigation className="w-3 h-3" /> {Math.round(route.distanceMeters)} m
                    </span>
                    <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold">
                      <Clock className="w-3 h-3" /> {formatEta(route.distanceMeters)}
                    </span>
                  </div>
                ) : !hasExit ? (
                  <div className="flex items-center gap-2 text-amber-300 bg-black/60 rounded-lg px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="text-[10px] sm:text-xs font-bold">Define una zona de evacuación en el gemelo digital para calcular rutas.</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-rose-300 bg-black/60 rounded-lg px-3 py-2">
                    <XCircle className="w-4 h-4 shrink-0" />
                    <span className="text-[10px] sm:text-xs font-bold">No hay ruta segura alcanzable desde tu posición. Revisa peligros o bloqueos reportados.</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Real-time blocked-area reporting (coordinate-based, feeds re-routing) */}
      {!showDeadReckoning && hasGeometry && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[9px] sm:text-[10px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <Hand className="w-3 h-3 shrink-0" /> Toca el mapa para reportar un área bloqueada
            </p>
            {blocked.length > 0 && (
              <button
                type="button"
                onClick={handleClearBlocked}
                className="min-h-11 inline-flex items-center gap-1 px-2 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-widest text-rose-400 hover:text-rose-300"
              >
                <Trash2 className="w-3 h-3" /> Limpiar
              </button>
            )}
          </div>
          {blocked.length > 0 && (
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {blocked.map((_, i) => (
                <span key={i} className="px-2 py-1 bg-rose-500/10 border border-rose-500/20 rounded text-[9px] sm:text-[10px] font-bold text-rose-400 uppercase flex items-center gap-1">
                  Bloqueo {i + 1}
                  <button
                    type="button"
                    aria-label={`Quitar bloqueo ${i + 1}`}
                    onClick={() => handleRemoveBlocked(i)}
                    className="hover:text-rose-300 ml-1"
                  >
                    <XCircle className="w-3 h-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="p-3 sm:p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl sm:rounded-2xl flex items-start gap-3 sm:gap-4">
        <Navigation className="w-4 h-4 sm:w-5 sm:h-5 text-blue-500 mt-0.5 sm:mt-1 shrink-0" />
        <div>
          <h4 className="text-xs sm:text-sm font-bold text-zinc-900 dark:text-white">Inteligencia de Evacuación</h4>
          <p className="text-[10px] sm:text-xs text-zinc-500 leading-relaxed mt-1">
            La ruta se calcula con A* sobre la geometría real de tu faena (perímetro, peligros y zonas de evacuación del
            gemelo digital), evitando obstáculos y peligros. Si no existe ruta alcanzable, el sistema lo informa
            honestamente en lugar de inventar una.
          </p>
        </div>
      </div>
    </section>
  );
}
