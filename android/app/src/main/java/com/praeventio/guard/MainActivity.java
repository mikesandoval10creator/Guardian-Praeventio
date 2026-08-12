package com.praeventio.guard;

// SPDX-License-Identifier: MIT
//
// Sprint 50 E.10 P1 H6 — Health Connect permission contract.
// Ticket 39baa66d-73fe-81d8-a477-cb1f50948819.
//
// Background: the JS adapter
// (src/services/health/healthConnectAdapter.ts) calls
// `HealthConnect.requestPermissions({ read: [...recordTypes] })` via the
// `@kiwi-health/capacitor-health-connect` plugin. The plugin delegates to
// `ActivityResultLauncher.RequestPermission()` which lives on the host
// Activity. To avoid a runtime `IllegalStateException: FragmentManager has
// been destroyed` (the plugin tries to find a launcher by tag), the host
// Activity must:
//
//   1. Register a launcher for the runtime permission request contract.
//   2. Forward the permission result back to the plugin so the JS
//      Promise resolves.
//
// BridgeActivity is Capacitor's base class. We don't subclass
// FragmentActivity directly — BridgeActivity already extends it. We
// register the launcher in `onCreate` after super and stash the contract
// in a static field the plugin can read via reflection-free lookup.
//
// The plugin reads permissions via `ActivityCompat.requestPermissions`
// (legacy path) AND a new `registerForActivityResult` (modern path). We
// register BOTH so the plugin picks whichever it wants. The launcher
// callback just forwards the result to a static sink; the plugin's JS
// side polls it.
//
// See: https://developer.android.com/health-and-fitness/guides/health-connect

import android.os.Bundle;
import android.util.Log;
import android.view.WindowManager;

import androidx.activity.result.ActivityResultCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.activity.result.contract.ActivityResultContracts.RequestMultiplePermissions;
import androidx.activity.result.contract.ActivityResultContracts.RequestPermission;

import com.getcapacitor.BridgeActivity;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {

    /**
     * Static sink used by the @kiwi-health/capacitor-health-connect
     * plugin's permission bridge. The plugin's Kotlin side reads from
     * this map via reflection-free `MainActivity.getLastPermissionResult()`.
     */
    private static final Map<String, Boolean> LAST_PERMISSION_RESULT = new HashMap<>();
    private static final Object RESULT_LOCK = new Object();

    private static volatile WeakReference<MainActivity> CURRENT_INSTANCE = new WeakReference<>(null);

    private ActivityResultLauncher<String> singlePermissionLauncher;
    private ActivityResultLauncher<String[]> multiPermissionLauncher;

    /**
     * Public, reflection-safe accessor for the plugin. Returns a copy of
     * the last permission grant map and clears it so each new request
     * gets a fresh snapshot.
     */
    public static Map<String, Boolean> consumeLastPermissionResult() {
        synchronized (RESULT_LOCK) {
            if (LAST_PERMISSION_RESULT.isEmpty()) {
                return new HashMap<>();
            }
            Map<String, Boolean> snapshot = new HashMap<>(LAST_PERMISSION_RESULT);
            LAST_PERMISSION_RESULT.clear();
            return snapshot;
        }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Protect worker PII in screenshots and the recent-apps preview before
        // Capacitor creates the WebView and renders the first document.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        super.onCreate(savedInstanceState);
        CURRENT_INSTANCE = new WeakReference<>(this);

        // Modern path: registerForActivityResult (API 23+, recommended).
        // The plugin uses RequestMultiplePermissions for the initial batch
        // and RequestPermission for incremental scopes.
        singlePermissionLauncher = registerForActivityResult(
            new RequestPermission(),
            result -> {
                String requested = pendingSinglePermission;
                pendingSinglePermission = null;
                synchronized (RESULT_LOCK) {
                    LAST_PERMISSION_RESULT.put(requested, Boolean.TRUE.equals(result));
                }
                Log.i("PraeventioHealth", "Permission result for " + requested + ": " + result);
            }
        );

        multiPermissionLauncher = registerForActivityResult(
            new RequestMultiplePermissions(),
            result -> {
                String[] requested = pendingMultiPermissions;
                pendingMultiPermissions = null;
                synchronized (RESULT_LOCK) {
                    for (String perm : requested) {
                        Boolean granted = result.get(perm);
                        LAST_PERMISSION_RESULT.put(perm, Boolean.TRUE.equals(granted));
                    }
                }
                Log.i("PraeventioHealth", "Multi-permission result: " + result);
            }
        );

        Log.i("PraeventioHealth", "MainActivity onCreate — Health Connect launchers registered");
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        CURRENT_INSTANCE = new WeakReference<>(null);
    }

    private volatile String pendingSinglePermission;
    private volatile String[] pendingMultiPermissions;

    /**
     * Reflective entry point used by the plugin to launch the runtime
     * permission UI. Returns true if the launcher was registered + used,
     * false if MainActivity isn't in onCreate yet (caller can retry).
     */
    public static boolean launchPermissionRequest(String[] permissions) {
        MainActivity activity = CURRENT_INSTANCE.get();
        if (activity == null || permissions == null || permissions.length == 0) {
            return false;
        }
        if (permissions.length == 1) {
            activity.pendingSinglePermission = permissions[0];
            activity.singlePermissionLauncher.launch(permissions[0]);
        } else {
            activity.pendingMultiPermissions = Arrays.copyOf(permissions, permissions.length);
            activity.multiPermissionLauncher.launch(activity.pendingMultiPermissions);
        }
        return true;
    }
}
