import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Activity, 
  Wind, 
  ThermometerSun, 
  AlertTriangle, 
  MapPin,
  Clock,
  Zap,
  ShieldAlert,
  CloudLightning,
  Watch,
  HeartPulse,
  Truck,
  Terminal,
  Copy,
  CheckCircle2,
  X,
  WifiOff,
  Loader2,
  Smartphone
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { NodeType } from '../types';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { collection, addDoc, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../services/firebase';
import { DigitalTwin, WorkerData, MachineryData } from '../components/telemetry/DigitalTwin';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { useEmergency } from '../contexts/EmergencyContext';

interface Earthquake {
  Fecha: string;
  Profundidad: string;
  Magnitud: string;
  RefGeografica: string;
  FechaUpdate: string;
}

interface WeatherData {
  temperature: number;
  windSpeed: number;
  humidity: number;
  weatherCode: number;
}

interface IoTEvent {
  id: string;
  type: 'wearable' | 'machinery';
  source: string;
  metric: string;
  value: number;
  unit: string;
  timestamp: any;
  status: 'normal' | 'warning' | 'critical';
}

interface FitnessData {
  heartRate: number | null;
  steps: number | null;
  lastSync: Date | null;
}

import { generateRealisticIoTEvent } from '../services/geminiService';

export function Telemetry() {
  const { selectedProject } = useProject();
  const { addNode } = useRiskEngine();
  const { environment } = useUniversalKnowledge();
  const [earthquakes, setEarthquakes] = useState<Earthquake[]>([]);
  const [loading, setLoading] = useState(true);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [showWebhookModal, setShowWebhookModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [simulatingIoT, setSimulatingIoT] = useState(false);
  const [fitnessData, setFitnessData] = useState<FitnessData>({ heartRate: null, steps: null, lastSync: null });
  const [isConnectingFit, setIsConnectingFit] = useState(false);
  const [fitTokens, setFitTokens] = useState<any>(null);
  const isOnline = useOnlineStatus();
  const { triggerEmergency } = useEmergency();

  // Default coordinates (Santiago, Chile) if project doesn't have specific ones
  const lat = -33.4569;
  const lon = -70.6483;

  const weather = environment?.weather;

  // Fetch IoT Events
  const { data: iotEvents } = useFirestoreCollection<IoTEvent>(
    'telemetry_events',
    [orderBy('timestamp', 'desc'), limit(10)]
  );

  const handleConnectGoogleFit = async () => {
    setIsConnectingFit(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_URL || ''}/api/auth/google/url`);
      if (!response.ok) throw new Error('Failed to get auth URL');
      const { url } = await response.json();

      const authWindow = window.open(
        url,
        'google_fit_auth',
        'width=600,height=700'
      );

      if (!authWindow) {
        alert('Por favor, permite las ventanas emergentes (popups) para conectar Google Fit.');
        setIsConnectingFit(false);
      }
    } catch (error) {
      console.error('Error connecting to Google Fit:', error);
      setIsConnectingFit(false);
    }
  };

  const fetchFitnessData = useCallback(async (tokens: any) => {
    try {
      const response = await fetch(`${import.meta.env.VITE_APP_URL || ''}/api/fitness/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens })
      });

      if (!response.ok) throw new Error('Failed to fetch fitness data');
      
      const { data } = await response.json();
      
      // Parse Google Fit aggregate data
      let heartRate = null;
      let steps = null;

      if (data && data.bucket && data.bucket.length > 0) {
        const bucket = data.bucket[0];
        bucket.dataset.forEach((dataset: any) => {
          if (dataset.dataSourceId.includes('heart_rate') && dataset.point.length > 0) {
            // Get the average heart rate from the aggregate
            const hrPoint = dataset.point[dataset.point.length - 1];
            if (hrPoint.value && hrPoint.value.length > 0) {
              heartRate = Math.round(hrPoint.value[0].fpVal || hrPoint.value[0].intVal);
            }
          }
          if (dataset.dataSourceId.includes('step_count') && dataset.point.length > 0) {
            const stepPoint = dataset.point[dataset.point.length - 1];
            if (stepPoint.value && stepPoint.value.length > 0) {
              steps = stepPoint.value[0].intVal;
            }
          }
        });
      }

      setFitnessData({
        heartRate,
        steps,
        lastSync: new Date()
      });
      
      // If we got critical heart rate, generate an alert
      if (heartRate && heartRate > 120) {
        setAlerts(prev => {
          const msg = `Alerta Wearable: Ritmo cardíaco elevado detectado (${heartRate} bpm). Posible fatiga o estrés térmico.`;
          return prev.includes(msg) ? prev : [...prev, msg];
        });
      }

    } catch (error) {
      console.error('Error fetching fitness data:', error);
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS' && event.data.tokens) {
        setFitTokens(event.data.tokens);
        setIsConnectingFit(false);
        fetchFitnessData(event.data.tokens);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchFitnessData]);

  // Refresh fitness data periodically if connected
  useEffect(() => {
    if (!fitTokens) return;
    const interval = setInterval(() => {
      fetchFitnessData(fitTokens);
    }, 5 * 60 * 1000); // Every 5 minutes
    return () => clearInterval(interval);
  }, [fitTokens, fetchFitnessData]);

  const handleSimulateIoT = async () => {
    if (!isOnline) return;
    setSimulatingIoT(true);
    try {
      const context = `Proyecto: ${selectedProject?.name || 'Global'}. Clima: ${weather?.temp || 20}°C, Viento: ${weather?.windSpeed || 10}km/h.`;
      const eventData = await generateRealisticIoTEvent(context);
      
      try {
        await addDoc(collection(db, 'telemetry_events'), {
          ...eventData,
          timestamp: serverTimestamp(),
          projectId: selectedProject?.id || 'global'
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'telemetry_events');
      }
    } catch (error) {
      console.error('Error simulating IoT event:', error);
    } finally {
      setSimulatingIoT(false);
    }
  };

  useEffect(() => {
    const fetchTelemetryData = async () => {
      if (!isOnline) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        // Fetch Earthquakes (Chile)
        const eqResponse = await fetch('https://api.gael.cloud/general/public/sismos');
        if (eqResponse.ok) {
          const eqData = await eqResponse.json();
          setEarthquakes(eqData.slice(0, 5)); // Get latest 5
          
          // Check for recent strong earthquakes
          const strongEQ = eqData.find((eq: Earthquake) => parseFloat(eq.Magnitud) >= 5.0);
          if (strongEQ) {
            setAlerts(prev => {
              const msg = `Sismo de magnitud ${strongEQ.Magnitud} detectado en ${strongEQ.RefGeografica}. Protocolo de evacuación en evaluación.`;
              return prev.includes(msg) ? prev : [...prev, msg];
            });
            
            // Trigger emergency if magnitude >= 6.0
            if (parseFloat(strongEQ.Magnitud) >= 6.0) {
              triggerEmergency('sismo');
            }
          }
        }
      } catch (error) {
        console.error('Error fetching telemetry:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTelemetryData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchTelemetryData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [lat, lon, isOnline]);

  // Check weather alerts
  useEffect(() => {
    if (weather) {
      if (weather.windSpeed > 40) {
        setAlerts(prev => {
          const msg = `Vientos fuertes detectados (${Math.round(weather.windSpeed)} km/h). Sugerencia: Suspender trabajos en altura y maniobras de izaje (D.S. 594).`;
          return prev.includes(msg) ? prev : [...prev, msg];
        });
      }
      if (weather.temp > 32) {
        setAlerts(prev => {
          const msg = `Estrés térmico extremo (${Math.round(weather.temp)}°C). Activar protocolo de hidratación y pausas activas.`;
          return prev.includes(msg) ? prev : [...prev, msg];
        });
      }
    }
  }, [weather]);

  // Check IoT events for alerts
  useEffect(() => {
    if (iotEvents && iotEvents.length > 0) {
      const latestEvent = iotEvents[0];
      if (latestEvent.status === 'critical') {
        const alertMsg = `Alerta Crítica IoT: ${latestEvent.source} reporta ${latestEvent.metric} = ${latestEvent.value}${latestEvent.unit}`;
        setAlerts(prev => prev.includes(alertMsg) ? prev : [...prev, alertMsg]);
        
        // Trigger global emergency for critical events
        triggerEmergency('iot_critical');
      }
    }
  }, [iotEvents, triggerEmergency]);

  const handleSaveAlertToZettelkasten = async (alertMsg: string) => {
    if (!selectedProject) return;
    
    await addNode({
      type: NodeType.INCIDENT,
      title: 'Alerta Telemetría Ambiental',
      description: alertMsg,
      tags: ['telemetría', 'alerta', 'clima', 'sismo', 'iot'],
      metadata: { source: 'Telemetry API', autoGenerated: true },
      connections: [],
      projectId: selectedProject.id
    });
    
    // Remove from active alerts after saving
    setAlerts(prev => prev.filter(a => a !== alertMsg));
  };

  // Map IoT events to Digital Twin state
  const twinState = useMemo(() => {
    const workers: WorkerData[] = [
      { id: 'W-01', position: [-2, 0, 2], status: 'normal' },
      { id: 'W-02', position: [3, 0, -1], status: 'normal' },
      { id: 'W-03', position: [0, 0, 4], status: 'normal' },
      { id: 'W-04', position: [-4, 0, -3], status: 'normal' },
    ];

    const machinery: MachineryData[] = [
      { id: 'M-01', type: 'truck', position: [5, 0, 5], status: 'normal' },
      { id: 'M-02', type: 'crane', position: [-5, 0, 0], status: 'normal' },
    ];

    // Apply recent events to update state
    if (iotEvents) {
      iotEvents.forEach(event => {
        if (event.type === 'wearable') {
          // Find a worker to apply this to (simple mapping based on source name or just pick one)
          const workerIndex = parseInt(event.source.replace(/\D/g, '')) % workers.length || 0;
          const worker = workers[workerIndex];
          
          // Only update if this event is more critical than current state
          if (event.status === 'critical' || (event.status === 'warning' && worker.status === 'normal')) {
            worker.status = event.status;
            // If it's a fall detection or extreme heart rate, mark as fallen
            if (String(event.metric || '').toLowerCase().includes('caída') || (String(event.metric || '').toLowerCase().includes('ritmo') && event.value > 160)) {
              worker.isFallen = true;
            }
          }
        } else if (event.type === 'machinery') {
          const machIndex = parseInt(event.source.replace(/\D/g, '')) % machinery.length || 0;
          const mach = machinery[machIndex];
          if (event.status === 'critical' || (event.status === 'warning' && mach.status === 'normal')) {
            mach.status = event.status;
          }
        }
      });
    }

    // Save to local storage for other components (like Evacuation) to access
    localStorage.setItem('telemetry_state', JSON.stringify({ workers, machinery }));

    return { workers, machinery };
  }, [iotEvents]);

  const webhookUrl = `${window.location.origin}/api/telemetry/ingest`;
  const curlCommand = `curl -X POST ${webhookUrl} \\
  -H "Content-Type: application/json" \\
  -d '{
    "secretKey": "praeventio-iot-secret-2026",
    "type": "wearable",
    "source": "Smartwatch W-01",
    "metric": "Ritmo Cardíaco",
    "value": 165,
    "unit": "bpm",
    "status": "critical",
    "projectId": "${selectedProject?.id || 'global'}"
  }'`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <PremiumFeatureGuard featureName="Telemetría y Digital Twins" description="Conecta sensores IoT, wearables y maquinaria para monitorear el estado de tu faena en tiempo real.">
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="bg-blue-500/10 p-3 sm:p-4 rounded-2xl sm:rounded-3xl border border-blue-500/20 shrink-0">
            <Activity className="w-6 h-6 sm:w-8 sm:h-8 text-blue-500" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-white leading-tight">Telemetría Ambiental</h1>
            <p className="text-zinc-500 text-[10px] sm:text-sm font-medium mt-1">Monitor Sísmico y Climático en Tiempo Real</p>
          </div>
        </div>
        
        {selectedProject && (
          <div className="flex items-center gap-2 bg-zinc-900/50 border border-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl self-start md:self-auto">
            <MapPin className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-500" />
            <span className="text-[8px] sm:text-[10px] font-black text-zinc-400 uppercase tracking-widest">{selectedProject.location || 'Ubicación no definida'}</span>
          </div>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-rose-500 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4" />
            Alertas Críticas Activas
          </h2>
          {alerts.map((alert, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
                <p className="text-sm font-medium text-rose-200">{alert}</p>
              </div>
              <button 
                onClick={() => handleSaveAlertToZettelkasten(alert)}
                className="bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors shrink-0 flex items-center gap-2"
              >
                <Zap className="w-3 h-3" />
                Registrar en Red Neuronal
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Weather Panel */}
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
                <CloudLightning className="w-4 h-4 text-blue-400" />
                Condiciones Climáticas
              </h3>
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Open-Meteo API</span>
            </div>

            {weather ? (
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
                  <ThermometerSun className={`w-8 h-8 ${weather.temp > 30 ? 'text-rose-500' : 'text-amber-500'}`} />
                  <div>
                    <p className="text-2xl font-black text-white">{Math.round(weather.temp)}°C</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Temperatura</p>
                  </div>
                </div>
                <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
                  <Wind className={`w-8 h-8 ${weather.windSpeed > 40 ? 'text-rose-500' : 'text-blue-400'}`} />
                  <div>
                    <p className="text-2xl font-black text-white">{Math.round(weather.windSpeed)} <span className="text-sm">km/h</span></p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Viento</p>
                  </div>
                </div>
              </div>
            ) : !isOnline ? (
              <div className="flex flex-col items-center justify-center py-8 text-center bg-zinc-950/50 rounded-2xl border border-white/5">
                <WifiOff className="w-8 h-8 text-zinc-600 mb-2" />
                <p className="text-sm font-medium text-zinc-400">Sin conexión</p>
                <p className="text-xs text-zinc-500">No se pueden obtener datos climáticos en tiempo real.</p>
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No se pudo cargar la información climática.</p>
            )}
          </div>

          {/* Earthquakes Panel */}
          <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-rose-500" />
                Monitor Sísmico (CSN)
              </h3>
              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">Últimos 5 eventos</span>
            </div>

            <div className="space-y-3">
              {!isOnline ? (
                <div className="flex flex-col items-center justify-center py-8 text-center bg-zinc-950/50 rounded-2xl border border-white/5">
                  <WifiOff className="w-8 h-8 text-zinc-600 mb-2" />
                  <p className="text-sm font-medium text-zinc-400">Sin conexión</p>
                  <p className="text-xs text-zinc-500">No se pueden obtener datos sísmicos en tiempo real.</p>
                </div>
              ) : earthquakes.length > 0 ? (
                earthquakes.map((eq, i) => (
                  <div key={i} className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg ${
                        parseFloat(eq.Magnitud) >= 5.0 ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30' :
                        parseFloat(eq.Magnitud) >= 4.0 ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30' :
                        'bg-zinc-800 text-zinc-400'
                      }`}>
                        {eq.Magnitud}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{eq.RefGeografica}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          <span className="text-[10px] font-medium text-zinc-500">{eq.Fecha}</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right hidden sm:block">
                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Profundidad</p>
                      <p className="text-xs font-medium text-zinc-300">{eq.Profundidad} km</p>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No se pudo cargar la información sísmica.</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* IoT Telemetry Panel */}
        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
                <Watch className="w-4 h-4 text-emerald-500" />
                Telemetría IoT (Maquinaria)
              </h3>
              <span className="px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase tracking-widest border border-emerald-500/20">
                En Vivo
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSimulateIoT}
                disabled={simulatingIoT || !isOnline}
                className="px-4 py-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {simulatingIoT ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Simular
              </button>
              <button
                onClick={() => setShowWebhookModal(true)}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2"
              >
                <Terminal className="w-3 h-3" />
                Webhook
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {iotEvents && iotEvents.length > 0 ? (
              iotEvents.map((event) => (
                <motion.div 
                  key={event.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  className={`bg-zinc-950/50 border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                    event.status === 'critical' ? 'border-rose-500/30' :
                    event.status === 'warning' ? 'border-amber-500/30' :
                    'border-white/5'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                      event.status === 'critical' ? 'bg-rose-500/20 text-rose-500' :
                      event.status === 'warning' ? 'bg-amber-500/20 text-amber-500' :
                      'bg-emerald-500/20 text-emerald-500'
                    }`}>
                      {event.type === 'wearable' ? <HeartPulse className="w-6 h-6" /> : <Truck className="w-6 h-6" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{event.source}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-md ${
                          event.status === 'critical' ? 'bg-rose-500/20 text-rose-500' :
                          event.status === 'warning' ? 'bg-amber-500/20 text-amber-500' :
                          'bg-emerald-500/20 text-emerald-500'
                        }`}>
                          {event.status === 'critical' ? 'Crítico' : event.status === 'warning' ? 'Advertencia' : 'Normal'}
                        </span>
                        <span className="text-[10px] font-medium text-zinc-500">
                          {event.timestamp?.toDate ? event.timestamp.toDate().toLocaleTimeString() : 'Ahora'}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-left sm:text-right bg-zinc-900 rounded-xl px-4 py-2 border border-white/5">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{event.metric}</p>
                    <p className={`text-lg font-black ${
                      event.status === 'critical' ? 'text-rose-500' :
                      event.status === 'warning' ? 'text-amber-500' :
                      'text-white'
                    }`}>
                      {event.value} <span className="text-xs text-zinc-500">{event.unit}</span>
                    </p>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="text-center py-12 bg-zinc-950/50 rounded-2xl border border-white/5">
                <Watch className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
                <p className="text-sm font-medium text-zinc-400">Esperando datos de telemetría IoT...</p>
                <p className="text-xs text-zinc-600 mt-1">Conecta tus dispositivos usando el Webhook Generator.</p>
              </div>
            )}
          </div>
        </div>

        {/* Google Fit Panel */}
        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-widest text-white flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-blue-500" />
              Wearables (Google Fit)
            </h3>
            {!fitTokens && (
              <button
                onClick={handleConnectGoogleFit}
                disabled={isConnectingFit}
                className="px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {isConnectingFit ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                Conectar
              </button>
            )}
            {fitTokens && (
              <span className="px-2 py-1 rounded-md bg-blue-500/10 text-blue-500 text-[9px] font-black uppercase tracking-widest border border-blue-500/20">
                Conectado
              </span>
            )}
          </div>

          {fitTokens ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
                  <HeartPulse className={`w-8 h-8 ${fitnessData.heartRate && fitnessData.heartRate > 100 ? 'text-rose-500' : 'text-rose-400'}`} />
                  <div>
                    <p className="text-2xl font-black text-white">{fitnessData.heartRate || '--'} <span className="text-sm">bpm</span></p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Ritmo Cardíaco</p>
                  </div>
                </div>
                <div className="bg-zinc-950/50 border border-white/5 rounded-2xl p-4 flex flex-col items-center justify-center text-center gap-2">
                  <Activity className="w-8 h-8 text-emerald-400" />
                  <div>
                    <p className="text-2xl font-black text-white">{fitnessData.steps ? fitnessData.steps.toLocaleString() : '--'}</p>
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Pasos (7 días)</p>
                  </div>
                </div>
              </div>
              {fitnessData.lastSync && (
                <p className="text-[10px] text-center text-zinc-500 font-medium">
                  Última sincronización: {fitnessData.lastSync.toLocaleTimeString()}
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-12 bg-zinc-950/50 rounded-2xl border border-white/5">
              <Smartphone className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
              <p className="text-sm font-medium text-zinc-400">Google Fit no conectado</p>
              <p className="text-xs text-zinc-600 mt-1">Conecta tu cuenta para acceder a datos reales de wearables y análisis biométrico.</p>
            </div>
          )}
        </div>
      </div>

      {/* Digital Twin 3D */}
      <div className="mt-8">
        <DigitalTwin workers={twinState.workers} machinery={twinState.machinery} />
      </div>

      {/* Webhook Modal */}
      <AnimatePresence>
        {showWebhookModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-zinc-900 border border-white/10 rounded-3xl p-6 max-w-2xl w-full shadow-2xl"
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
                    <Terminal className="w-5 h-5 text-emerald-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight">IoT Webhook Generator</h3>
                    <p className="text-xs text-zinc-400">Conecta hardware real a Praeventio Guard</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowWebhookModal(false)}
                  className="p-2 hover:bg-white/10 rounded-xl transition-colors"
                >
                  <X className="w-5 h-5 text-zinc-400" />
                </button>
              </div>

              <div className="space-y-4">
                <p className="text-sm text-zinc-300">
                  Usa este comando en la terminal de tu dispositivo IoT (Raspberry Pi, Arduino con WiFi, etc.) para enviar datos reales al sistema. Verás cómo el Digital Twin y las alertas reaccionan instantáneamente.
                </p>

                <div className="relative group">
                  <pre className="bg-black border border-white/10 rounded-xl p-4 overflow-x-auto text-xs font-mono text-emerald-400 leading-relaxed">
                    {curlCommand}
                  </pre>
                  <button
                    onClick={copyToClipboard}
                    className="absolute top-3 right-3 p-2 bg-white/10 hover:bg-white/20 rounded-lg backdrop-blur-md transition-colors"
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-zinc-300" />}
                  </button>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
                  <h4 className="text-xs font-bold text-blue-400 uppercase tracking-widest mb-2">Variables Soportadas</h4>
                  <ul className="text-xs text-blue-200/70 space-y-1 list-disc list-inside">
                    <li><strong className="text-blue-300">type:</strong> "wearable" | "machinery"</li>
                    <li><strong className="text-blue-300">status:</strong> "normal" | "warning" | "critical"</li>
                    <li><strong className="text-blue-300">metric:</strong> "Ritmo Cardíaco", "Temperatura", "Velocidad", "Detección de Caída"</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
    </PremiumFeatureGuard>
  );
}
