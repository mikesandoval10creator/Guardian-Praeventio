import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { apiAuthHeader } from '../lib/apiAuth';
import { getE2EUser, isE2EMode } from '../lib/e2eAuth';
import { auth } from '../services/firebase';
import { canRequestLocationPermission, LOCATION_PERMISSION_GATE_SETTLED_EVENT } from '../services/location/locationPermissionRequest';
import { getActiveSession, isCommuteType, SAMPLE_INTERVAL_MS, setActiveCommuteSession, type CommuteSample } from '../services/driving/commuteSession';
import { clearCommuteClosePending, isCommuteClosePending, markCommuteClosePending, countCommuteSamples, flushCommuteSamples, persistCommuteSample, prepareCommuteSample, type PendingCommuteSample } from '../services/driving/commuteSamples';

type RecorderError = 'recovery' | 'update' | 'location' | 'sample' | 'storage';
interface Session { sessionId: string; projectId: string; type: string }
interface Snapshot { key: string; session: Session | null; ready: boolean; busy: boolean; paused: boolean; error: RecorderError | null }
interface Context {
  key: string; uid: string; projectId: string; disposed: boolean; ready: boolean; busy: boolean; paused: boolean;
  session: Session | null; unsaved: PendingCommuteSample | null; sampleTask: Promise<void> | null;
  controller: AbortController;
}

function authUid(): string | null {
  // Match apiAuthHeader's precedence: the E2E fixture wins when enabled.
  return (isE2EMode() ? getE2EUser()?.uid : null) ?? auth.currentUser?.uid ?? null;
}

/** Await without leaving an unresolved timeout race after success or abort. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Commute request aborted')); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener('abort', abort); resolve(value);
    }, (error: unknown) => {
      signal.removeEventListener('abort', abort); reject(error);
    });
    if (signal.aborted) abort();
  });
}

function readPosition(signal: AbortSignal): Promise<CommuteSample> {
  if (!canRequestLocationPermission(Capacitor.isNativePlatform()) || !navigator.geolocation) {
    return Promise.reject(new Error('Location permission unavailable'));
  }
  return new Promise((resolve, reject) => {
    const fail = () => { signal.removeEventListener('abort', fail); reject(new Error('Location unavailable')); };
    if (signal.aborted) { fail(); return; }
    signal.addEventListener('abort', fail, { once: true });
    navigator.geolocation.getCurrentPosition((position) => {
      signal.removeEventListener('abort', fail);
      const sample = {
        lat: position.coords.latitude, lng: position.coords.longitude,
        speedKmh: Math.max(0, position.coords.speed ?? 0) * 3.6,
        accuracyM: position.coords.accuracy, timestamp: position.timestamp,
      };
      if (!Object.values(sample).every(Number.isFinite) || Math.abs(sample.lat) > 90
        || Math.abs(sample.lng) > 180 || sample.speedKmh > 500
        || sample.accuracyM < 0 || sample.accuracyM > 100_000 || sample.timestamp <= 0) {
        reject(new Error('Invalid location fix')); return;
      }
      resolve(sample);
    }, fail, { enableHighAccuracy: true, maximumAge: 5_000, timeout: 15_000 });
  });
}

/** One foreground sampler. The API owns session IDs; encrypted pending samples
 * survive remount/reload and are never acknowledged under another identity. */
