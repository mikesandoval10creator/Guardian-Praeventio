package com.praeventio.loneworker;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.core.content.ContextCompat;

/** Capacitor boundary for the Android-owned lone-worker session service. */
@CapacitorPlugin(name = "NativeLoneWorker")
public final class NativeLoneWorkerPlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        String projectId = call.getString("projectId");
        String sessionId = call.getString("sessionId");
        String capability = call.getString("capability");
        String apiBaseUrl = call.getString("apiBaseUrl");
        String capabilityExpiresAt = call.getString("capabilityExpiresAt");
        Integer heartbeatIntervalMs = call.getInt("heartbeatIntervalMs");

        if (blank(projectId) || blank(sessionId) || blank(capability)
            || blank(apiBaseUrl) || blank(capabilityExpiresAt)) {
            call.reject(
                "projectId, sessionId, capability, apiBaseUrl and capabilityExpiresAt are required"
            );
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            && !hasLocationPermission(getContext())) {
            call.reject("location_permission_required");
            return;
        }

        Intent intent = new Intent(getContext(), NativeLoneWorkerForegroundService.class);
        intent.setAction(NativeLoneWorkerForegroundService.ACTION_START);
        intent.putExtra(NativeLoneWorkerForegroundService.EXTRA_PROJECT_ID, projectId);
        intent.putExtra(NativeLoneWorkerForegroundService.EXTRA_SESSION_ID, sessionId);
        intent.putExtra(NativeLoneWorkerForegroundService.EXTRA_CAPABILITY, capability);
        intent.putExtra(NativeLoneWorkerForegroundService.EXTRA_API_BASE_URL, apiBaseUrl);
        intent.putExtra(
            NativeLoneWorkerForegroundService.EXTRA_CAPABILITY_EXPIRES_AT,
            capabilityExpiresAt
        );
        if (heartbeatIntervalMs != null) {
            intent.putExtra(
                NativeLoneWorkerForegroundService.EXTRA_HEARTBEAT_INTERVAL_MS,
                heartbeatIntervalMs.longValue()
            );
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(intent);
            } else {
                getContext().startService(intent);
            }
            call.resolve(status(true));
        } catch (Exception error) {
            call.reject("native_lone_worker_start_failed: " + error.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        try {
            NativeLoneWorkerForegroundService.explicitStop(getContext());
            call.resolve();
        } catch (Exception error) {
            call.reject("native_lone_worker_stop_failed: " + error.getMessage());
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        NativeLoneWorkerForegroundService.NativeLoneWorkerStatusSnapshot snapshot =
            NativeLoneWorkerForegroundService.status(getContext());
        JSObject result = new JSObject();
        result.put("running", snapshot.running);
        if (snapshot.lastHeartbeatAt != null) {
            result.put("lastHeartbeatAt", snapshot.lastHeartbeatAt);
        }
        if (snapshot.lastError != null) {
            result.put("lastError", snapshot.lastError);
        }
        call.resolve(result);
    }

    private static JSObject status(boolean running) {
        JSObject result = new JSObject();
        result.put("running", running);
        return result;
    }

    private static boolean hasLocationPermission(Context context) {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean blank(String value) {
        return value == null || value.trim().isEmpty();
    }
}
