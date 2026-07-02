import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Route, Map, AlertTriangle, Navigation, ShieldAlert, Users, Footprints, Info, Activity, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';
import { logger } from '../utils/logger';
// 16th wave (Bucket B) analytics: catalog row 69 — fire
// `emergency.evacuation.started` when the A* route calculation kicks off,
// regardless of whether it was auto-triggered (seismic event ≥6.0) or
// manual. The "started" verb in the catalog row corresponds to the user
// (or auto-trigger) committing to an evacuation flow.
import { analytics } from '../services/analytics';
// Codex fake fix §2.3 (2026-05-15): antes esta página simulaba A* con
// `setTimeout(2000)` + `simulatedPath` hardcoded. Ahora usa A* REAL sobre
// grilla 10×10 implementado en src/services/routing/gridAStar.ts (10 tests).
import { findPathAStar } from '../services/routing/gridAStar';

interface Earthquake {
  id: string;
  mag: number;
  place: string;
  time: number;
  url: string;
}

// Audit 2026-07-02 §3.4 #5: the "Instrucciones" list used to be 4 literal
// <li> strings ("Avanzar al Norte 30m"...) completely disconnected from the
// `path` the A* engine actually returned — Distancia/Tiempo below it were
// already real (computed from `path.length`), so the instructions were the
// one dishonest piece left in this panel. This derives real turn-by-turn
// steps from the real path: each grid step is 10m (same scale already used
// for Distancia), and consecutive same-direction steps are grouped into one
// segment so a 5-cell straight line reads as "Avanzar al Norte 50m" instead
// of five separate 10m lines.
type CardinalDirection = 'Norte' | 'Sur' | 'Este' | 'Oeste';

function directionOf(from: { x: number; y: number }, to: { x: number; y: number }): CardinalDirection | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // Grid convention (see calculateRoute below): {x:0,y:0} is the top-left
  // corner (origin) and {x:9,y:9} is the safe zone (bottom-right) — so
  // decreasing y is North, increasing y is South, matching DIRECTIONS_4 in
  // gridAStar.ts ({dx:0,dy:-1} = up/North first in the neighbor order).
  if (dy < 0) return 'Norte';
  if (dy > 0) return 'Sur';
  if (dx > 0) return 'Este';
  if (dx < 0) return 'Oeste';
  return null;
}

const GRID_METERS_PER_CELL = 10;

/**
 * Groups a real A* path into human-readable turn-by-turn steps. Pure
 * function of `path` — no fabricated data. Returns [] for a path too short
 * to have a direction (0 or 1 cells).
 */
export function deriveEvacuationInstructions(path: { x: number; y: number }[]): string[] {
  if (!path || path.length < 2) return [];
  const steps: string[] = [];
  let currentDir: CardinalDirection | null = null;
  let segmentCells = 0;
  let isFirstSegment = true;

  const flushSegment = () => {
    if (currentDir && segmentCells > 0) {
      const verb = isFirstSegment ? 'Avanzar al' : 'Girar al';
      steps.push(`${verb} ${currentDir} ${segmentCells * GRID_METERS_PER_CELL}m`);
      isFirstSegment = false;
    }
  };

  for (let i = 1; i < path.length; i++) {
    const dir = directionOf(path[i - 1], path[i]);
    if (dir === null) continue; // no movement (shouldn't happen, defensive)
    if (dir === currentDir) {
      segmentCells += 1;
    } else {
      flushSegment();
      currentDir = dir;
      segmentCells = 1;
    }
  }
  flushSegment();
  steps.push('Llegada a Zona Segura');
  return steps;
}

