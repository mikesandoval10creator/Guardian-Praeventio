import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../utils/logger';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/shared/ToastContainer';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Wind,
  ThermometerSun,
  AlertTriangle,
  MapPin,
} from 'lucide-react';
import { useProject } from '../contexts/ProjectContext';
import { useRiskEngine } from '../hooks/useRiskEngine';
import { useUniversalKnowledge } from '../contexts/UniversalKnowledgeContext';
import { NodeType } from '../types';
import { useFirestoreCollection } from '../hooks/useFirestoreCollection';
import { collection, addDoc, serverTimestamp, orderBy, limit } from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../services/firebase';
import { DigitalTwin } from '../components/telemetry/DigitalTwin';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import { useEmergency } from '../contexts/EmergencyContext';
import { set } from 'idb-keyval';

import { generateRealisticIoTEvent } from '../services/geminiService';
import { getHealthAdapter } from '../services/health';

import { GamifiedHUD, type StatusEffect } from '../components/telemetry/GamifiedHUD';
import { ActiveAlertsList } from '../components/telemetry/ActiveAlertsList';
import { generateDikeNode } from '../services/zettelkasten/bernoulli/dikeHydrostaticMonitor';
import { generateMicroWindNode } from '../services/zettelkasten/bernoulli/microWindEnergy';
import { writeNodesDebounced } from '../services/zettelkasten/persistence/writeNode';
import {
  WeatherAndSeismicPanels,
  type Earthquake,
} from '../components/telemetry/WeatherAndSeismicPanels';
import { IoTEventsFeed, type IoTEvent } from '../components/telemetry/IoTEventsFeed';
import { WearablesPanel, type FitnessData } from '../components/telemetry/WearablesPanel';
import { WebhookModal } from '../components/telemetry/WebhookModal';
import { mapIoTEventsToTwinState } from '../components/telemetry/twinStateMapper';
import { buildWebhookCurlCommand } from '../components/telemetry/webhookCommand';

