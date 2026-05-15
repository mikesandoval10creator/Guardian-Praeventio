// Praeventio Guard — MQTT-over-WebSocket client real (no simulación).
//
// Wrapper sobre `mqtt@^5.15.1` (MQTT.js, OSS BSD-2) que abre conexión
// real a un broker MQTT vía WebSocket (ws:// o wss://) y expone:
//
//   - connect / disconnect lifecycle
//   - subscribe a topics con QoS
//   - mensajes entrantes como AsyncIterable + callback
//   - publish con QoS
//   - métricas de conexión observables (sent/received/reconnects/lastRtt)
//
// Diseño:
//   - Pure adapter: el caller pasa la config, no asume Firebase/Firestore.
//   - Idempotent: connect() múltiples veces reutiliza la conexión.
//   - Edge filter ya cableado: el caller puede pasar un predicate que
//     filtra mensajes antes de propagarlos (e.g. solo eventos anómalos
//     llegan a Firestore — el resto se descarta en el cliente).

import mqtt, { type MqttClient, type IClientOptions } from 'mqtt';

export interface MqttSensorEvent {
  /** Topic donde llegó. */
  topic: string;
  /** Payload — el caller decodea según su contrato. */
  payload: Uint8Array;
  /** Payload como string UTF-8 si es texto plano. */
  payloadText: string;
  /** Tentativa de parsear como JSON. null si falla. */
  payloadJson: Record<string, unknown> | null;
  /** Timestamp ms del receive. */
  receivedAtMs: number;
  /** QoS del mensaje. */
  qos: 0 | 1 | 2;
}

export type EdgeFilterPredicate = (event: MqttSensorEvent) => boolean;

export interface MqttClientConfig {
  /** Broker URL — ws:// o wss://. Default público gratis para tests:
   *  'wss://broker.hivemq.com:8884/mqtt' */
  brokerUrl: string;
  /** Client ID único. Si no se pasa, se genera uno random. */
  clientId?: string;
  /** Usuario/contraseña si el broker requiere auth. */
  username?: string;
  password?: string;
  /** Reconnect period ms. Default 5000. */
  reconnectPeriodMs?: number;
  /** Connect timeout ms. Default 30000. */
  connectTimeoutMs?: number;
  /**
   * Edge filter — si está set, solo los eventos que `return true`
   * llegan a los listeners. Default: pasa todo.
   *
   * Esto es el "edge filter" del título de la página: filtrar en el
   * cliente para no saturar el backend con telemetría redundante.
   */
  edgeFilter?: EdgeFilterPredicate;
}

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export interface MqttClientMetrics {
  state: ConnectionState;
  messagesReceived: number;
  messagesPublished: number;
  messagesFilteredOut: number;
  reconnectCount: number;
  lastMessageAtIso: string | null;
  lastErrorMessage: string | null;
  subscribedTopics: string[];
  connectedSince: string | null;
}

export type MqttMessageHandler = (event: MqttSensorEvent) => void;
export type MqttStateHandler = (state: ConnectionState) => void;

/**
 * Cliente MQTT real con state machine + métricas observables.
 * Diseñado para usarse desde hooks React (subscribe → render → unsubscribe).
 */
export class PraeventioMqttClient {
  private client: MqttClient | null = null;
  private state: ConnectionState = 'disconnected';
  private messagesReceived = 0;
  private messagesPublished = 0;
  private messagesFilteredOut = 0;
  private reconnectCount = 0;
  private lastMessageAtIso: string | null = null;
  private lastErrorMessage: string | null = null;
  private readonly subscribedTopics = new Set<string>();
  private connectedSinceIso: string | null = null;
  private readonly messageListeners = new Set<MqttMessageHandler>();
  private readonly stateListeners = new Set<MqttStateHandler>();

  constructor(private readonly config: MqttClientConfig) {}

