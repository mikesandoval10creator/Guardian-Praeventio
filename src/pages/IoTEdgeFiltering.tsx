// Praeventio Guard — IoT Edge Filtering real (MQTT-over-WebSocket).
//
// Antes esta página corría `setInterval(500ms)` con `Math.random()`
// generando lecturas falsas. AHORA conecta a un broker MQTT REAL:
//
//   - Cliente MQTT.js (OSS BSD-2) sobre WebSocket
//   - Usuario configura broker URL (default: broker público HiveMQ)
//   - Usuario configura el topic a subscribirse (e.g. praeventio/sensors/+)
//   - Edge filter REAL: solo eventos anómalos llegan a la lista
//   - Métricas reales: received, filtered out, reconnects, last error
//
// Si el broker está caído, el cliente reconecta automáticamente y
// muestra el estado real ('reconnecting', 'error') — NO simulación.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Cpu,
  Activity,
  ShieldAlert,
  AlertTriangle,
  Wifi,
  WifiOff,
  Database,
  Server,
  Send,
  Filter,
} from 'lucide-react';
import { Card, Button } from '../components/shared/Card';
import { PremiumFeatureGuard } from '../components/shared/PremiumFeatureGuard';
import {
  PraeventioMqttClient,
  onlyAnomaliesFilter,
  type ConnectionState,
  type MqttClientMetrics,
  type MqttSensorEvent,
  type EdgeFilterPredicate,
} from '../services/iot/mqttClient';

const DEFAULT_BROKER = 'wss://broker.hivemq.com:8884/mqtt';
const DEFAULT_TOPIC = 'praeventio/demo/#';

const STATE_META: Record<
  ConnectionState,
  { label: string; cls: string; Icon: typeof Wifi }
> = {
  disconnected: {
    label: 'Desconectado',
    cls: 'text-zinc-500 bg-zinc-500/10 border-zinc-500/30',
    Icon: WifiOff,
  },
  connecting: {
    label: 'Conectando',
    cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    Icon: Wifi,
  },
  connected: {
    label: 'Conectado',
    cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    Icon: Wifi,
  },
  reconnecting: {
    label: 'Reconectando',
    cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    Icon: Wifi,
  },
  error: {
    label: 'Error',
    cls: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
    Icon: AlertTriangle,
  },
};