export function Telemetry() {
  const { t } = useTranslation();
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
  const { toasts, show: showToast, dismiss } = useToast();

  // Gamified HUD State
  const [health, setHealth] = useState(100);
  const [toxin, setToxin] = useState(0);
  const [effects, setEffects] = useState<StatusEffect[]>([]);

  // Bucket B.3 — Dike hydrostatic monitor (DS 248/2007, Resolución 1500 SERNAGEOMIN).
  const [dikeHeight, setDikeHeight] = useState<number | ''>(15);
  const [dikePerimeter, setDikePerimeter] = useState<number | ''>(800);
  const [piezoDepth, setPiezoDepth] = useState<number | ''>(10);
  const [piezoPressureKpa, setPiezoPressureKpa] = useState<number | ''>(110);
  const [dikeStatus, setDikeStatus] = useState<string | null>(null);

  // Sprint 25 Bucket NN — Micro-wind energy (Betz · IEC 61400-2).
  const [microWindKmh, setMicroWindKmh] = useState<number | ''>(20);
  const [turbineHeightM, setTurbineHeightM] = useState<number | ''>(8);
  const [rotorAreaM2, setRotorAreaM2] = useState<number | ''>(1.5);
  const microWindResult = useMemo(() => {
    const w = Number(microWindKmh);
    const h = Number(turbineHeightM);
    const a = Number(rotorAreaM2);
    if (w <= 0 || h <= 0 || a <= 0) return null;
    // Funnel factor heurístico por altura (más altura → menos turbulencia, más laminar).
    const funnelFactor = h >= 10 ? 1.2 : 1.0;
    const node = generateMicroWindNode(
      { id: `wind-site-h${h}`, funnelFactor, rotorAreaM2: a },
      { windKmh: w },
    );
    const projectId = selectedProject?.id;
    if (node) {
      logger.info('zettelkasten:micro-wind', { node });
      if (projectId) writeNodesDebounced([node], { projectId });
    }
    // P_W → kWh/día = P_W * 24h / 1000
    const powerW = node?.metadata?.powerW as number | undefined;
    const kwhPerDay = powerW ? (powerW * 24) / 1000 : 0;
    return { node, kwhPerDay, powerW: powerW ?? 0 };
  }, [microWindKmh, turbineHeightM, rotorAreaM2, selectedProject?.id]);

  const handleDikeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const projectId = selectedProject?.id;
    if (!projectId) {
      setDikeStatus('Selecciona un proyecto antes de evaluar.');
      return;
    }
    const h = Number(dikeHeight);
    const depth = Number(piezoDepth);
    const pressurePa = Number(piezoPressureKpa) * 1000;
    if (h <= 0 || depth <= 0 || pressurePa <= 0) {
      setDikeStatus('Datos inválidos.');
      return;
    }
    const node = generateDikeNode(
      { id: `dike-${selectedProject?.name ?? projectId}`, heightM: h, fluidDensityKgM3: 1500 },
      [{ id: `piezo-1`, depthM: depth, measuredPressurePa: pressurePa }],
    );
    if (node) {
      writeNodesDebounced([node], { projectId });
      setDikeStatus(`Anomalía piezométrica detectada (severidad: ${node.severity}). Nodo enviado al Zettelkasten.`);
    } else {
      setDikeStatus(`Lectura dentro de tolerancia (perímetro ${dikePerimeter} m). Sin alerta.`);
    }
  };

  // Default coordinates (Santiago, Chile) if project doesn't have specific ones
  const lat = -33.4569;
  const lon = -70.6483;

  const weather = environment?.weather;

  // Fetch IoT Events
  const { data: iotEvents } = useFirestoreCollection<IoTEvent>(
    'telemetry_events',
    [orderBy('timestamp', 'desc'), limit(10)]
  );

  const handleConnectBluetooth = async () => {
    try {
      const nav = navigator as any;
      if (!nav.bluetooth) {
        setAlerts(prev => [...prev, 'Web Bluetooth API no está soportada en este navegador. Usa Chrome o Edge.']);
        return;
      }

      setIsConnectingFit(true);
      const device = await nav.bluetooth.requestDevice({
        filters: [{ services: ['heart_rate'] }],
        optionalServices: ['battery_service']
      });

      const server = await device.gatt?.connect();
      if (!server) throw new Error('No se pudo conectar al GATT server');

      const service = await server.getPrimaryService('heart_rate');
      const characteristic = await service.getCharacteristic('heart_rate_measurement');

      await characteristic.startNotifications();

      characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
        const value = event.target.value;
        // Heart Rate Measurement format:
        // Flags (8 bits) + Heart Rate Measurement Value (8 or 16 bits)
        const flags = value.getUint8(0);
        const format = flags & 0x01;
        let heartRate;
        if (format === 0) {
          heartRate = value.getUint8(1);
        } else {
          heartRate = value.getUint16(1, true); // true for little-endian
        }

        setFitnessData(prev => ({
          ...prev,
          heartRate,
          lastSync: new Date()
        }));

        if (heartRate > 120) {
          setAlerts(prev => {
            const msg = `Alerta BLE: Ritmo cardíaco elevado (${heartRate} bpm).`;
            return prev.includes(msg) ? prev : [...prev, msg];
          });
        }
      });

      setFitTokens({ connected: true, deviceName: device.name });
      setIsConnectingFit(false);
      setAlerts(prev => [...prev, `Conectado a ${device.name} vía Bluetooth.`]);
    } catch (error) {
      logger.error('Error connecting to Bluetooth device', { error });
      setIsConnectingFit(false);
      // alert('Error al conectar con el dispositivo Bluetooth.');
    }
  };

  const handleConnectGoogleFit = async () => {
    setIsConnectingFit(true);

    // Round 3 phase 1 of HEALTH_CONNECT_MIGRATION.md — prefer the on-device
    // health adapter (Health Connect on Android, HealthKit on iOS). The
    // legacy Google Fit OAuth popup is the web/desktop fallback only and
    // is scheduled for full removal once `/api/fitness/sync` sunsets
    // (2026-12-31, see server.ts Sunset header).
    const adapter = getHealthAdapter();
    if (adapter.name === 'health-connect' || adapter.name === 'healthkit') {
      const label = adapter.name === 'healthkit' ? 'HealthKit' : 'Health Connect';
      try {
        const result = await adapter.requestPermissions(['heart-rate', 'steps']);
        if (result.granted.length === 0) {
          showToast(`No se concedieron permisos de ${label}.`, 'warning');
          setIsConnectingFit(false);
          return;
        }
        setFitTokens({ linked: true, viaNativeHealth: true, adapter: adapter.name });
        setIsConnectingFit(false);
        fetchFitnessData();
        return;
      } catch (error) {
        console.error(`Error requesting ${label} permissions:`, error);
        setIsConnectingFit(false);
        return;
      }
    }

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');
      const response = await fetch(`${import.meta.env.VITE_APP_URL || ''}/api/auth/google/url`, {
        headers: { 'Authorization': `Bearer ${idToken}` }
      });
      if (!response.ok) throw new Error('Failed to get auth URL');
      const { url } = await response.json();

      const authWindow = window.open(
        url,
        'google_fit_auth',
        'width=600,height=700'
      );

      if (!authWindow) {
        setAlerts(prev => [...prev, 'Permite las ventanas emergentes (popups) en el navegador para conectar Google Fit.']);
        setIsConnectingFit(false);
      }
    } catch (error) {
      logger.error('Error connecting to Google Fit', { error });
      setIsConnectingFit(false);
    }
  };

  const fetchFitnessData = useCallback(async () => {
    // Round 3 phase 1 — when the facade picks an on-device adapter (Health
    // Connect on Android, HealthKit on iOS), read samples directly and skip
    // the legacy server hop. The /api/fitness/sync POST below is the
    // deprecated Google Fit fallback, kept alive until 2026-12-31 (see
    // server.ts Sunset header) for web users only.
    try {
      const adapter = getHealthAdapter();
      if (adapter.name === 'health-connect' || adapter.name === 'healthkit') {
        const end = new Date();
        const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        const [hrSamples, stepSamples] = await Promise.all([
          adapter.readHeartRate({ start, end }),
          adapter.readSteps({ start, end }),
        ]);

        const latestHr = hrSamples.length > 0 ? hrSamples[hrSamples.length - 1].bpm : null;
        const totalSteps =
          stepSamples.length > 0
            ? stepSamples.reduce((sum, s) => sum + s.count, 0)
            : null;

        setFitnessData({
          heartRate: latestHr,
          steps: totalSteps,
          lastSync: new Date(),
        });

        if (latestHr && latestHr > 120) {
          setAlerts(prev => {
            const msg = `Alerta Wearable: Ritmo cardíaco elevado detectado (${latestHr} bpm). Posible fatiga o estrés térmico.`;
            return prev.includes(msg) ? prev : [...prev, msg];
          });
        }
        return;
      }
    } catch (error) {
      console.error('Native health adapter read failed; falling back to Google Fit:', error);
      // fall through to the deprecated server path
    }

    // TODO(round-4-phase-2): once production telemetry confirms zero hits on
    // /api/fitness/sync (track via the structured `fitness_sync_deprecated_called`
    // log added in server.ts) AND the iOS/Android consent screens have been
    // re-verified by Google with the reduced sensitive-scope set, delete the
    // remaining Google Fit aggregate-parsing block below + remove the legacy
    // OAuth popup branch in handleConnectGoogleFit. Sunset: 2026-12-31.

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Not authenticated');
      const response = await fetch(`${import.meta.env.VITE_APP_URL || ''}/api/fitness/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });

      if (!response.ok) throw new Error('Failed to fetch fitness data');

      const { data } = await response.json();

      // Parse Google Fit aggregate data
      let heartRate: number | null = null;
      let steps: number | null = null;

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
      logger.error('Error fetching fitness data', { error });
    }
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // The popup posts { type, linked: true } after the server has stored
      // the OAuth tokens in Firestore. No tokens travel through the browser.
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS' && event.data.linked) {
        setFitTokens({ linked: true });
        setIsConnectingFit(false);
        fetchFitnessData();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchFitnessData]);

  // Refresh fitness data periodically if connected
  useEffect(() => {
    if (!fitTokens) return undefined;
    const interval = setInterval(() => {
      fetchFitnessData();
    }, 5 * 60 * 1000); // Every 5 minutes
    return () => clearInterval(interval);
  }, [fitTokens, fetchFitnessData]);

  const handleSimulateIoT = async () => {
    if (!isOnline) return;
    setSimulatingIoT(true);
    try {
      const context = `Proyecto: ${selectedProject?.name || 'Global'}. Clima: ${weather?.temp || 20}°C, Viento: ${weather?.windSpeed || 10}km/h.`;
      const eventData = await generateRealisticIoTEvent(context);

      // Edge IoT Filter: Only upload anomalous events to save bandwidth/storage.
      // Route through /api/telemetry/ingest so autoValidateTelemetry runs on the backend.
      if (eventData.status === 'warning' || eventData.status === 'critical') {
        try {
          const token = await auth.currentUser?.getIdToken();
          await fetch('/api/telemetry/ingest', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              ...eventData,
              projectId: selectedProject?.id || 'global',
            }),
          });
        } catch (error) {
          logger.error('Error ingesting telemetry event', { error });
        }
      } else {
        logger.debug('Edge IoT filter: normal event filtered locally', { status: eventData.status });
      }
    } catch (error) {
      logger.error('Error simulating IoT event', { error });
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
        logger.error('Error fetching telemetry', { error });
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
    if (weather && typeof weather.windSpeed === 'number') {
      if (weather.windSpeed > 40) {
        setAlerts(prev => {
          const msg = `Vientos fuertes detectados (${Math.round(weather.windSpeed!)} km/h). Sugerencia: Suspender trabajos en altura y maniobras de izaje (D.S. 594).`;
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

  // Map IoT events to Digital Twin state (pure helper — see twinStateMapper.ts)
  const twinState = useMemo(() => {
    const next = mapIoTEventsToTwinState(iotEvents);
    // Save to IndexedDB for other components (like Evacuation) to access
    set('telemetry_state', next);
    return next;
  }, [iotEvents]);

  const webhookUrl = `${window.location.origin}/api/telemetry/ingest`;
  const curlCommand = buildWebhookCurlCommand(webhookUrl, selectedProject?.id || 'global');

  const copyToClipboard = () => {
    navigator.clipboard.writeText(curlCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSimulateGasLeak = () => {
    setToxin(prev => Math.min(prev + 20, 100));
    if (toxin >= 60) setHealth(prev => Math.max(prev - 10, 0));
    setEffects(prev => [
      ...prev.filter(e => e.id !== 'gas'),
      { id: 'gas', name: 'Intoxicación', type: 'debuff', duration: 30, icon: <Wind className="w-3 h-3" /> },
    ]);
  };

  const handleHeal = () => {
    setHealth(100);
    setToxin(0);
    setEffects([]);
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
            <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter text-white leading-tight">{t('telemetry.title', 'Telemetría Ambiental')}</h1>
            <p className="text-zinc-500 text-[10px] sm:text-sm font-medium mt-1">{t('telemetry.subtitle', 'Monitor Sísmico y Climático en Tiempo Real')}</p>
          </div>
        </div>

        {selectedProject && (
          <div className="flex items-center gap-2 bg-zinc-900/50 border border-white/10 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl self-start md:self-auto">
            <MapPin className="w-3 h-3 sm:w-4 sm:h-4 text-emerald-500" />
            <span className="text-[8px] sm:text-[10px] font-black text-zinc-400 uppercase tracking-widest">{selectedProject.location || 'Ubicación no definida'}</span>
          </div>
        )}
      </div>

      <GamifiedHUD
        health={health}
        toxin={toxin}
        effects={effects}
        onSimulateGasLeak={handleSimulateGasLeak}
        onHeal={handleHeal}
      />

      <ActiveAlertsList alerts={alerts} onSaveToZettelkasten={handleSaveAlertToZettelkasten} />

      <WeatherAndSeismicPanels
        loading={loading}
        isOnline={isOnline}
        weather={weather}
        earthquakes={earthquakes}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <IoTEventsFeed
          events={iotEvents}
          simulating={simulatingIoT}
          isOnline={isOnline}
          onSimulate={handleSimulateIoT}
          onOpenWebhookModal={() => setShowWebhookModal(true)}
        />

        <WearablesPanel
          fitnessData={fitnessData}
          fitTokens={fitTokens}
          isConnecting={isConnectingFit}
          onConnectBluetooth={handleConnectBluetooth}
          onConnectGoogleFit={handleConnectGoogleFit}
        />
      </div>

      {/* Bucket B.3 — Dike hydrostatic monitor */}
      <div className="mt-6 bg-zinc-900/60 border border-white/5 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
            <ThermometerSun className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-white">{t('telemetry.damMonitoring', 'Monitoreo de represas hidrostáticas')}</h3>
            <p className="text-[10px] text-zinc-500">DS 248/2007 — Resolución 1500 SERNAGEOMIN</p>
          </div>
        </div>
        <form onSubmit={handleDikeSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Altura del agua (m)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={dikeHeight}
              onChange={(e) => setDikeHeight(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Perímetro (m)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={dikePerimeter}
              onChange={(e) => setDikePerimeter(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Profundidad piezómetro (m)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={piezoDepth}
              onChange={(e) => setPiezoDepth(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Presión medida (kPa)</label>
            <input
              type="number"
              min="0"
              step="any"
              value={piezoPressureKpa}
              onChange={(e) => setPiezoPressureKpa(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="md:col-span-4">
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-black uppercase tracking-widest transition-colors"
            >
              Evaluar lectura
            </button>
          </div>
          {dikeStatus && (
            <div className="md:col-span-4 p-3 rounded-lg bg-zinc-800/60 border border-white/5 text-xs text-zinc-300">
              {dikeStatus}
            </div>
          )}
        </form>
      </div>

      {/* Sprint 25 Bucket NN — Generación micro-eólica (Betz · IEC 61400-2). */}
      <div className="mt-6 bg-zinc-900/60 border border-white/5 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-xl bg-teal-500/10 border border-teal-500/20">
            <Wind className="w-4 h-4 text-teal-400" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-widest text-white">{t('telemetry.microWindGen', 'Generación micro-eólica')}</h3>
            <p className="text-[10px] text-zinc-500">NCh Elec.4/2003 · IEC 61400-2 · Límite Betz 0.593</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Viento promedio (km/h)</label>
            <input type="number" min="0" step="any" value={microWindKmh}
              onChange={(e) => setMicroWindKmh(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Altura turbina (m)</label>
            <input type="number" min="0" step="any" value={turbineHeightM}
              onChange={(e) => setTurbineHeightM(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-zinc-400 uppercase tracking-widest mb-1">Área barrida (m²)</label>
            <input type="number" min="0" step="any" value={rotorAreaM2}
              onChange={(e) => setRotorAreaM2(e.target.value ? Number(e.target.value) : '')}
              className="w-full bg-zinc-800 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
          </div>
          {microWindResult && (
            <div className="rounded-lg px-3 py-2 border bg-teal-500/10 border-teal-500/20">
              <p className="text-[10px] font-bold text-teal-300 uppercase tracking-widest">kWh/día estimado</p>
              <p className="text-lg font-black text-teal-400">{microWindResult.kwhPerDay.toFixed(2)}</p>
              <p className="text-[10px] text-zinc-400">{(microWindResult.powerW).toFixed(1)} W instantáneos</p>
            </div>
          )}
        </div>
      </div>

      {/* Digital Twin 3D */}
      <div className="mt-8">
        <DigitalTwin workers={twinState.workers} machinery={twinState.machinery} />
      </div>

      <WebhookModal
        open={showWebhookModal}
        curlCommand={curlCommand}
        copied={copied}
        onClose={() => setShowWebhookModal(false)}
        onCopy={copyToClipboard}
      />
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </div>
    </PremiumFeatureGuard>
  );
}
