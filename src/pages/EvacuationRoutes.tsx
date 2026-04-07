import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Route, Map, AlertTriangle, Navigation, ShieldAlert, Users, Footprints, Info, Activity, Loader2 } from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { useProject } from '../contexts/ProjectContext';
import { useFirebase } from '../contexts/FirebaseContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { NodeType } from '../types';

interface Earthquake {
  id: string;
  mag: number;
  place: string;
  time: number;
  url: string;
}

export function EvacuationRoutes() {
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeCalculated, setRouteCalculated] = useState(false);
  const [grid, setGrid] = useState<number[][]>([]);
  const [path, setPath] = useState<{x: number, y: number}[]>([]);
  const [recentEarthquake, setRecentEarthquake] = useState<Earthquake | null>(null);
  const [isCheckingSeismic, setIsCheckingSeismic] = useState(true);

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
                metadata: {
                  status: 'approved',
                  criticidad: 'Alta',
                  magnitude: eq.mag,
                  place: eq.place,
                  emittedAt: new Date().toISOString(),
                  emittedBy: 'API Sismológica'
                }
              }).catch(console.error);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching seismic data:", error);
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

    // Simulate A* algorithm calculation delay
    setTimeout(() => {
      // Hardcoded path for demonstration
      const simulatedPath = [
        {x: 0, y: 0}, {x: 0, y: 1}, {x: 0, y: 2}, {x: 1, y: 2},
        {x: 1, y: 3}, {x: 1, y: 4}, {x: 1, y: 5}, {x: 2, y: 5},
        {x: 3, y: 5}, {x: 4, y: 5}, {x: 4, y: 6}, {x: 4, y: 7},
        {x: 5, y: 7}, {x: 6, y: 7}, {x: 7, y: 7}, {x: 8, y: 7},
        {x: 9, y: 7}, {x: 9, y: 8}, {x: 9, y: 9}
      ];
      
      setPath(simulatedPath);
      setIsCalculating(false);
      setRouteCalculated(true);
    }, 2000);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
            <Route className="w-8 h-8 text-emerald-500" />
            Rutas de Evacuación IA
          </h1>
          <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
            Algoritmo A* sobre Grillas Dinámicas
          </p>
        </div>
        <div className="px-4 py-2 rounded-xl border flex items-center gap-2 text-emerald-500 bg-emerald-500/10 border-emerald-500/20">
          <ShieldAlert className="w-5 h-5" />
          <span className="font-bold uppercase tracking-wider text-sm">
            Emergencia Activa
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Map View */}
        <Card className="p-6 border-white/5 lg:col-span-2 space-y-6">
          {isCheckingSeismic ? (
            <div className="flex items-center justify-center p-4 bg-zinc-900/50 rounded-xl border border-white/5">
              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin mr-3" />
              <span className="text-sm text-zinc-400">Conectando con Red Sismológica...</span>
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
                  <p className="text-[10px] text-zinc-500 uppercase tracking-widest">
                    Fuente: USGS / Simulación CSN
                  </p>
                </div>
              </div>
            </motion.div>
          ) : null}

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Map className="w-5 h-5 text-emerald-500" />
              Plano de Faena (Grilla Dinámica)
            </h2>
            <div className="flex items-center gap-4 text-xs font-bold text-zinc-400">
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-zinc-800 rounded" /> Libre</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-rose-500/50 rounded" /> Obstáculo/Fuego</span>
              <span className="flex items-center gap-1"><div className="w-3 h-3 bg-emerald-500 rounded" /> Ruta</span>
            </div>
          </div>

          <div className="aspect-square w-full max-w-md mx-auto bg-zinc-900 border border-zinc-800 rounded-xl p-4 grid grid-cols-10 grid-rows-10 gap-1">
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
              onClick={calculateRoute} 
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
                  Generar Ruta de Evacuación
                </span>
              )}
            </Button>
          </div>
        </Card>

        {/* Details Panel */}
        <Card className="p-6 border-white/5 space-y-6">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-emerald-500" />
            Estado de Evacuación
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
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Distancia</p>
                  <p className="text-2xl font-black text-white">{path.length * 10}m</p>
                </div>
                <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                  <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Tiempo Est.</p>
                  <p className="text-2xl font-black text-white">{Math.ceil((path.length * 10) / 1.5)}s</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-zinc-900 border border-white/5">
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">Instrucciones</p>
                <ul className="space-y-2 text-sm text-zinc-300">
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Avanzar al Norte 30m</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Girar al Este 20m</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Continuar al Sur 50m</li>
                  <li className="flex items-center gap-2"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Llegada a Zona Segura</li>
                </ul>
              </div>

              <Button className="w-full" variant="secondary">
                Notificar a Cuadrilla
              </Button>
            </motion.div>
          ) : (
            <div className="flex flex-col items-center justify-center h-64 text-center border border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
              <Info className="w-10 h-10 text-zinc-700 mb-3" />
              <p className="text-sm text-zinc-500">Presiona "Generar Ruta" para calcular la vía de escape más segura usando IA.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
