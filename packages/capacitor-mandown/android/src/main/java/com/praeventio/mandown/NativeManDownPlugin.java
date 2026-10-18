package com.praeventio.mandown;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import androidx.work.Operation;
import com.google.common.util.concurrent.ListenableFuture;
import java.util.UUID;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeManDown")
public final class NativeManDownPlugin extends Plugin {
    private static volatile NativeManDownPlugin instance;
    static final String EXTRA_START_REQUEST_ID = "startRequestId";
    private static final long START_TIMEOUT_MS = 8_000L;
    private static final Object START_LOCK = new Object();
    private static PendingStart pendingStart;

    private static final class PendingStart {
        final String id = UUID.randomUUID().toString();
        final long deadline = SystemClock.elapsedRealtime() + START_TIMEOUT_MS;
        final Handler handler = new Handler(Looper.getMainLooper());
        final PluginCall call;
        final Runnable timeout = () -> completeStart(id, "native_man_down_start_timeout");

        PendingStart(PluginCall call) { this.call = call; }
    }

    private static PendingStart beginStart(PluginCall call) {
        synchronized (START_LOCK) {
            if (pendingStart != null) return null;
            PendingStart attempt = new PendingStart(call);
            pendingStart = attempt;
            attempt.handler.postDelayed(attempt.timeout, START_TIMEOUT_MS);
            return attempt;
        }
    }

    static boolean isStartPending(String id) {
        synchronized (START_LOCK) {
            return pendingStart != null && pendingStart.id.equals(id)
                && SystemClock.elapsedRealtime() < pendingStart.deadline;
        }
    }

    /** Reserve one terminal result; never invoke the JavaScript bridge under the lock. */
    static boolean completeStart(String id, String error) {
        PendingStart attempt;
        synchronized (START_LOCK) {
            if (pendingStart == null || !pendingStart.id.equals(id)) return false;
            attempt = pendingStart;
            if (error == null && SystemClock.elapsedRealtime() >= attempt.deadline) {
                error = "native_man_down_start_timeout";
            }
            pendingStart = null;
        }
        attempt.handler.removeCallbacks(attempt.timeout);
        if (error != null) {
            attempt.call.reject(error);
            return false;
        }
        attempt.call.resolve(status(true));
        return true;
    }

    private static void cancelPendingStart() {
        String id;
        synchronized (START_LOCK) { id = pendingStart == null ? null : pendingStart.id; }
        completeStart(id, "native_man_down_start_cancelled");
    }

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void start(PluginCall call) {
        // TYPE_ACCELEROMETER is a raw device sensor, not Android Activity
        // Recognition. Do not request an unrelated runtime permission here:
        // consent denial must not silently disable a lone-worker safety session.
        startService(call);
    }

    private void startService(PluginCall call) {
        String projectId = call.getString("projectId");
        String sessionId = call.getString("sessionId");
        String capability = call.getString("capability");
        String apiBaseUrl = NativeManDownEndpoint.canonicalize(call.getString("apiBaseUrl"));
        Integer inactivityThresholdMs = call.getInt("inactivityThresholdMs");
        Double impactThresholdMps2 = call.getDouble("impactThresholdMps2", 25d);
        if (blank(projectId) || blank(sessionId) || blank(capability) || apiBaseUrl == null
                || inactivityThresholdMs == null) {
            call.reject("projectId, sessionId, capability, canonical apiBaseUrl and inactivityThresholdMs are required");
            return;
        }
        Intent intent = new Intent(getContext(), NativeManDownForegroundService.class);
        intent.setAction(NativeManDownForegroundService.ACTION_START);
        intent.putExtra(NativeManDownForegroundService.EXTRA_PROJECT_ID, projectId);
        intent.putExtra(NativeManDownForegroundService.EXTRA_SESSION_ID, sessionId);
        intent.putExtra(NativeManDownForegroundService.EXTRA_CAPABILITY, capability);
        String capabilityExpiresAt = call.getString("capabilityExpiresAt");
        if (capabilityExpiresAt == null) {
            call.reject("capabilityExpiresAt is required");
            return;
        }
        intent.putExtra(NativeManDownForegroundService.EXTRA_CAPABILITY_EXPIRES_AT, capabilityExpiresAt);
        intent.putExtra(NativeManDownForegroundService.EXTRA_API_BASE_URL, apiBaseUrl);
        intent.putExtra(NativeManDownForegroundService.EXTRA_INACTIVITY_MS, inactivityThresholdMs.longValue());
        intent.putExtra(NativeManDownForegroundService.EXTRA_IMPACT_THRESHOLD, impactThresholdMps2.floatValue());
        Integer cancelWindowMs = call.getInt("cancelWindowMs");
        if (cancelWindowMs != null) {
            intent.putExtra(NativeManDownForegroundService.EXTRA_CANCEL_WINDOW_MS, cancelWindowMs.longValue());
        }
        PendingStart attempt = beginStart(call);
        if (attempt == null) {
            call.reject("native_man_down_start_in_progress");
            return;
        }
        intent.putExtra(EXTRA_START_REQUEST_ID, attempt.id);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
        } catch (Exception error) {
            completeStart(attempt.id, "native_man_down_start_failed: " + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            cancelPendingStart();
            NativeManDownSuspectWorker.StopRequest request =
                NativeManDownSuspectWorker.explicitStop(getContext());
            ListenableFuture<Operation.State.SUCCESS> completion = request.cancellation.getResult();
            // Capacitor shares a handler across plugins. Observe completion
            // asynchronously so cancellation cannot block other native actions.
            completion.addListener(() -> {
                try {
                    completion.get(); // Listener runs only after completion; never waits.
                    if (!request.persisted) {
                        throw new IllegalStateException("native_man_down_stop_persist_failed");
                    }
                    call.resolve();
                } catch (Exception error) {
                    if (error instanceof InterruptedException) Thread.currentThread().interrupt();
                    call.reject("native_man_down_stop_failed: " + error.getMessage());
                }
            }, Runnable::run);
        } catch (Exception error) {
            call.reject("native_man_down_stop_failed: " + error.getMessage());
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        // Android does not provide a safe generic foreground-service query. The
        // Web layer treats this as advisory; the server session remains source of truth.
        call.resolve(status(false));
    }

    static void emitSuspected(String kind, long deadlineMs) {
        NativeManDownPlugin plugin = instance;
        if (plugin == null) return;
        JSObject event = new JSObject();
        event.put("kind", kind);
        event.put("deadlineMs", deadlineMs);
        plugin.notifyListeners("nativeManDownSuspected", event, true);
    }

    static void emitExpired() {
        NativeManDownPlugin plugin = instance;
        if (plugin == null) return;
        plugin.notifyListeners("nativeManDownExpired", new JSObject(), true);
    }

    static void emitCancelled() {
        NativeManDownPlugin plugin = instance;
        if (plugin == null) return;
        plugin.notifyListeners("nativeManDownCancelled", new JSObject(), true);
    }

    static void emitError(String error) {
        NativeManDownPlugin plugin = instance;
        if (plugin == null) return;
        JSObject event = new JSObject();
        event.put("error", error);
        plugin.notifyListeners("nativeManDownError", event, true);
    }

    private static JSObject status(boolean running) {
        JSObject result = new JSObject();
        result.put("running", running);
        return result;
    }

    private static boolean blank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
