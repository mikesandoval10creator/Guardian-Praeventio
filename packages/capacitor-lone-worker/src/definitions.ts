export interface NativeLoneWorkerStartOptions {
  projectId: string;
  sessionId: string;
  /** Opaque short-lived capability minted for this open session. */
  capability: string;
  /** HTTPS origin used by the native outbox; Firebase credentials never enter Android. */
  apiBaseUrl: string;
  /** Server authority boundary; native sampling stops after this instant. */
  capabilityExpiresAt: string;
  /** Native pulse cadence. The server remains the source of truth. */
  heartbeatIntervalMs?: number;
}

export interface NativeLoneWorkerStatus {
  running: boolean;
  lastHeartbeatAt?: string;
  lastError?: string;
}

export interface NativeLoneWorkerPlugin {
  start(options: NativeLoneWorkerStartOptions): Promise<NativeLoneWorkerStatus>;
  stop(): Promise<void>;
  getStatus(): Promise<NativeLoneWorkerStatus>;
}
