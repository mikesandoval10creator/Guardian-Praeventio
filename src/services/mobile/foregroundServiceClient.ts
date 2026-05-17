/**
 * Praeventio Guard — Sprint mobile FGS: foreground-service client wrapper.
 *
 * Thin runtime adapter over `@capawesome-team/capacitor-android-foreground-service`
 * used by the lone-worker check-in flow. The wrapper is the ONLY place in the
 * web codebase that touches the native plugin directly — every other call site
 * (LoneWorker page, scheduled jobs, future SOS escalation) imports the
 * helpers from this module so the platform guard is enforced once.
 *
 * Responsibilities:
 *   1. Platform guard — silently no-ops on web/iOS. The plugin throws
 *      synchronously on iOS/web because `AndroidForegroundService` simply
 *      isn't registered there; calling code should NOT have to catch that.
 *   2. Notification channel bootstrap — Android 8+ requires a channel before
 *      any foreground notification can render. We create the `lone_worker`
 *      channel lazily on the first start call.
 *   3. Running-state mirror — the plugin doesn't expose an `isRunning()`
 *      query, so we keep a local boolean. This is good enough for the
 *      LoneWorker page (it just needs to know whether to render the
 *      stop / cancel button or the start button).
 *   4. Mockable plugin — `__setForegroundServicePlugin` exists for tests so
 *      the unit suite never imports the real native module.
 *
 * Configuration is read from `capacitor.config.ts -> plugins.ForegroundService`
 * but defensively defaulted in code so a misconfigured Capacitor build does
 * not silently lose the persistent notification.
 *
 * See:
 *   - android/app/src/main/AndroidManifest.xml (FGS permissions + service)
 *   - capacitor.config.ts (notification channel metadata)
 *   - src/services/foregroundService/guardianForegroundService.ts (pure
 *     state-machine layer; will eventually be wired on top of THIS client
 *     once the state-machine path is rolled out fleet-wide).
 */

import { Capacitor } from '@capacitor/core';

// ────────────────────────────────────────────────────────────────────────
// Plugin contract (subset — keeps the wrapper testable without the native
// module). Mirrors the public surface of
// `@capawesome-team/capacitor-android-foreground-service@8.1.0`.
// ────────────────────────────────────────────────────────────────────────

export type ForegroundServiceImportance = 'min' | 'low' | 'default' | 'high' | 'max';

export interface StartForegroundServiceArgs {
  id: number;
  title: string;
  body: string;
  smallIcon: string;
  silent?: boolean;
  notificationChannelId?: string;
  /**
   * Android Q+ foregroundServiceType. The plugin accepts the numeric flags
   * declared in `ServiceType` (Location=8, Microphone=128, …). We expose
   * the union for ergonomics; the wrapper maps to ints internally.
   */
  serviceType?: 'location' | 'health' | 'location_health';
}

export interface CreateNotificationChannelArgs {
  id: string;
  name: string;
  description?: string;
  importance?: ForegroundServiceImportance;
}

export interface ForegroundServicePluginLike {
  startForegroundService(args: StartForegroundServiceArgs): Promise<void>;
  updateForegroundService(args: StartForegroundServiceArgs): Promise<void>;
  stopForegroundService(): Promise<void>;
  createNotificationChannel(args: CreateNotificationChannelArgs): Promise<void>;
}

// ────────────────────────────────────────────────────────────────────────
// Channel + notification defaults (mirrors capacitor.config.ts).
// ────────────────────────────────────────────────────────────────────────

const LONE_WORKER_NOTIFICATION_ID = 4811; // arbitrary stable id
const LONE_WORKER_CHANNEL_ID = 'lone_worker';
const LONE_WORKER_CHANNEL_NAME = 'Guardian — Trabajador solitario';
const LONE_WORKER_CHANNEL_DESC =
  'Notificación persistente del check-in periódico durante trabajo aislado.';
const DEFAULT_ICON_SM = 'ic_guardian_shield';
const DEFAULT_TITLE = 'Guardian Activo — Protegiendo tu vida';

// ────────────────────────────────────────────────────────────────────────
// Internal state
// ────────────────────────────────────────────────────────────────────────

let cachedPlugin: ForegroundServicePluginLike | null = null;
let running = false;
let channelCreated = false;
let nativeChecker: () => boolean = isAndroidNative;

/**
 * Returns true ONLY when running on a native Android Capacitor build.
 * Web and iOS resolve to `false` so callers never need a platform-specific
 * try/catch around `startLoneWorkerFgs`.
 */
export function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    // `Capacitor` may not be initialised in jsdom/SSR — treat as web.
    return false;
  }
}

