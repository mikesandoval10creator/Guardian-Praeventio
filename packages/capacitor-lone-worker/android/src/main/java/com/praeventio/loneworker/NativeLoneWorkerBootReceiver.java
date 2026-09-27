package com.praeventio.loneworker;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Re-attaches an still-authorized session after an ordinary device reboot or
 * package replacement. The service validates the persisted capability again;
 * an ended/expired session is not revived.
 */
public final class NativeLoneWorkerBootReceiver extends BroadcastReceiver {
    private static final String PREFS = "guardian_native_lone_worker_state";
    private static final String PREF_PROJECT = "projectId";
    private static final String PREF_SESSION = "sessionId";
    private static final String PREF_CAPABILITY = "capability";
    private static final String PREF_API_BASE = "apiBaseUrl";
    private static final String PREF_EXPIRES_AT = "capabilityExpiresAt";

    @Override
    public void onReceive(Context context, Intent received) {
        String action = received.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
            && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (prefs.getString(PREF_PROJECT, null) == null
            || prefs.getString(PREF_SESSION, null) == null
            || prefs.getString(PREF_CAPABILITY, null) == null
            || prefs.getString(PREF_API_BASE, null) == null
            || prefs.getLong(PREF_EXPIRES_AT, 0L) <= System.currentTimeMillis()) {
            return;
        }
        Intent service = new Intent(context, NativeLoneWorkerForegroundService.class);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(service);
            } else {
                context.startService(service);
            }
        } catch (Exception ignored) {
            // The native service remains fail-closed; the next authenticated
            // WebView bridge pass can surface the start failure to telemetry.
        }
    }
}
