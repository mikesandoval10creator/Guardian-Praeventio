package com.praeventio.mandown;

import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeManDown")
public final class NativeManDownPlugin extends Plugin {
    private static volatile NativeManDownPlugin instance;

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
        String apiBaseUrl = call.getString("apiBaseUrl");
        Integer inactivityThresholdMs = call.getInt("inactivityThresholdMs");
        Double impactThresholdMps2 = call.getDouble("impactThresholdMps2", 25d);
        if (blank(projectId) || blank(sessionId) || blank(capability) || blank(apiBaseUrl)
                || inactivityThresholdMs == null) {
            call.reject("projectId, sessionId, capability, apiBaseUrl and inactivityThresholdMs are required");
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
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve(status(true));
        } catch (Exception error) {
            call.reject("native_man_down_start_failed: " + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), NativeManDownForegroundService.class));
            call.resolve();
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
