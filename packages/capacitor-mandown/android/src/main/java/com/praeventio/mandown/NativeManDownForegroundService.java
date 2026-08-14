package com.praeventio.mandown;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.Instant;

/**
 * Android-owned ManDown loop. It remains alive while Capacitor's WebView is
 * backgrounded, but never skips worker confirmation: a sensor signal is stored
 * as suspected, exposes an explicit "Estoy bien" action, and only becomes a
 * queued server alert after its durable countdown expires.
 *
 * The process holds no Firebase token or project secret. Its only authority is
 * the opaque, session-bound server capability whose SHA-256 hash lives server-side.
 */
public final class NativeManDownForegroundService extends Service implements SensorEventListener {
    static final String ACTION_START = "com.praeventio.mandown.START";
    static final String ACTION_STOP = "com.praeventio.mandown.STOP";
    static final String ACTION_CANCEL_SUSPECT = "com.praeventio.mandown.CANCEL_SUSPECT";
    static final String EXTRA_PROJECT_ID = "projectId";
    static final String EXTRA_SESSION_ID = "sessionId";
    static final String EXTRA_CAPABILITY = "capability";
    static final String EXTRA_CAPABILITY_EXPIRES_AT = "capabilityExpiresAt";
    static final String EXTRA_API_BASE_URL = "apiBaseUrl";
    static final String EXTRA_INACTIVITY_MS = "inactivityThresholdMs";
    static final String EXTRA_IMPACT_THRESHOLD = "impactThresholdMps2";
    static final String EXTRA_CANCEL_WINDOW_MS = "cancelWindowMs";

    private static final String TAG = "NativeManDown";
    private static final String CHANNEL_ID = "guardian_man_down";
    private static final int NOTIFICATION_ID = 4821;
    private static final long MIN_INACTIVITY_MS = 5_000L;
    private static final long MAX_INACTIVITY_MS = 24L * 60L * 60L * 1000L;
    private static final float DEFAULT_IMPACT_THRESHOLD = 25f;
    private static final float MOVEMENT_DELTA = 1.5f;
    private static final long DEFAULT_CANCEL_WINDOW_MS = 20_000L;
    private static final long MIN_CANCEL_WINDOW_MS = 10_000L;
    private static final long MAX_CANCEL_WINDOW_MS = 60_000L;

    static final int DELIVERY_ACCEPTED = 1;
    static final int DELIVERY_RETRYABLE = 2;
    static final int DELIVERY_AUTHORITY_GONE = 3;

    private static final String PREFS = "guardian_native_mandown_state";
    private static final String PREF_SUSPECTED_PAYLOAD = "suspectedPayload";
    private static final String PREF_SUSPECTED_DEADLINE = "suspectedDeadline";
    private static final String PREF_CONFIG_PROJECT = "configProject";
    private static final String PREF_CONFIG_SESSION = "configSession";
    private static final String PREF_CONFIG_CAPABILITY = "configCapability";
    private static final String PREF_CONFIG_CAPABILITY_EXPIRES_AT = "configCapabilityExpiresAt";
    private static final String PREF_CONFIG_API_BASE = "configApiBase";

    private SensorManager sensorManager;
    private Sensor accelerometer;
    private String projectId;
    private String sessionId;
    private String capability;
    private String apiBaseUrl;
    private long capabilityExpiresAtMs;
    private long inactivityThresholdMs;
    private long cancelWindowMs;
    private float impactThreshold;
    private long lastMovementElapsedMs;
    private float lastMagnitude = Float.NaN;
    private boolean suspected;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private Runnable expiryRunnable;
    private Runnable capabilityExpiryRunnable;

    @Override
    public void onCreate() {
        super.onCreate();
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        accelerometer = sensorManager == null ? null : sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        createChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent == null || ACTION_STOP.equals(intent.getAction())) {
            stopMonitoring();
            return START_NOT_STICKY;
        }
        if (ACTION_CANCEL_SUSPECT.equals(intent.getAction())) {
            cancelSuspected();
            return START_NOT_STICKY;
        }
        if (!ACTION_START.equals(intent.getAction()) || !readConfig(intent)) {
            Log.w(TAG, "Refusing malformed native ManDown start");
            stopMonitoring();
            return START_NOT_STICKY;
        }

