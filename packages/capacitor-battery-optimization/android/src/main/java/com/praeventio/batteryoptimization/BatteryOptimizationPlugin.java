package com.praeventio.batteryoptimization;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;

/**
 * Battery-optimization exclusion plugin for life-safety foreground services.
 *
 * Sole responsibility: query the OS battery-optimization exemption state and
 * open the system Settings intent that lets the user grant it. Does NOT touch
 * sensors, location, foreground services, or any other system resource —
 * staying narrow keeps the audit surface small (Play Console review looks at
 * plugins individually).
 *
 * Manifest contract: the host app MUST declare
 * {@code android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS}. The plugin
 * itself declares nothing; on API 23+ the Settings intent is always
 * resolvable when the host holds the permission.
 *
 * Threads: all methods are non-blocking. PowerManager calls happen on the
 * Capacitor executor (already off-main).
 */
public class BatteryOptimizationPlugin extends Plugin {

    @PluginMethod
    public void isIgnoringBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        boolean ignoring;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            // pm can theoretically be null on stripped-down ROMs. Treat null
            // as "unknown" → not ignoring → caller decides whether to prompt.
            ignoring = pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
        } else {
            // Battery optimization was introduced in API 23 (Marshmallow).
            // Devices below the floor can't be on the list; treat as already
            // exempt so we don't badger them with a Settings prompt they can't
            // act on.
            ignoring = true;
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", ignoring);
        call.resolve(ret);
    }

    @PluginMethod
    public void openRequestIgnoreBatteryOptimizations(PluginCall call) {
        Context context = getContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            // Pre-M has no battery-optimization screen. Resolve true so the
            // caller's "did we open the dialog" check passes; the query path
            // already returned ignoring=true above.
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
            return;
        }
        // ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is the canonical intent
        // for the per-app exemption. Falls back to the generic battery-
        // optimization settings page on OEMs that stripped it (rare but seen
        // on Xiaomi MIUI builds where the activity exists but rejects the
        // specific action).
        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
        intent.setData(Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        boolean opened;
        try {
            context.startActivity(intent);
            opened = true;
        } catch (ActivityNotFoundException primary) {
            // Fallback: open the generic battery-optimization list. Some OEMs
            // (older EMUI, Vivo) require the user to navigate from there.
            try {
                Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(fallback);
                opened = true;
            } catch (ActivityNotFoundException secondary) {
                // Both intents unresolved. Caller should log + degrade.
                opened = false;
            }
        }
        JSObject ret = new JSObject();
        ret.put("opened", opened);
        call.resolve(ret);
    }
}