export function useCommuteRecorder(uid: string | null, projectId: string | null) {
  const key = JSON.stringify([uid, projectId]);
  const identityRef = useRef(key);
  identityRef.current = key;
  const contextRef = useRef<Context | null>(null);
  const [state, setState] = useState<Snapshot>({ key, session: null, ready: false, busy: false, paused: false, error: null });
  const current = useCallback((ctx: Context) => !ctx.disposed && identityRef.current === ctx.key && authUid() === ctx.uid, []);
  const patch = useCallback((ctx: Context, value: Partial<Snapshot>) => {
    if (current(ctx)) setState((before) => ({ ...before, ...value, key: ctx.key }));
  }, [current]);
  const hint = useCallback((ctx: Context, session: Session | null) => {
    if (!current(ctx)) return;
    setActiveCommuteSession(session ? { projectId: ctx.projectId, sessionId: session.sessionId, ownerUid: ctx.uid } : null);
  }, [current]);

  const request = useCallback(async (ctx: Context, path: string, body?: Record<string, unknown>) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    ctx.controller.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, 15_000);
    try {
      if (!current(ctx)) throw new Error('Stale commute identity');
      const header = await abortable(apiAuthHeader(), controller.signal);
      if (!header || !current(ctx)) throw new Error('Commute authentication changed');
      const response = await abortable(fetch(`/api/commute/${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: header, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
      }), controller.signal);
      if (!response.ok) throw new Error('Commute request failed');
      const value: unknown = await abortable(response.json(), controller.signal);
      if (!current(ctx) || !value || typeof value !== 'object'
        || (value as { success?: unknown }).success !== true) throw new Error('Invalid commute response');
      return value as { session?: unknown; sessionId?: unknown };
    } finally {
      clearTimeout(timer);
      ctx.controller.signal.removeEventListener('abort', cancel);
    }
  }, [current]);

  const drain = useCallback(async (ctx: Context) => {
    const session = ctx.session;
    if (!session || !current(ctx)) return;
    await flushCommuteSamples({ uid: ctx.uid, projectId: ctx.projectId, sessionId: session.sessionId },
      async (sample) => { await request(ctx, 'sample', { sessionId: session.sessionId, ...sample }); },
      () => current(ctx));
  }, [current, request]);

  const savePending = useCallback(async (ctx: Context) => {
    if (!ctx.unsaved) return;
    await persistCommuteSample(ctx.unsaved);
    ctx.unsaved = null;
  }, []);

  const finish = useCallback(async (ctx: Context) => {
    if (!current(ctx) || !ctx.ready || ctx.busy || !ctx.session) return;
    const scope = { uid: ctx.uid, projectId: ctx.projectId, sessionId: ctx.session.sessionId };
    // Stop acquisition at the driver's intent, even when delivery is offline.
    // Persist that intent so remount/reload never silently resumes collection.
    ctx.busy = true; ctx.paused = true;
    hint(ctx, null); patch(ctx, { busy: true, paused: true, error: null });
    let stage: RecorderError = 'storage';
    try {
      await markCommuteClosePending(scope);
      await ctx.sampleTask;
      if (!current(ctx)) return;
      await savePending(ctx);
      stage = 'sample'; await drain(ctx);
      if (!current(ctx)) return;
      stage = 'update'; await request(ctx, 'end', { sessionId: scope.sessionId });
      ctx.session = null; ctx.paused = false;
      patch(ctx, { session: null, paused: false });
      stage = 'storage'; await clearCommuteClosePending(scope);
    } catch {
      if (stage === 'update') ctx.ready = false;
      patch(ctx, { error: stage, ready: ctx.ready });
    } finally { ctx.busy = false; patch(ctx, { busy: false }); }
  }, [current, drain, hint, patch, request, savePending]);

  const sample = useCallback((ctx: Context, retryOnly = false): Promise<void> => {
    if (!current(ctx) || !ctx.ready || !ctx.session || ctx.busy || (ctx.paused && !retryOnly) || document.visibilityState === 'hidden') return Promise.resolve();
    if (ctx.sampleTask) return ctx.sampleTask;
    ctx.sampleTask = (async () => {
      let failure: RecorderError | null = null;
      if (!ctx.unsaved && !retryOnly) {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        ctx.controller.signal.addEventListener('abort', cancel, { once: true });
        const timer = setTimeout(cancel, 15_000);
        try {
          const point = await readPosition(controller.signal);
          if (!current(ctx) || ctx.busy || ctx.paused || !ctx.session || document.visibilityState === 'hidden'
            || !canRequestLocationPermission(Capacitor.isNativePlatform())) return;
          ctx.unsaved = prepareCommuteSample({ uid: ctx.uid, projectId: ctx.projectId, sessionId: ctx.session.sessionId }, point);
        } catch { failure = 'location'; }
        finally { clearTimeout(timer); ctx.controller.signal.removeEventListener('abort', cancel); }
      }
      if (!current(ctx)) return;
      try { await savePending(ctx); } catch { failure = 'storage'; }
      try { await drain(ctx); } catch { if (failure !== 'storage') failure = 'sample'; }
      try {
        if (await countCommuteSamples(ctx)) failure ??= 'sample';
      } catch { failure = 'storage'; }
      patch(ctx, { error: failure });
    })().finally(() => { ctx.sampleTask = null; });
    return ctx.sampleTask;
  }, [current, drain, patch, savePending]);

  const recover = useCallback(async (ctx: Context) => {
    if (!current(ctx) || ctx.busy) return;
    ctx.busy = true; ctx.ready = false;
    patch(ctx, { busy: true, ready: false, error: null });
    try {
      const body = await request(ctx, `active?projectId=${encodeURIComponent(ctx.projectId)}`);
      let session: Session | null = null;
      if (body.session !== null) {
        const value = body.session as Partial<Session> | undefined;
        if (!value || typeof value.sessionId !== 'string' || !/^[A-Za-z0-9_\-:.]{1,128}$/.test(value.sessionId)
          || value.projectId !== ctx.projectId || !isCommuteType(value.type)) throw new Error('Invalid active commute');
        session = value as Session;
      }
      if (!current(ctx)) return;
      ctx.session = session;
      ctx.paused = session ? await isCommuteClosePending({ uid: ctx.uid, projectId: ctx.projectId, sessionId: session.sessionId }) : false;
      hint(ctx, ctx.paused ? null : session);
      let failure: RecorderError | null = null;
      try { if (await countCommuteSamples(ctx)) failure = 'sample'; } catch { failure = 'storage'; }
      ctx.ready = true;
      patch(ctx, { session, paused: ctx.paused, ready: true, error: failure });
    } catch { patch(ctx, { error: 'recovery' }); }
    finally { ctx.busy = false; patch(ctx, { busy: false }); }
    if (ctx.ready && ctx.session) {
      if (ctx.paused) void finish(ctx);
      else void sample(ctx);
    }
  }, [current, finish, hint, patch, request, sample]);

  useEffect(() => {
    if (!uid || !projectId) { setActiveCommuteSession(null); return undefined; }
    const ctx: Context = { key, uid, projectId, disposed: false, ready: false, busy: false, paused: false,
      session: null, unsaved: null, sampleTask: null, controller: new AbortController() };
    contextRef.current = ctx;
    setActiveCommuteSession(null);
    void recover(ctx);
    const tick = () => { if (ctx.paused) void finish(ctx); else void sample(ctx); };
    const visible = () => { if (document.visibilityState !== 'hidden') tick(); };
    const online = () => { if (!ctx.ready) void recover(ctx); else if (ctx.paused) void finish(ctx); else void sample(ctx, true); };
    const interval = setInterval(tick, SAMPLE_INTERVAL_MS);
    window.addEventListener('online', online);
    window.addEventListener(LOCATION_PERMISSION_GATE_SETTLED_EVENT, tick);
    document.addEventListener('visibilitychange', visible);
    return () => {
      ctx.disposed = true; ctx.controller.abort(); clearInterval(interval);
      window.removeEventListener('online', online);
      window.removeEventListener(LOCATION_PERMISSION_GATE_SETTLED_EVENT, tick);
      document.removeEventListener('visibilitychange', visible);
      if (identityRef.current !== ctx.key && getActiveSession()?.ownerUid === ctx.uid) setActiveCommuteSession(null);
    };
  }, [uid, projectId, key, finish, recover, sample]);

  const toggle = useCallback(async () => {
    const ctx = contextRef.current;
    if (!ctx || !current(ctx) || !ctx.ready || ctx.busy) return;
    if (ctx.session) { await finish(ctx); return; }
    ctx.busy = true; patch(ctx, { busy: true, error: null });
    try {
      const body = await request(ctx, 'start', { projectId: ctx.projectId, type: 'home-to-site' });
      if (typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_\-:.]{1,128}$/.test(body.sessionId)) throw new Error('Invalid commute ID');
      if (!current(ctx)) return;
      ctx.session = { sessionId: body.sessionId, projectId: ctx.projectId, type: 'home-to-site' };
      hint(ctx, ctx.session); patch(ctx, { session: ctx.session });
    } catch {
      // A lifecycle response can be lost after the server committed. Pause
      // capture until recovery confirms whether this session is still open.
      ctx.ready = false; hint(ctx, null);
      patch(ctx, { error: 'update', ready: false });
    }
    finally { ctx.busy = false; patch(ctx, { busy: false }); }
    if (ctx.ready && ctx.session) void sample(ctx);
  }, [current, finish, hint, patch, request, sample]);

  const retry = useCallback(() => {
    const ctx = contextRef.current;
    if (!ctx || !current(ctx)) return;
    if (!ctx.ready) void recover(ctx);
    else if (ctx.paused) void finish(ctx);
    else if (ctx.session) void sample(ctx, state.error !== 'location');
    else void recover(ctx);
  }, [current, finish, recover, sample, state.error]);
  const scoped = state.key === key && uid && projectId ? state : null;
  return { sessionId: scoped?.session?.sessionId ?? null, busy: scoped?.busy ?? false,
    ready: scoped?.ready ?? false, paused: scoped?.paused ?? false, error: scoped?.error ?? null, toggle, retry };
}