  /** Abre la conexión. Idempotent si ya está conectado. */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') return;
    this.setState('connecting');
    const opts: IClientOptions = {
      clientId:
        this.config.clientId ??
        `praeventio-${Math.random().toString(36).slice(2, 10)}`,
      reconnectPeriod: this.config.reconnectPeriodMs ?? 5000,
      connectTimeout: this.config.connectTimeoutMs ?? 30000,
      username: this.config.username,
      password: this.config.password,
      clean: true,
    };
    return new Promise((resolve, reject) => {
      let resolved = false;
      try {
        this.client = mqtt.connect(this.config.brokerUrl, opts);
      } catch (err) {
        this.lastErrorMessage = err instanceof Error ? err.message : String(err);
        this.setState('error');
        reject(err);
        return;
      }

      this.client.on('connect', () => {
        this.connectedSinceIso = new Date().toISOString();
        this.setState('connected');
        if (!resolved) {
          resolved = true;
          resolve();
        }
        // Re-suscribirse a los topics que tenía antes de un reconnect
        for (const topic of this.subscribedTopics) {
          this.client?.subscribe(topic);
        }
      });

      this.client.on('reconnect', () => {
        this.reconnectCount += 1;
        this.setState('reconnecting');
      });

      this.client.on('disconnect', () => {
        this.setState('disconnected');
        this.connectedSinceIso = null;
      });

      this.client.on('close', () => {
        if (this.state !== 'error') {
          this.setState('disconnected');
        }
        this.connectedSinceIso = null;
      });

      this.client.on('error', (err) => {
        this.lastErrorMessage =
          err instanceof Error ? err.message : String(err);
        this.setState('error');
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      this.client.on('message', (topic, payload, packet) => {
        const text = (() => {
          try {
            return new TextDecoder('utf-8', { fatal: false }).decode(payload);
          } catch {
            return '';
          }
        })();
        let json: Record<string, unknown> | null = null;
        if (text.length > 0 && (text.startsWith('{') || text.startsWith('['))) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        const event: MqttSensorEvent = {
          topic,
          payload: new Uint8Array(payload),
          payloadText: text,
          payloadJson: json,
          receivedAtMs: Date.now(),
          qos: (packet.qos as 0 | 1 | 2) ?? 0,
        };
        if (this.config.edgeFilter && !this.config.edgeFilter(event)) {
          this.messagesFilteredOut += 1;
          return;
        }
        this.messagesReceived += 1;
        this.lastMessageAtIso = new Date().toISOString();
        for (const fn of this.messageListeners) {
          try {
            fn(event);
          } catch (err) {
            // Listeners NO deben tumbar el client. Log silencioso.
            // eslint-disable-next-line no-console
            console.warn('[PraeventioMqttClient] listener threw:', err);
          }
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    return new Promise((resolve) => {
      this.client!.end(false, {}, () => {
        this.client = null;
        this.setState('disconnected');
        this.connectedSinceIso = null;
        resolve();
      });
    });
  }

  async subscribe(topic: string, qos: 0 | 1 | 2 = 0): Promise<void> {
    if (!this.client) {
      throw new Error('subscribe: client no conectado, llama connect() primero');
    }
    return new Promise((resolve, reject) => {
      this.client!.subscribe(topic, { qos }, (err) => {
        if (err) {
          this.lastErrorMessage = err.message;
          reject(err);
        } else {
          this.subscribedTopics.add(topic);
          resolve();
        }
      });
    });
  }

  async unsubscribe(topic: string): Promise<void> {
    if (!this.client) return;
    return new Promise((resolve, reject) => {
      this.client!.unsubscribe(topic, {}, (err) => {
        if (err) reject(err);
        else {
          this.subscribedTopics.delete(topic);
          resolve();
        }
      });
    });
  }

  async publish(
    topic: string,
    payload: string | Uint8Array,
    qos: 0 | 1 | 2 = 0,
  ): Promise<void> {
    if (!this.client) {
      throw new Error('publish: client no conectado');
    }
    return new Promise((resolve, reject) => {
      this.client!.publish(topic, payload as Buffer, { qos }, (err) => {
        if (err) {
          this.lastErrorMessage = err.message;
          reject(err);
        } else {
          this.messagesPublished += 1;
          resolve();
        }
      });
    });
  }

  onMessage(handler: MqttMessageHandler): () => void {
    this.messageListeners.add(handler);
    return () => this.messageListeners.delete(handler);
  }

  onState(handler: MqttStateHandler): () => void {
    this.stateListeners.add(handler);
    // Disparar inmediatamente con el estado actual.
    try {
      handler(this.state);
    } catch {
      /* ignore */
    }
    return () => this.stateListeners.delete(handler);
  }

  getMetrics(): MqttClientMetrics {
    return {
      state: this.state,
      messagesReceived: this.messagesReceived,
      messagesPublished: this.messagesPublished,
      messagesFilteredOut: this.messagesFilteredOut,
      reconnectCount: this.reconnectCount,
      lastMessageAtIso: this.lastMessageAtIso,
      lastErrorMessage: this.lastErrorMessage,
      subscribedTopics: [...this.subscribedTopics],
      connectedSince: this.connectedSinceIso,
    };
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    for (const fn of this.stateListeners) {
      try {
        fn(next);
      } catch {
        /* ignore */
      }
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Edge filter presets — patrones comunes
// ────────────────────────────────────────────────────────────────────────

/**
 * Filter: solo deja pasar payloads JSON con un campo `status` que NO
 * sea 'ok'. Útil para subscribir a sensores que reportan continuamente
 * pero solo nos interesa cuando hay anomalía.
 */
export const onlyAnomaliesFilter: EdgeFilterPredicate = (event) => {
  if (!event.payloadJson) return true; // no-JSON: dejamos pasar
  const status = event.payloadJson.status;
  if (typeof status !== 'string') return true;
  return status.toLowerCase() !== 'ok';
};

/**
 * Filter: deja pasar 1 de cada N mensajes. Útil para sensores
 * high-frequency donde necesitamos solo muestreo.
 */
export function sampleRateFilter(rate: number): EdgeFilterPredicate {
  let counter = 0;
  return () => {
    counter += 1;
    return counter % Math.max(1, Math.floor(rate)) === 0;
  };
}

/**
 * Filter: rechaza mensajes con valor numérico bajo un umbral.
 */
export function thresholdFilter(
  fieldName: string,
  threshold: number,
  comparator: 'gte' | 'lte' | 'gt' | 'lt' = 'gte',
): EdgeFilterPredicate {
  return (event) => {
    if (!event.payloadJson) return false;
    const raw = event.payloadJson[fieldName];
    if (typeof raw !== 'number') return false;
    switch (comparator) {
      case 'gte':
        return raw >= threshold;
      case 'gt':
        return raw > threshold;
      case 'lte':
        return raw <= threshold;
      case 'lt':
        return raw < threshold;
    }
  };
}
