package com.praeventio.proximity;

import android.app.Activity;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Window;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.PluginCall;

final class CapacitorProximity {
    static final String PLUGIN_VERSION = "0.1.0";
    private static final String TAG = "PraeventioProximity";

    interface ReadingListener {
        void onReading(JSObject reading);
    }

    private final Activity activity;
    private final SensorManager sensorManager;
    private final Sensor proximitySensor;
    private final ReadingListener readingListener;
    private SensorEventListener sensorEventListener;
    private boolean enabled;
    private boolean windowStateCaptured;
    private float originalBrightness = WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE;
    private boolean originalKeepScreenOn;
    private String lastState;
    private long lastTimestamp;
    private Float lastDistance;

    CapacitorProximity(Activity activity, ReadingListener readingListener) {
        this.activity = activity;
        this.readingListener = readingListener;
        if (activity == null) {
            sensorManager = null;
            proximitySensor = null;
            return;
        }
        sensorManager = (SensorManager) activity.getSystemService(Context.SENSOR_SERVICE);
        proximitySensor = sensorManager == null
            ? null
            : sensorManager.getDefaultSensor(Sensor.TYPE_PROXIMITY);
    }

    void enable(PluginCall call) {
        if (activity == null) {
            call.reject("Activity not available.");
            return;
        }
        if (proximitySensor == null || sensorManager == null) {
            call.reject("Proximity sensor not available on this device.");
            return;
        }
        if (enabled) {
            call.resolve();
            return;
        }

        captureWindowState();
        sensorEventListener = new SensorEventListener() {
            @Override
            public void onSensorChanged(SensorEvent event) {
                if (event.sensor.getType() != Sensor.TYPE_PROXIMITY || event.values.length == 0) {
                    return;
                }
                handleDistance(event.values[0]);
            }

            @Override
            public void onAccuracyChanged(Sensor sensor, int accuracy) {
                // Proximity state is derived from each distance reading.
            }
        };

        boolean registered = sensorManager.registerListener(
            sensorEventListener,
            proximitySensor,
            SensorManager.SENSOR_DELAY_NORMAL
        );
        if (!registered) {
            sensorEventListener = null;
            restoreWindowState();
            call.reject("Failed to register the proximity sensor listener.");
            return;
        }

        enabled = true;
        call.resolve();
    }

    void disable(PluginCall call) {
        stopMonitoring();
        call.resolve();
    }

    JSObject getStatus() {
        JSObject result = new JSObject();
        result.put("available", proximitySensor != null);
        result.put("enabled", enabled);
        result.put("platform", "android");
        return result;
    }

    JSObject getCurrent() {
        if (lastState == null || lastDistance == null) {
            return null;
        }
        return reading(lastState, lastTimestamp, lastDistance);
    }

    String getPluginVersion() {
        return PLUGIN_VERSION;
    }

    void stopMonitoring() {
        if (sensorManager != null && sensorEventListener != null) {
            sensorManager.unregisterListener(sensorEventListener);
        }
        sensorEventListener = null;
        enabled = false;
        lastState = null;
        lastDistance = null;
        lastTimestamp = 0L;
        restoreWindowState();
    }

    private void handleDistance(float distance) {
        boolean near = ProximityStateMapper.isNear(distance, proximitySensor.getMaximumRange());
        String state = near ? "near" : "far";
        long timestamp = System.currentTimeMillis();
        boolean changed = !state.equals(lastState);

        lastState = state;
        lastTimestamp = timestamp;
        lastDistance = distance;

        if (near) {
            dimScreen();
        } else {
            restoreScreenWithoutDiscardingSnapshot();
        }

        if (changed) {
            readingListener.onReading(reading(state, timestamp, distance));
        }
    }

    private static JSObject reading(String state, long timestamp, float distance) {
        JSObject result = new JSObject();
        result.put("state", state);
        result.put("timestamp", timestamp);
        result.put("distance", distance);
        return result;
    }

    private void captureWindowState() {
        WindowManager.LayoutParams params = activity.getWindow().getAttributes();
        originalBrightness = params.screenBrightness;
        originalKeepScreenOn =
            (params.flags & WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0;
        windowStateCaptured = true;
    }

    private void dimScreen() {
        try {
            Window window = activity.getWindow();
            WindowManager.LayoutParams params = window.getAttributes();
            params.flags |= WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
            params.screenBrightness = 0.0f;
            window.setAttributes(params);
        } catch (Exception exception) {
            Logger.error(TAG, "Failed to dim the app window.", exception);
        }
    }

    private void restoreScreenWithoutDiscardingSnapshot() {
        if (windowStateCaptured) {
            applyOriginalWindowState();
        }
    }

    private void restoreWindowState() {
        if (!windowStateCaptured || activity == null) {
            return;
        }
        applyOriginalWindowState();
        windowStateCaptured = false;
    }

    private void applyOriginalWindowState() {
        try {
            Window window = activity.getWindow();
            WindowManager.LayoutParams params = window.getAttributes();
            params.screenBrightness = originalBrightness;
            if (originalKeepScreenOn) {
                params.flags |= WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
            } else {
                params.flags &= ~WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON;
            }
            window.setAttributes(params);
        } catch (Exception exception) {
            Logger.error(TAG, "Failed to restore the app window.", exception);
        }
    }
}
