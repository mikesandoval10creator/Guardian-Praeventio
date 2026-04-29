import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  Wind,
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

  // Gamified HUD State
  const [health, setHealth] = useState(100);
  const [toxin, setToxin] = useState(0);
  const [effects, setEffects] = useState<StatusEffect[]>([]);

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
        alert('Web Bluetooth API no está soportada en este navegador. Usa Chrome o Edge.');
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
      alert(`Conectado a ${device.name}`);
    } catch (error) {
      console.error('Error connecting to Bluetooth device:', error);
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
          alert(`No se concedieron permisos de ${label}.`);
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
        alert('Por favor, permite las ventanas emergentes (popups) para conectar Google Fit.');
        setIsConnectingFit(false);
      }
    } catch (error) {
      console.error('Error connecting to Google Fit:', error);
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
    if (!fitTokens) return;
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

      // Edge IoT Filter: Only upload anomalous events to Firebase to save bandwidth/storage
      if (eventData.status === 'warning' || eventData.status === 'critical') {
        try {
          await addDoc(collection(db, 'telemetry_events'), {
            ...eventData,
            timestamp: serverTimestamp(),
            projectId: selectedProject?.id || 'global'
          });
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'telemetry_events');
        }
      } else {
        console.log('[Edge IoT Filter] Normal event filtered out locally:', eventData);
        // Optionally update local state for the UI without hitting Firebase
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
    </div>
    </PremiumFeatureGuard>
  );
}