export function IoTEdgeFiltering() {
  const { t } = useTranslation();
  const clientRef = useRef<PraeventioMqttClient | null>(null);
  const [brokerUrl, setBrokerUrl] = useState(DEFAULT_BROKER);
  const [topic, setTopic] = useState(DEFAULT_TOPIC);
  const [filterAnomaliesOnly, setFilterAnomaliesOnly] = useState(true);
  const [state, setState] = useState<ConnectionState>('disconnected');
  const [metrics, setMetrics] = useState<MqttClientMetrics | null>(null);
  const [recentEvents, setRecentEvents] = useState<MqttSensorEvent[]>([]);
  const [publishTopic, setPublishTopic] = useState('praeventio/demo/test');
  const [publishPayload, setPublishPayload] = useState(
    '{"status":"warning","sensor":"CO2","value":1200}',
  );
  const [error, setError] = useState<string | null>(null);

  // Edge filter — el caller elige entre "todo" o "solo anomalías".
  const edgeFilter: EdgeFilterPredicate | undefined = useMemo(() => {
    return filterAnomaliesOnly ? onlyAnomaliesFilter : undefined;
  }, [filterAnomaliesOnly]);

  const connect = useCallback(async () => {
    setError(null);
    if (clientRef.current) {
      await clientRef.current.disconnect();
      clientRef.current = null;
    }
    const c = new PraeventioMqttClient({
      brokerUrl,
      edgeFilter,
    });
    clientRef.current = c;
    c.onState((s) => setState(s));
    c.onMessage((evt) => {
      setRecentEvents((prev) => [evt, ...prev].slice(0, 30));
    });
    try {
      await c.connect();
      await c.subscribe(topic, 0);
      setMetrics(c.getMetrics());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [brokerUrl, topic, edgeFilter]);

  const disconnect = useCallback(async () => {
    if (clientRef.current) {
      await clientRef.current.disconnect();
      clientRef.current = null;
    }
    setRecentEvents([]);
    setMetrics(null);
  }, []);

  const handlePublish = useCallback(async () => {
    if (!clientRef.current) {
      setError('Conecta primero antes de publicar.');
      return;
    }
    try {
      await clientRef.current.publish(publishTopic, publishPayload, 0);
      setMetrics(clientRef.current.getMetrics());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [publishTopic, publishPayload]);

  // Poll metrics cada 1s mientras conectado (las metricas mutate
  // internamente y queremos reflejarlas en UI).
  useEffect(() => {
    if (state !== 'connected' && state !== 'reconnecting') return;
    const handle = setInterval(() => {
      if (clientRef.current) {
        setMetrics(clientRef.current.getMetrics());
      }
    }, 1000);
    return () => clearInterval(handle);
  }, [state]);

  // Cleanup al unmount.
  useEffect(() => {
    return () => {
      if (clientRef.current) {
        void clientRef.current.disconnect();
        clientRef.current = null;
      }
    };
  }, []);

  const stateMeta = STATE_META[state];

  return (
    <PremiumFeatureGuard
      feature="canUseAPIAccess"
      featureName={t('iotEdge.featureName', 'IoT Edge Filtering') as string}
      description={
        t(
          'iotEdge.featureDesc',
          'Integración MQTT con sensores industriales. Disponible desde el plan Empresarial.',
        ) as string
      }
    >
      <div
        data-testid="iot-edge-page"
        data-state={state}
        className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6 sm:space-y-8"
      >
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
          <div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-black text-white uppercase tracking-tighter leading-tight flex items-center gap-3">
              <Cpu className="w-8 h-8 text-indigo-500" aria-hidden="true" />
              {t('iotEdge.title', 'IoT Edge Filtering')}
            </h1>
            <p className="text-[9px] sm:text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] sm:tracking-[0.3em] mt-2">
              {t('iotEdge.subtitle', 'MQTT real · WebSocket · Edge filter')}
            </p>
          </div>
          <div
            className={`px-4 py-2 rounded-xl border flex items-center gap-2 ${stateMeta.cls}`}
            data-testid="iot-edge-state-badge"
          >
            <stateMeta.Icon
              className={`w-5 h-5 ${state === 'connecting' || state === 'reconnecting' ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
            <span className="font-bold uppercase tracking-wider text-sm">
              {stateMeta.label}
            </span>
          </div>
        </header>

        {error && (
          <div
            data-testid="iot-edge-error"
            role="alert"
            className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 flex items-start gap-2"
          >
            <AlertTriangle
              className="w-4 h-4 text-rose-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-rose-300 font-mono break-all">{error}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Connection config */}
          <Card className="p-6 border-white/5 space-y-4 lg:col-span-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Server className="w-5 h-5 text-indigo-500" aria-hidden="true" />
              {t('iotEdge.brokerSection', 'Broker MQTT')}
            </h2>

            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                {t('iotEdge.brokerUrl', 'Broker URL (ws:// o wss://)')}
              </label>
              <input
                type="text"
                value={brokerUrl}
                onChange={(e) => setBrokerUrl(e.target.value)}
                disabled={state === 'connected' || state === 'connecting'}
                data-testid="iot-edge-broker-input"
                className="w-full px-3 py-2 rounded-md border border-white/10 bg-zinc-900 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
              />
              <p className="text-[10px] text-zinc-500 mt-1 italic">
                {t('iotEdge.brokerHint', 'Default: broker público HiveMQ (sin auth, demo).')}
              </p>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                {t('iotEdge.topic', 'Topic (acepta wildcards + y #)')}
              </label>
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={state === 'connected' || state === 'connecting'}
                data-testid="iot-edge-topic-input"
                className="w-full px-3 py-2 rounded-md border border-white/10 bg-zinc-900 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
              />
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filterAnomaliesOnly}
                onChange={(e) => setFilterAnomaliesOnly(e.target.checked)}
                disabled={state === 'connected' || state === 'connecting'}
                data-testid="iot-edge-filter-checkbox"
                className="w-4 h-4 rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500/40"
              />
              <span className="text-xs text-zinc-300 flex items-center gap-1">
                <Filter className="w-3 h-3" aria-hidden="true" />
                {t('iotEdge.filterAnomalies', 'Edge filter: solo eventos status ≠ "ok"')}
              </span>
            </label>

            {state === 'disconnected' || state === 'error' ? (
              <Button
                onClick={() => void connect()}
                className="w-full"
                data-testid="iot-edge-connect"
              >
                <Wifi className="w-4 h-4 mr-2" aria-hidden="true" />
                {t('iotEdge.connect', 'Conectar')}
              </Button>
            ) : (
              <Button
                variant="danger"
                onClick={() => void disconnect()}
                className="w-full"
                data-testid="iot-edge-disconnect"
              >
                <WifiOff className="w-4 h-4 mr-2" aria-hidden="true" />
                {t('iotEdge.disconnect', 'Desconectar')}
              </Button>
            )}
          </Card>

          {/* Metrics panel */}
          <Card className="p-6 border-white/5 space-y-4 lg:col-span-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Activity
                className="w-5 h-5 text-indigo-500"
                aria-hidden="true"
              />
              {t('iotEdge.metricsSection', 'Métricas en vivo')}
            </h2>

            <MetricRow
              testId="iot-edge-metric-received"
              label={t('iotEdge.metricReceived', 'Mensajes recibidos') as string}
              value={metrics?.messagesReceived ?? 0}
              colorClass="text-emerald-400"
            />
            <MetricRow
              testId="iot-edge-metric-filtered"
              label={t('iotEdge.metricFiltered', 'Filtrados (edge)') as string}
              value={metrics?.messagesFilteredOut ?? 0}
              colorClass="text-amber-400"
            />
            <MetricRow
              testId="iot-edge-metric-published"
              label={t('iotEdge.metricPublished', 'Publicados') as string}
              value={metrics?.messagesPublished ?? 0}
              colorClass="text-blue-400"
            />
            <MetricRow
              testId="iot-edge-metric-reconnects"
              label={t('iotEdge.metricReconnects', 'Reconexiones') as string}
              value={metrics?.reconnectCount ?? 0}
              colorClass={metrics && metrics.reconnectCount > 0 ? 'text-amber-400' : 'text-zinc-400'}
            />

            <div className="pt-2 border-t border-white/5">
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
                {t('iotEdge.subscribedTopics', 'Topics suscritos')}
              </p>
              {metrics?.subscribedTopics && metrics.subscribedTopics.length > 0 ? (
                <ul data-testid="iot-edge-topics" className="space-y-0.5">
                  {metrics.subscribedTopics.map((tp) => (
                    <li
                      key={tp}
                      className="text-[11px] font-mono text-zinc-300 truncate"
                    >
                      {tp}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs italic text-zinc-500">
                  {t('iotEdge.noTopics', 'Sin topics aún.')}
                </p>
              )}
            </div>

            {metrics?.lastErrorMessage && (
              <div className="p-2 rounded-md bg-rose-500/5 border border-rose-500/20">
                <p className="text-[10px] text-rose-400 font-mono break-all">
                  {metrics.lastErrorMessage}
                </p>
              </div>
            )}
          </Card>

          {/* Publish + Recent events */}
          <Card className="p-6 border-white/5 space-y-4 lg:col-span-1">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Send className="w-5 h-5 text-indigo-500" aria-hidden="true" />
              {t('iotEdge.publishSection', 'Publicar (test)')}
            </h2>

            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                Topic
              </label>
              <input
                type="text"
                value={publishTopic}
                onChange={(e) => setPublishTopic(e.target.value)}
                data-testid="iot-edge-publish-topic"
                className="w-full px-3 py-2 rounded-md border border-white/10 bg-zinc-900 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                Payload (JSON)
              </label>
              <textarea
                value={publishPayload}
                onChange={(e) => setPublishPayload(e.target.value)}
                data-testid="iot-edge-publish-payload"
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-white/10 bg-zinc-900 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/40 resize-none"
              />
            </div>

            <Button
              onClick={() => void handlePublish()}
              disabled={state !== 'connected'}
              className="w-full"
              data-testid="iot-edge-publish-btn"
            >
              <Send className="w-4 h-4 mr-2" aria-hidden="true" />
              {t('iotEdge.publish', 'Publicar')}
            </Button>
          </Card>
        </div>

        {/* Recent events feed */}
        <Card className="p-6 border-white/5 space-y-3">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-500" aria-hidden="true" />
            {t('iotEdge.recentEvents', 'Eventos recientes')} ({recentEvents.length})
          </h2>

          {recentEvents.length === 0 ? (
            <p
              className="text-xs italic text-zinc-500 text-center py-8"
              data-testid="iot-edge-no-events"
            >
              {state === 'connected'
                ? t(
                    'iotEdge.noEventsConnected',
                    'Conectado — esperando mensajes en el topic. Publica algo desde el panel de la derecha para probar.',
                  )
                : t('iotEdge.noEventsDisconnected', 'Conecta para empezar a recibir mensajes.')}
            </p>
          ) : (
            <ul
              data-testid="iot-edge-events-list"
              className="space-y-2 max-h-96 overflow-y-auto"
            >
              {recentEvents.map((evt, i) => (
                <li
                  key={`${evt.receivedAtMs}-${i}`}
                  data-testid={`iot-edge-event-${i}`}
                  className="p-2.5 rounded-md bg-zinc-900 border border-white/5 text-xs"
                >
                  <div className="flex items-center justify-between mb-1">
                    <code className="text-indigo-400 font-mono truncate flex-1">
                      {evt.topic}
                    </code>
                    <span className="text-[10px] text-zinc-500 font-mono ml-2">
                      {new Date(evt.receivedAtMs).toLocaleTimeString()}
                    </span>
                  </div>
                  <pre className="text-zinc-300 font-mono whitespace-pre-wrap break-all text-[11px]">
                    {evt.payloadJson
                      ? JSON.stringify(evt.payloadJson, null, 2)
                      : evt.payloadText.slice(0, 200)}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p className="text-[10px] text-zinc-500 italic text-center">
          {t(
            'iotEdge.standardNote',
            'MQTT.js (OSS BSD-2) sobre WebSocket. Compatible con HiveMQ, Mosquitto, AWS IoT Core, Azure IoT Hub, Google Cloud IoT MQTT bridge.',
          )}
        </p>
      </div>
    </PremiumFeatureGuard>
  );
}

interface MetricRowProps {
  testId: string;
  label: string;
  value: number;
  colorClass: string;
}

function MetricRow({ testId, label, value, colorClass }: MetricRowProps) {
  return (
    <div className="p-3 rounded-xl bg-zinc-900 border border-white/5 flex items-center justify-between">
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
        {label}
      </p>
      <p
        data-testid={testId}
        className={`text-xl font-black font-mono ${colorClass}`}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

export default IoTEdgeFiltering;