async function loadPlugin(): Promise<ForegroundServicePluginLike | null> {
  if (cachedPlugin) return cachedPlugin;
  if (!nativeChecker()) return null;
  try {
    // Lazy dynamic import — the native module is dead-code-eliminated from
    // the web bundle because this branch never executes there.
    const mod: unknown = await import(
      '@capawesome-team/capacitor-android-foreground-service'
    );
    const plugin = (mod as { ForegroundService?: ForegroundServicePluginLike })
      .ForegroundService;
    if (!plugin) return null;
    cachedPlugin = plugin;
    return plugin;
  } catch {
    // Plugin failed to register on this device — bail to no-op rather than
    // crash the host activity.
    return null;
  }
}

async function ensureChannel(plugin: ForegroundServicePluginLike): Promise<void> {
  if (channelCreated) return;
  try {
    await plugin.createNotificationChannel({
      id: LONE_WORKER_CHANNEL_ID,
      name: LONE_WORKER_CHANNEL_NAME,
      description: LONE_WORKER_CHANNEL_DESC,
      importance: 'low',
    });
    channelCreated = true;
  } catch {
    // Channels are idempotent on Android — duplicate-create is fine. Swallow.
    channelCreated = true;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Public API — used by LoneWorker.tsx and any future caller.
// ────────────────────────────────────────────────────────────────────────

export interface StartLoneWorkerFgsArgs {
  workerUid: string;
  /** Check-in cadence; rendered on the persistent notification body. */
  checkInIntervalSec: number;
  /** Optional override; defaults to `DEFAULT_TITLE`. */
  title?: string;
  /** Optional override; defaults to `DEFAULT_ICON_SM`. */
  smallIcon?: string;
}

export interface FgsResult {
  /** `true` when a native plugin call ran. `false` on web/iOS or failure. */
  applied: boolean;
  reason: 'started' | 'stopped' | 'updated' | 'not_native' | 'no_plugin' | 'error';
  /** Populated when `reason === 'error'`. */
  error?: string;
}

function buildBody(intervalSec: number): string {
  if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
    return 'Check-in automático activo.';
  }
  if (intervalSec < 60) return `Check-in cada ${Math.round(intervalSec)} s.`;
  const min = Math.round(intervalSec / 60);
  return `Check-in cada ${min} min.`;
}

/**
 * Boot the lone-worker foreground service. Idempotent: calling again while
 * the service is already running emits an `updateForegroundService` (so the
 * notification text can be refreshed when the check-in interval changes)
 * instead of restarting the service.
 */
export async function startLoneWorkerFgs(
  args: StartLoneWorkerFgsArgs,
): Promise<FgsResult> {
  if (!nativeChecker()) return { applied: false, reason: 'not_native' };
  const plugin = await loadPlugin();
  if (!plugin) return { applied: false, reason: 'no_plugin' };

  await ensureChannel(plugin);

  const startArgs: StartForegroundServiceArgs = {
    id: LONE_WORKER_NOTIFICATION_ID,
    title: args.title ?? DEFAULT_TITLE,
    body: buildBody(args.checkInIntervalSec),
    smallIcon: args.smallIcon ?? DEFAULT_ICON_SM,
    silent: false,
    notificationChannelId: LONE_WORKER_CHANNEL_ID,
    serviceType: 'location_health',
  };

  try {
    if (running) {
      await plugin.updateForegroundService(startArgs);
      return { applied: true, reason: 'updated' };
    }
    await plugin.startForegroundService(startArgs);
    running = true;
    return { applied: true, reason: 'started' };
  } catch (e) {
    return { applied: false, reason: 'error', error: (e as Error).message };
  }
}

/**
 * Stop the foreground service. Safe to call when no service is running —
 * the call is a no-op in that case.
 */
export async function stopLoneWorkerFgs(): Promise<FgsResult> {
  if (!nativeChecker()) return { applied: false, reason: 'not_native' };
  const plugin = await loadPlugin();
  if (!plugin) return { applied: false, reason: 'no_plugin' };
  if (!running) return { applied: false, reason: 'stopped' };
  try {
    await plugin.stopForegroundService();
    running = false;
    return { applied: true, reason: 'stopped' };
  } catch (e) {
    return { applied: false, reason: 'error', error: (e as Error).message };
  }
}

/** Mirror of the native state. Used by the React widget to render the right CTA. */
export function isRunning(): boolean {
  return running;
}

// ────────────────────────────────────────────────────────────────────────
// Test seams — exported under `__` prefix so consumers don't depend on them.
// ────────────────────────────────────────────────────────────────────────

/** Replace the platform checker so tests can simulate Android. */
export function __setNativeCheckerForTests(checker: () => boolean): void {
  nativeChecker = checker;
}

/** Inject a fake plugin (used by smoke tests). */
export function __setForegroundServicePlugin(
  plugin: ForegroundServicePluginLike | null,
): void {
  cachedPlugin = plugin;
}

/** Hard reset internal state — only for tests. */
export function __resetForegroundServiceClient(): void {
  cachedPlugin = null;
  running = false;
  channelCreated = false;
  nativeChecker = isAndroidNative;
}