        startForeground(NOTIFICATION_ID, buildMonitoringNotification());
        lastMovementElapsedMs = SystemClock.elapsedRealtime();
        if (accelerometer == null || !sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME)) {
            Log.e(TAG, "Accelerometer unavailable; stopping native ManDown service");
            stopMonitoring();
            return START_NOT_STICKY;
        }
        restoreSuspectedIfPresent();
        scheduleCapabilityExpiry();
        return START_NOT_STICKY; // explicit session end/capability expiry must not revive stale monitoring.
    }

    private boolean readConfig(Intent intent) {
        projectId = intent.getStringExtra(EXTRA_PROJECT_ID);
        sessionId = intent.getStringExtra(EXTRA_SESSION_ID);
        capability = intent.getStringExtra(EXTRA_CAPABILITY);
        String expiryRaw = intent.getStringExtra(EXTRA_CAPABILITY_EXPIRES_AT);
        capabilityExpiresAtMs = expiryRaw == null ? 0L : parseEpochMs(expiryRaw);
        apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL);
        long requestedInactivity = intent.getLongExtra(EXTRA_INACTIVITY_MS, 30_000L);
        inactivityThresholdMs = Math.max(MIN_INACTIVITY_MS, Math.min(MAX_INACTIVITY_MS, requestedInactivity));
        long requestedCancel = intent.getLongExtra(EXTRA_CANCEL_WINDOW_MS, DEFAULT_CANCEL_WINDOW_MS);
        cancelWindowMs = Math.max(MIN_CANCEL_WINDOW_MS, Math.min(MAX_CANCEL_WINDOW_MS, requestedCancel));
        impactThreshold = intent.getFloatExtra(EXTRA_IMPACT_THRESHOLD, DEFAULT_IMPACT_THRESHOLD);
        if (impactThreshold <= 0 || impactThreshold > 200) impactThreshold = DEFAULT_IMPACT_THRESHOLD;
        boolean valid = nonEmpty(projectId) && nonEmpty(sessionId) && nonEmpty(capability)
            && capability.matches("[A-Za-z0-9_-]{32,256}")
            && capabilityExpiresAtMs > System.currentTimeMillis()
            && nonEmpty(apiBaseUrl) && apiBaseUrl.startsWith("https://");
        if (valid) {
            // A stale suspected countdown must never be rebound to a different
            // project/session after Android restarts the service.
            SharedPreferences state = prefs();
            String previousProject = state.getString(PREF_CONFIG_PROJECT, null);
            String previousSession = state.getString(PREF_CONFIG_SESSION, null);
            if (!projectId.equals(previousProject) || !sessionId.equals(previousSession)) {
                NativeManDownSuspectWorker.cancel(getApplicationContext());
            }
            persistConfig();
        }
        return valid;
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (suspected || event.values.length < 3) return;
        float magnitude = (float) Math.sqrt(
            event.values[0] * event.values[0]
                + event.values[1] * event.values[1]
                + event.values[2] * event.values[2]
        );
        long now = SystemClock.elapsedRealtime();
        if (!Float.isNaN(lastMagnitude) && Math.abs(magnitude - lastMagnitude) > MOVEMENT_DELTA) {
            lastMovementElapsedMs = now;
        }
        lastMagnitude = magnitude;
        if (magnitude >= impactThreshold) {
            suspect("impact", magnitude, null);
        } else if (now - lastMovementElapsedMs >= inactivityThresholdMs) {
            suspect("inactivity", null, now - lastMovementElapsedMs);
        }
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }

    private void suspect(String kind, @Nullable Float acceleration, @Nullable Long inactivity) {
        if (suspected) return;
        try {
            JSONObject payload = new JSONObject();
            payload.put("kind", kind);
            payload.put("occurredAt", Instant.now().toString());
            if (acceleration != null) payload.put("accelerationMps2", acceleration);
            if (inactivity != null) payload.put("inactivityMs", inactivity);

            long deadline = System.currentTimeMillis() + cancelWindowMs;
            boolean saved = prefs().edit()
                .putString(PREF_SUSPECTED_PAYLOAD, payload.toString())
                .putLong(PREF_SUSPECTED_DEADLINE, deadline)
                .commit();
            if (!saved) {
                NativeManDownPlugin.emitError("native_man_down_suspect_persist_failed");
                return;
            }
            suspected = true;
            NativeManDownSuspectWorker.schedule(getApplicationContext(), cancelWindowMs);
            scheduleExpiry(deadline);
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildSuspectedNotification());
            NativeManDownPlugin.emitSuspected(kind, deadline);
        } catch (Exception error) {
            Log.e(TAG, "Native ManDown suspect persistence failed", error);
            NativeManDownPlugin.emitError("native_man_down_suspect_persist_failed");
        }
    }

    private void scheduleExpiry(long deadline) {
        if (expiryRunnable != null) handler.removeCallbacks(expiryRunnable);
        expiryRunnable = this::expireSuspected;
        handler.postDelayed(expiryRunnable, Math.max(0L, deadline - System.currentTimeMillis()));
    }

    private void scheduleCapabilityExpiry() {
        if (capabilityExpiryRunnable != null) handler.removeCallbacks(capabilityExpiryRunnable);
        capabilityExpiryRunnable = () -> {
            clearAllState();
            stopMonitoring();
        };
        handler.postDelayed(
            capabilityExpiryRunnable,
            Math.max(0L, capabilityExpiresAtMs - System.currentTimeMillis())
        );
    }

    private void restoreSuspectedIfPresent() {
        long deadline = prefs().getLong(PREF_SUSPECTED_DEADLINE, 0L);
        if (deadline <= 0L) return;
        suspected = true;
        if (deadline <= System.currentTimeMillis()) {
            expireSuspected();
        } else {
            scheduleExpiry(deadline);
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildSuspectedNotification());
        }
    }

    private void expireSuspected() {
        String raw = prefs().getString(PREF_SUSPECTED_PAYLOAD, null);
        if (raw == null) return; // Cancel action won the race.
        try {
            boolean queued = NativeManDownRetryWorker.enqueuePending(
                getApplicationContext(), projectId, sessionId, capability, apiBaseUrl, new JSONObject(raw)
            );
            if (!queued) {
                NativeManDownPlugin.emitError("native_man_down_outbox_persist_failed");
                NativeManDownSuspectWorker.schedule(getApplicationContext(), 1_000L);
                return;
            }
            clearSuspectedLocal();
            NativeManDownRetryWorker.enqueueRetry(getApplicationContext());
            NativeManDownPlugin.emitExpired();
        } catch (Exception error) {
            Log.e(TAG, "Native ManDown suspect expiry failed", error);
            NativeManDownSuspectWorker.schedule(getApplicationContext(), 1_000L);
        }
    }

    private void cancelSuspected() {
        clearSuspectedLocal();
        lastMovementElapsedMs = SystemClock.elapsedRealtime();
        NativeManDownPlugin.emitCancelled();
    }

    private void clearSuspectedLocal() {
        if (expiryRunnable != null) handler.removeCallbacks(expiryRunnable);
        expiryRunnable = null;
        suspected = false;
        NativeManDownSuspectWorker.cancel(getApplicationContext());
        getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildMonitoringNotification());
    }

    private void persistConfig() {
        prefs().edit()
            .putString(PREF_CONFIG_PROJECT, projectId)
            .putString(PREF_CONFIG_SESSION, sessionId)
            .putString(PREF_CONFIG_CAPABILITY, capability)
            .putLong(PREF_CONFIG_CAPABILITY_EXPIRES_AT, capabilityExpiresAtMs)
            .putString(PREF_CONFIG_API_BASE, apiBaseUrl)
            .commit();
    }

    private void clearAllState() {
        if (capabilityExpiryRunnable != null) handler.removeCallbacks(capabilityExpiryRunnable);
        capabilityExpiryRunnable = null;
        NativeManDownSuspectWorker.cancel(getApplicationContext());
        prefs().edit().clear().commit();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static int postPersistedEvent(
        String apiBaseUrl,
        String projectId,
        String sessionId,
        String capability,
        @Nullable JSONObject payload
    ) {
        HttpURLConnection connection = null;
        try {
            if (apiBaseUrl == null || projectId == null || sessionId == null || capability == null || payload == null) {
                return DELIVERY_AUTHORITY_GONE;
            }
            String base = apiBaseUrl.endsWith("/") ? apiBaseUrl.substring(0, apiBaseUrl.length() - 1) : apiBaseUrl;
            URL url = new URL(base + "/api/sprint-k/" + projectId + "/lone-worker/" + sessionId + "/native-man-down");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(10_000);
            connection.setReadTimeout(10_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setRequestProperty("X-ManDown-Capability", capability);
            byte[] encoded = payload.toString().getBytes(StandardCharsets.UTF_8);
            connection.setFixedLengthStreamingMode(encoded.length);
            try (OutputStream out = new BufferedOutputStream(connection.getOutputStream())) {
                out.write(encoded);
            }
            int code = connection.getResponseCode();
            if (code == HttpURLConnection.HTTP_ACCEPTED) return DELIVERY_ACCEPTED;
            if (code == HttpURLConnection.HTTP_UNAUTHORIZED || code == HttpURLConnection.HTTP_CONFLICT) {
                return DELIVERY_AUTHORITY_GONE;
            }
            Log.w(TAG, "Native ManDown delivery retryable: HTTP " + code);
            return DELIVERY_RETRYABLE;
        } catch (Exception error) {
            Log.w(TAG, "Native ManDown delivery deferred", error);
            return DELIVERY_RETRYABLE;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void stopMonitoring() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
        if (expiryRunnable != null) handler.removeCallbacks(expiryRunnable);
        NativeManDownSuspectWorker.cancel(getApplicationContext());
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
        if (expiryRunnable != null) handler.removeCallbacks(expiryRunnable);
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Guardian — ManDown activo",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Monitoreo de seguridad activo durante una sesión de trabajo solitario.");
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification buildMonitoringNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("Guardian activo — ManDown")
            .setContentText("Monitoreo nativo de sesión solitaria activo.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build();
    }

    private Notification buildSuspectedNotification() {
        Intent cancel = new Intent(this, NativeManDownForegroundService.class);
        cancel.setAction(ACTION_CANCEL_SUSPECT);
        PendingIntent cancelIntent = PendingIntent.getService(
            this,
            NOTIFICATION_ID,
            cancel,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("¿Estás bien?")
            .setContentText("Guardian detectó una posible caída. Confirma antes de enviar la alerta.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setOngoing(true)
            .setOnlyAlertOnce(false)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Estoy bien", cancelIntent)
            .build();
    }

    private static long parseEpochMs(String raw) {
        try {
            return Instant.parse(raw).toEpochMilli();
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private static boolean nonEmpty(@Nullable String value) {
        return value != null && !value.trim().isEmpty();
    }
}
