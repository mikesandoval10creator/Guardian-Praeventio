// Praeventio Guard — Sprint 47 C.2: Foreground Service Android.
//
// Cierra C.2 del plan maestro (parte Android). Capa de abstracción
// sobre `@capawesome-team/capacitor-android-foreground-service` que
// expone una API determinística y testeable.
//
// Política Guardian Praeventio:
//   - El servicio se mantiene ACTIVO mientras el trabajador está en
//     un turno o en una zona de riesgo crítico.
//   - La notificación persistente DICE "Guardian Activo: Protegiendo
//     tu Vida" y NO es opcional (el OS Android la requiere).
//   - Si el WebView muere, el servicio sigue corriendo y reporta
//     heartbeats al servidor cada 30s (servidor detecta y envía APNs
//     silent push para revivir).
//
// El motor es puro: el caller le pasa el plugin (DI). Para tests no
// se requiere Android — los mocks reemplazan el plugin.

// ────────────────────────────────────────────────────────────────────────
// Plugin contract (subset del SDK real)
// ────────────────────────────────────────────────────────────────────────

export interface ForegroundServiceNotification {
  id: number;
  title: string;
  body: string;
  smallIcon: string;
  /** Permitir tap a abrir la app. */
  silent?: boolean;
}

export interface StartServiceOptions {
  notification: ForegroundServiceNotification;
  /** Tipo de servicio (Android Q+): "location" requiere permiso ubicación
   *  background. "shortService" para ≤3h de uso. */
  serviceType?: 'location' | 'shortService' | 'health' | 'specialUse';
}

export interface ForegroundServicePluginContract {
  startForegroundService(options: StartServiceOptions): Promise<void>;
  stopForegroundService(): Promise<void>;
  updateForegroundService(options: { notification: ForegroundServiceNotification }): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────
// Guardian-specific state machine
// ────────────────────────────────────────────────────────────────────────

export type GuardianShiftState = 'off_shift' | 'on_shift' | 'critical_zone';

export interface GuardianForegroundContext {
  workerUid: string;
  projectId: string;
  /** Si lone-worker está activo (no hay nadie más cerca). */
  loneWorker?: boolean;
  /** Zona donde está parado. */
  currentZoneKind?: 'office' | 'site' | 'critical' | 'rescue';
}

export interface GuardianNotificationBuild {
  title: string;
  body: string;
  silent: boolean;
  /** Tipo de servicio para la API Android. */
  serviceType: StartServiceOptions['serviceType'];
}

// ────────────────────────────────────────────────────────────────────────
// State → notification mapper
// ────────────────────────────────────────────────────────────────────────

export function buildNotificationForState(
  state: GuardianShiftState,
  ctx: GuardianForegroundContext,
): GuardianNotificationBuild {
  switch (state) {
    case 'on_shift': {
      const body = ctx.loneWorker
        ? 'Trabajo aislado — check-in automático activo.'
        : `Proyecto ${ctx.projectId} · seguimiento activo.`;
      return {
        title: '🛡️ Guardian Activo',
        body,
        silent: false,
        serviceType: 'location',
      };
    }
    case 'critical_zone': {
      return {
        title: '⚠️ Zona Crítica — Guardian Vigilante',
        body: `Zona ${ctx.currentZoneKind ?? 'crítica'} · detección continua activa.`,
        silent: false,
        serviceType: 'location',
      };
    }
    case 'off_shift':
    default:
      return {
        title: '✓ Guardian — Turno cerrado',
        body: 'Sin seguimiento activo. Inicia turno para activar protección.',
        silent: true,
        serviceType: 'shortService',
      };
  }
}

// ────────────────────────────────────────────────────────────────────────
// Lifecycle controller
// ────────────────────────────────────────────────────────────────────────

const GUARDIAN_NOTIFICATION_ID = 1001;
const SMALL_ICON = 'ic_guardian_shield'; // res/drawable provided by the app

export interface ServiceTransitionResult {
  applied: boolean;
  state: GuardianShiftState;
  reason: string;
}

export class GuardianForegroundController {
  private currentState: GuardianShiftState = 'off_shift';
  private running = false;

  constructor(private readonly plugin: ForegroundServicePluginContract) {}

  async transitionTo(
    newState: GuardianShiftState,
    ctx: GuardianForegroundContext,
  ): Promise<ServiceTransitionResult> {
    if (newState === this.currentState && this.running) {
      return { applied: false, state: newState, reason: 'no_change' };
    }

    const build = buildNotificationForState(newState, ctx);
    const notification: ForegroundServiceNotification = {
      id: GUARDIAN_NOTIFICATION_ID,
      title: build.title,
      body: build.body,
      smallIcon: SMALL_ICON,
      silent: build.silent,
    };

    try {
      if (newState === 'off_shift') {
        if (this.running) {
          await this.plugin.stopForegroundService();
        }
        this.running = false;
      } else if (!this.running) {
        await this.plugin.startForegroundService({
          notification,
          serviceType: build.serviceType,
        });
        this.running = true;
      } else {
        await this.plugin.updateForegroundService({ notification });
      }
      this.currentState = newState;
      return { applied: true, state: newState, reason: 'transition_ok' };
    } catch (e) {
      return { applied: false, state: this.currentState, reason: `error: ${(e as Error).message}` };
    }
  }

  get state(): GuardianShiftState {
    return this.currentState;
  }

  get isRunning(): boolean {
    return this.running;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Heartbeat scheduler (caller lo invoca en interval setInterval cada 30s)
// ────────────────────────────────────────────────────────────────────────

export interface HeartbeatPayload {
  workerUid: string;
  projectId: string;
  state: GuardianShiftState;
  /** ISO-8601. */
  at: string;
  /** Sequence number — incrementa cada heartbeat. */
  seq: number;
}

export class HeartbeatTracker {
  private seq = 0;
  private lastAtMs: number | null = null;

  build(workerUid: string, projectId: string, state: GuardianShiftState, now: Date): HeartbeatPayload {
    this.seq += 1;
    this.lastAtMs = now.getTime();
    return {
      workerUid,
      projectId,
      state,
      at: now.toISOString(),
      seq: this.seq,
    };
  }

  get sequence(): number {
    return this.seq;
  }

  /**
   * Servidor decide si el cliente está caído si el último heartbeat es
   * más viejo que `staleMs` (default 90s = 3 missed heartbeats).
   */
  isStale(now: Date, staleMs = 90_000): boolean {
    if (this.lastAtMs === null) return true;
    return now.getTime() - this.lastAtMs > staleMs;
  }
}