export function EvacuationRoutes() {
  const { t } = useTranslation();
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeCalculated, setRouteCalculated] = useState(false);
  const [grid, setGrid] = useState<number[][]>([]);
  const [path, setPath] = useState<{x: number, y: number}[]>([]);
  // Real turn-by-turn steps derived from the actual A* path (see
  // deriveEvacuationInstructions above) — no fabricated literals.
  const routeInstructions = useMemo(() => deriveEvacuationInstructions(path), [path]);
  const [recentEarthquake, setRecentEarthquake] = useState<Earthquake | null>(null);
  const [isCheckingSeismic, setIsCheckingSeismic] = useState(true);
  // Audit 2026-07-02 §3.4 #6: "Notificar a Cuadrilla" had no onClick — a
  // dead button that looked actionable. Wired to the real, existing
  // supervisor fan-out endpoint (same one EmergencyContext/CoastalEmergencyMap
  // call) instead of inventing a parallel notify path.
  const [notifyingCrew, setNotifyingCrew] = useState(false);
  const [notifyCrewResult, setNotifyCrewResult] = useState<
    { status: 'ok'; notified: number } | { status: 'error'; message: string } | null
  >(null);

  const { selectedProject } = useProject();
  const { user } = useFirebase();
  const { addNode } = useRiskEngine();

  // Generate a simple 10x10 grid with some obstacles
  useEffect(() => {
    const newGrid = Array(10).fill(0).map(() => Array(10).fill(0));
    // Add obstacles
    newGrid[2][2] = 1; newGrid[2][3] = 1; newGrid[2][4] = 1;
    newGrid[5][5] = 1; newGrid[6][5] = 1; newGrid[7][5] = 1;
    newGrid[8][2] = 1; newGrid[8][3] = 1;
    setGrid(newGrid);
  }, []);

  // Fetch recent earthquakes from USGS (Simulating CSN connection)
  useEffect(() => {
    const checkSeismicActivity = async () => {
      try {
        // Query USGS for earthquakes in the last 24 hours, magnitude > 5.0, near Chile
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const startTime = yesterday.toISOString();
        
        // Bounding box for Chile roughly
        const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=${startTime}&minmagnitude=5.0&maxlatitude=-17.0&minlatitude=-56.0&maxlongitude=-66.0&minlongitude=-76.0`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.features && data.features.length > 0) {
          // Get the most recent one
          const latest = data.features[0];
          const eq: Earthquake = {
            id: latest.id,
            mag: latest.properties.mag,
            place: latest.properties.place,
            time: latest.properties.time,
            url: latest.properties.url
          };
          setRecentEarthquake(eq);
          
          // Auto-trigger evacuation calculation if magnitude > 6.0
          if (eq.mag >= 6.0) {
            calculateRoute(true);
            
            // Record in Zettelkasten
            if (selectedProject) {
              addNode({
                title: `Sismo Detectado: ${eq.mag} Richter`,
                description: `Sismo de magnitud ${eq.mag} detectado en ${eq.place}. Protocolo de evacuación activado automáticamente.`,
                type: NodeType.FINDING,
                projectId: selectedProject.id,
                tags: ['Sismo', 'Evacuación', 'Emergencia', 'CSN'],
                connections: [],
                metadata: {
                  status: 'approved',
                  criticidad: 'Alta',
                  magnitude: eq.mag,
                  place: eq.place,
                  emittedAt: new Date().toISOString(),
                  emittedBy: 'API Sismológica'
                }
              }).catch(err => logger.error('Failed to write seismic emergency node', { message: (err as Error).message }));
            }
          }
        }
      } catch (error) {
        logger.error("Error fetching seismic data:", error);
      } finally {
        setIsCheckingSeismic(false);
      }
    };

    checkSeismicActivity();
  }, [selectedProject]);

  const calculateRoute = (isAuto = false) => {
    setIsCalculating(true);
    setRouteCalculated(false);
    setPath([]);

    // 16th wave analytics: catalog row 69 (`emergency.evacuation.started`).
    // Required props are `evacuation_route_id` + `protocol_id`. The current
    // page doesn't carry persisted route/protocol ids — we synthesise a
    // stable per-session id and tag the auto vs manual trigger in the
    // protocol id so dashboards can split. A future PR that persists
    // routes can replace these with Firestore doc ids.
    try {
      void analytics.track('emergency.evacuation.started', {
        evacuation_route_id: `client-route-${selectedProject?.id ?? 'unknown'}-${Date.now()}`,
        protocol_id: isAuto ? 'auto-seismic-6plus' : 'manual-astar',
      });
    } catch { /* analytics must never break user flow */ }

    // Codex fake fix §2.3: A* REAL en vez de simulatedPath hardcoded.
    // El algoritmo corre síncronamente en <1ms para una grilla 10×10, así
    // que mantenemos un mini-delay UX de 300ms para que el "calculando"
    // sea visible (NO setTimeout de 2000ms que escondía la falta de algoritmo).
    setTimeout(() => {
      const realPath = findPathAStar(
        grid,
        { x: 0, y: 0 },           // origen (esquina superior izquierda)
        { x: 9, y: 9 },           // destino (zona segura, esquina inferior derecha)
        { allowDiagonals: false }, // 4-conexa (conservador para evacuación)
      );
      if (realPath && realPath.length > 0) {
        setPath(realPath);
        setRouteCalculated(true);
      } else {
        // Caso honesto: A* no encontró ruta. NO devolvemos fake path.
        logger.warn('evacuation_route_unreachable', {
          projectId: selectedProject?.id,
          gridSize: '10x10',
        });
        setPath([]);
        setRouteCalculated(false);
      }
      setIsCalculating(false);
    }, 300);
  };

  // Audit 2026-07-02 §3.4 #6 — real POST to the existing supervisor
  // fan-out endpoint (`/api/emergency/notify-brigada`, same one
  // `EmergencyContext.notifyBrigadeServer` and `CoastalEmergencyMap` call).
  // Not duplicating that logic in a new context/service: this page has no
  // existing wire to EmergencyContext, and the endpoint is a plain
  // authenticated POST — a direct fetch mirrors the CoastalEmergencyMap.tsx
  // pattern rather than adding a new abstraction layer.
  const notifyCrew = async () => {
    if (!selectedProject || !user) {
      setNotifyCrewResult({
        status: 'error',
        message: 'No hay proyecto o usuario activo. Selecciona un proyecto para notificar a la cuadrilla.',
      });
      return;
    }
    setNotifyingCrew(true);
    setNotifyCrewResult(null);
    try {
      const { apiAuthHeader } = await import('../lib/apiAuth');
      const authHeader = await apiAuthHeader();
      const res = await fetch('/api/emergency/notify-brigada', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { 'Authorization': authHeader } : {}),
        },
        body: JSON.stringify({
          projectId: selectedProject.id,
          emergencyType: 'other',
          message: `Ruta de evacuación calculada (A*): ${path.length * GRID_METERS_PER_CELL}m, ${Math.ceil((path.length * GRID_METERS_PER_CELL) / 1.5)}s estimados. Cuadrilla requerida en punto de encuentro.`,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'network' }));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { notified?: number };
      const notified = body.notified ?? 0;
      if (notified === 0) {
        // HTTP 200 with zero recipients is NOT success — nobody was
        // actually reached (same honest-failure pattern CoastalEmergencyMap
        // uses for this exact endpoint).
        setNotifyCrewResult({
          status: 'error',
          message: 'El servidor respondió OK pero ningún supervisor tiene notificaciones push registradas — nadie recibió el aviso. Contacta a la cuadrilla por otro medio.',
        });
        return;
      }
      setNotifyCrewResult({ status: 'ok', notified });
    } catch (err) {
      logger.error('EvacuationRoutes: notify-brigada failed', err, {
        projectId: selectedProject.id,
      });
      setNotifyCrewResult({
        status: 'error',
        message: 'No se pudo contactar a la cuadrilla vía notificación push. Reintenta o usa el canal de emergencia directo.',
      });
    } finally {
      setNotifyingCrew(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-primary-token uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Route className="w-8 h-8 text-emerald-500" />
            {t('evacuationRoutes.title', 'Rutas de Evacuación IA')}
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-muted-token uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            {t('evacuationRoutes.subtitle', 'Algoritmo A* sobre grilla 10×10 (real, determinístico, heurística Manhattan)')}
          </p>
        </div>
        {/* Audit 2026-07-02 §3.4 #5: this badge used to be a static <div>
            with no condition — always rendered "Emergencia Activa" even with
            zero seismic activity. Now tied to the real state this page
            already tracks: a quake ≥6.0 is exactly the threshold that
            auto-triggers `calculateRoute(true)` below, so "active emergency"
            here means the same thing the auto-trigger logic means. No
            recent quake at/above that threshold → badge does not render. */}
        {recentEarthquake && recentEarthquake.mag >= 6.0 && (
          <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-emerald-500 bg-emerald-500/10 border-emerald-500/20">
            <ShieldAlert className="w-5 h-5" />
            <span className="font-bold uppercase tracking-wider text-sm">
              {t('evacuationRoutes.activeEmergency', 'Emergencia Activa')}
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map View */}
        <Card className="p-6 border-default-token lg:col-span-2 space-y-6">
          {isCheckingSeismic ? (
            <div className="flex items-center justify-center p-4 bg-elevated rounded-xl border border-default-token">
              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin mr-3" />
              <span className="text-sm text-secondary-token">{t('evacuationRoutes.connectingSeismic', 'Conectando con Red Sismológica...')}</span>
            </div>
          ) : recentEarthquake ? (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`p-4 rounded-xl border ${
                recentEarthquake.mag >= 6.0 
                  ? 'bg-rose-500/10 border-rose-500/30' 
                  : 'bg-orange-500/10 border-orange-500/30'
              }`}
            >
              <div className="flex items-start gap-3">
                <Activity className={`w-6 h-6 shrink-0 mt-1 ${
                  recentEarthquake.mag >= 6.0 ? 'text-rose-500' : 'text-orange-500'
                }`} />
                <div>
                  <h3 className={`text-sm font-black uppercase tracking-widest mb-1 ${
                    recentEarthquake.mag >= 6.0 ? 'text-rose-500' : 'text-orange-500'
                  }`}>
                    Alerta Sísmica: {recentEarthquake.mag} Richter
                  </h3>
                  <p className={`text-xs mb-2 ${
                    recentEarthquake.mag >= 6.0 ? 'text-rose-200' : 'text-orange-200'
                  }`}>
                    Detectado en: {recentEarthquake.place}. 
                    {recentEarthquake.mag >= 6.0 
                      ? ' Protocolo de evacuación activado automáticamente.' 
                      : ' Mantenerse alerta a instrucciones.'}
                  </p>
                  <p className="text-[10px] text-muted-token uppercase tracking-widest">
                    Fuente: USGS / Simulación CSN
                  </p>
                </div>
              </div>
            </motion.div>
          ) : null}

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
              <Map className="w-5 h-5 text-emerald-500" />
              {t('evacuationRoutes.mapTitle', 'Plano de Faena (Grilla Dinámica)')}
            </h2>
            <div className="flex items-center gap-4 text-xs font-bold text-secondary-token">
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-elevated rounded" /> Libre</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-rose-500/50 rounded" /> Obstáculo/Fuego</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-emerald-500 rounded" /> Ruta</span>
            </div>
          </div>

          <div className="aspect-square w-full max-w-md mx-auto bg-surface border border-default-token rounded-xl p-4 grid grid-cols-10 grid-rows-10 gap-1">
            {grid.map((row, y) => (
              row.map((cell, x) => {
                const isPath = path.some(p => p.x === x && p.y === y);
                const isStart = x === 0 && y === 0;
                const isEnd = x === 9 && y === 9;
                
                return (
                  <motion.div
                    key={`${x}-${y}`}
                    initial={false}
                    animate={{
                      backgroundColor: isStart ? '#3b82f6' : 
                                       isEnd ? '#10b981' :
                                       isPath ? '#10b981' : 
                                       cell === 1 ? '#ef4444' : '#27272a',
                      scale: isPath ? [1, 1.1, 1] : 1
                    }}
                    transition={{ duration: 0.3, delay: isPath ? (path.findIndex(p => p.x === x && p.y === y) * 0.05) : 0 }}
                    className={`rounded-sm flex items-center justify-center ${isStart || isEnd ? 'ring-2 ring-white z-10' : ''}`}
                  >
                    {isStart && <Users className="w-3 h-3 text-white" />}
                    {isEnd && <ShieldAlert className="w-3 h-3 text-white" />}
                    {isPath && !isStart && !isEnd && <Footprints className="w-3 h-3 text-emerald-900 opacity-50" />}
                  </motion.div>
                );
              })
            ))}
          </div>

          <div className="flex justify-center">
            <Button 
              onClick={() => calculateRoute(false)} 
              disabled={isCalculating}
              className="w-full max-w-md"
            >
              {isCalculating ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  Calculando Ruta Óptima (A*)...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Navigation className="w-4 h-4" />
                  {t('evacuationRoutes.generateRoute', 'Generar Ruta de Evacuación')}
                </span>
              )}
            </Button>
          </div>
        </Card>

        {/* Details Panel */}
        <Card className="p-6 border-default-token space-y-6">
          <h2 className="text-lg font-bold text-primary-token flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-emerald-500" />
            {t('evacuationRoutes.evacStatus', 'Estado de Evacuación')}
          </h2>

          {routeCalculated ? (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                <h3 className="text-sm font-bold text-emerald-400 mb-1">Ruta Segura Encontrada</h3>
                <p className="text-xs text-emerald-500/70">El algoritmo ha evitado las zonas de fuego y derrumbes.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-surface border border-default-token">
                  <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest mb-1">Distancia</p>
                  <p className="text-2xl font-black text-primary-token">{path.length * 10}m</p>
                </div>
                <div className="p-4 rounded-xl bg-surface border border-default-token">
                  <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest mb-1">Tiempo Est.</p>
                  <p className="text-2xl font-black text-primary-token">{Math.ceil((path.length * 10) / 1.5)}s</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-surface border border-default-token">
                <p className="text-[10px] font-bold text-muted-token uppercase tracking-widest mb-2">Instrucciones</p>
                <ul className="space-y-2 text-sm text-secondary-token">
                  {routeInstructions.map((step, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {step}
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                className="w-full"
                variant="secondary"
                onClick={notifyCrew}
                disabled={notifyingCrew}
              >
                {notifyingCrew ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Notificando...
                  </span>
                ) : (
                  'Notificar a Cuadrilla'
                )}
              </Button>
              {notifyCrewResult && notifyCrewResult.status === 'ok' && (
                <div role="status" className="flex items-center gap-2 text-xs font-bold text-emerald-500">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  Cuadrilla notificada ({notifyCrewResult.notified} supervisor{notifyCrewResult.notified === 1 ? '' : 'es'}).
                </div>
              )}
              {notifyCrewResult && notifyCrewResult.status === 'error' && (
                <div role="alert" className="flex items-center gap-2 text-xs font-bold text-amber-500">
                  <XCircle className="w-4 h-4 shrink-0" />
                  {notifyCrewResult.message}
                </div>
              )}
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-default-token rounded-xl bg-elevated">
              <Info className="w-10 h-10 text-muted-token mb-3" />
              <p className="text-sm text-muted-token">Presiona "Generar Ruta" para calcular la vía de escape más segura usando IA.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
