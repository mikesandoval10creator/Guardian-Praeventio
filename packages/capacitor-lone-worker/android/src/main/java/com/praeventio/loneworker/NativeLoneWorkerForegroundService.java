package com.praeventio.loneworker;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.time.Instant;

/**
 * Android-owned ordinary lone-worker protection loop.
 *
 * The WebView only starts/stops a capability-bound session. This service owns
 * the heartbeat schedule and location sampling after the WebView is suspended,
 * queues each event before transport, and restores itself from persisted config
 * after ordinary Android process reclamation. A capability expiry or server
 * revocation is a hard authority boundary; it never revives stale monitoring.
 */
public final class NativeLoneWorkerForegroundService extends Service {
    static final String ACTION_START = "com.praeventio.loneworker.START";
    static final String ACTION_STOP = "com.praeventio.loneworker.STOP";
    static final String EXTRA_PROJECT_ID = "projectId";
    static final String EXTRA_SESSION_ID = "sessionId";
    static final String EXTRA_CAPABILITY = "capability";
    static final String EXTRA_API_BASE_URL = "apiBaseUrl";
    static final String EXTRA_CAPABILITY_EXPIRES_AT = "capabilityExpiresAt";
    static final String EXTRA_HEARTBEAT_INTERVAL_MS = "heartbeatIntervalMs";

    private static final String TAG = "NativeLoneWorker";
    private static final String CHANNEL_ID = "guardian_lone_worker";
    private static final int NOTIFICATION_ID = 4811;
    private static final long DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000L;
    private static final long MIN_HEARTBEAT_INTERVAL_MS = 15_000L;
    private static final long MAX_HEARTBEAT_INTERVAL_MS = 5 * 60_000L;
    private static final String PREFS = "guardian_native_lone_worker_state";
    private static final String PREF_PROJECT = "projectId";
    private static final String PREF_SESSION = "sessionId";
    private static final String PREF_CAPABILITY = "capability";
    private static final String PREF_API_BASE = "apiBaseUrl";
    private static final String PREF_EXPIRES_AT = "capabilityExpiresAt";
    private static final String PREF_INTERVAL = "heartbeatIntervalMs";
    private static final String PREF_LAST_HEARTBEAT = "lastHeartbeatAt";
    private static final String PREF_LAST_ERROR = "lastError";

    private static volatile boolean running;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager locationManager;
    private LocationListener locationListener;
    private Runnable heartbeatRunnable;
    private String projectId;
    private String sessionId;
    private String capability;
    private String apiBaseUrl;
    private long capabilityExpiresAtMs;
    private long heartbeatIntervalMs;
    private Location lastLocation;

    @Override
    public void onCreate() {
        super.onCreate();
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        createChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopMonitoring(true, "explicit_stop");
            return START_NOT_STICKY;
        }

        boolean configured = intent != null && ACTION_START.equals(intent.getAction())
            ? readConfig(intent)
            : readPersistedConfig();
        if (!configured || capabilityExpiresAtMs <= System.currentTimeMillis()) {
            stopMonitoring(false, "capability_expired_or_invalid");
            return START_NOT_STICKY;
        }

        if (!startMonitoring()) {
            stopMonitoring(false, "native_start_failed");
            return START_NOT_STICKY;
        }
        // START_STICKY is only safe because the persisted capability is checked
        // again on null-intent restoration and the server checks it on every
        // delivery. It revives the session loop, not an expired authority.
        return START_STICKY;
    }

    private boolean readConfig(Intent intent) {
        projectId = intent.getStringExtra(EXTRA_PROJECT_ID);
        sessionId = intent.getStringExtra(EXTRA_SESSION_ID);
        capability = intent.getStringExtra(EXTRA_CAPABILITY);
        apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL);
        String expiryRaw = intent.getStringExtra(EXTRA_CAPABILITY_EXPIRES_AT);
        capabilityExpiresAtMs = parseEpochMs(expiryRaw);
        long requestedInterval = intent.getLongExtra(
            EXTRA_HEARTBEAT_INTERVAL_MS,
            DEFAULT_HEARTBEAT_INTERVAL_MS
        );
        heartbeatIntervalMs = clamp(
            requestedInterval,
            MIN_HEARTBEAT_INTERVAL_MS,
            MAX_HEARTBEAT_INTERVAL_MS
        );
        boolean valid = validSegment(projectId)
            && validSegment(sessionId)
            && validCapability(capability)
            && validHttps(apiBaseUrl)
            && capabilityExpiresAtMs > System.currentTimeMillis();
        if (valid) {
            persistConfig();
            clearLastError();
        }
        return valid;
    }

    private boolean readPersistedConfig() {
        SharedPreferences prefs = prefs();
        projectId = prefs.getString(PREF_PROJECT, null);
        sessionId = prefs.getString(PREF_SESSION, null);
        capability = prefs.getString(PREF_CAPABILITY, null);
        apiBaseUrl = prefs.getString(PREF_API_BASE, null);
        capabilityExpiresAtMs = prefs.getLong(PREF_EXPIRES_AT, 0L);
        heartbeatIntervalMs = clamp(
            prefs.getLong(PREF_INTERVAL, DEFAULT_HEARTBEAT_INTERVAL_MS),
            MIN_HEARTBEAT_INTERVAL_MS,
            MAX_HEARTBEAT_INTERVAL_MS
        );
        return validSegment(projectId)
            && validSegment(sessionId)
            && validCapability(capability)
            && validHttps(apiBaseUrl)
            && capabilityExpiresAtMs > System.currentTimeMillis();
    }

    private boolean startMonitoring() {
        if (locationManager != null && locationListener != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (SecurityException ignored) { }
            locationListener = null;
        }
        if (heartbeatRunnable != null) {
            handler.removeCallbacks(heartbeatRunnable);
            heartbeatRunnable = null;
        }
        running = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
            && !hasLocationPermission()) {
            setLastError("location_permission_required");
            return false;
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    buildNotification(),
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                );
            } else {
                startForeground(NOTIFICATION_ID, buildNotification());
            }
        } catch (SecurityException error) {
            setLastError("foreground_location_permission_required");
            Log.w(TAG, "Native lone-worker foreground start rejected", error);
            return false;
        }
        registerLocationUpdates();
        running = true;
        scheduleHeartbeat(0L);
        NativeLoneWorkerRetryWorker.enqueueRetry(getApplicationContext());
        return true;
    }

    private void scheduleHeartbeat(long delayMs) {
        if (heartbeatRunnable != null) handler.removeCallbacks(heartbeatRunnable);
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                if (!running) return;
                if (capabilityExpiresAtMs <= System.currentTimeMillis()) {
                    stopMonitoring(false, "capability_expired");
                    return;
                }
                enqueueHeartbeat();
                handler.postDelayed(this, heartbeatIntervalMs);
            }
        };
        handler.postDelayed(heartbeatRunnable, Math.max(0L, delayMs));
    }

    private void enqueueHeartbeat() {
        try {
            JSONObject payload = new JSONObject();
            payload.put("capturedAt", Instant.now().toString());
            Location location = lastLocation;
            if (location != null) {
                payload.put("lat", location.getLatitude());
                payload.put("lng", location.getLongitude());
            }
            boolean saved = NativeLoneWorkerOutbox.enqueue(
                getApplicationContext(),
                projectId,
                sessionId,
                capability,
                apiBaseUrl,
                payload
            );
            if (!saved) {
                setLastError("native_lone_worker_outbox_persist_failed");
                return;
            }
            prefs().edit()
                .putString(PREF_LAST_HEARTBEAT, Instant.now().toString())
                .remove(PREF_LAST_ERROR)
                .commit();
            NativeLoneWorkerRetryWorker.enqueueRetry(getApplicationContext());
        } catch (Exception error) {
            setLastError("native_lone_worker_heartbeat_enqueue_failed");
            Log.w(TAG, "Native lone-worker heartbeat enqueue failed", error);
        }
    }

    private void registerLocationUpdates() {
        if (locationManager == null || !hasLocationPermission()) return;
        locationListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                lastLocation = new Location(location);
            }
        };
        String provider = null;
        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                provider = LocationManager.GPS_PROVIDER;
            } else if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                provider = LocationManager.NETWORK_PROVIDER;
            }
            if (provider == null) {
                setLastError("location_provider_unavailable");
                return;
            }
            Location cached = locationManager.getLastKnownLocation(provider);
            if (cached != null) lastLocation = new Location(cached);
            locationManager.requestLocationUpdates(
                provider,
                heartbeatIntervalMs,
                0f,
                locationListener,
                Looper.getMainLooper()
            );
        } catch (SecurityException error) {
            setLastError("location_permission_required");
        } catch (Exception error) {
            setLastError("location_updates_unavailable");
            Log.w(TAG, "Native lone-worker location unavailable", error);
        }
    }

    private boolean hasLocationPermission() {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.ACCESS_COARSE_LOCATION
            ) == android.content.pm.PackageManager.PERMISSION_GRANTED;
    }

    private void stopMonitoring(boolean explicit, String reason) {
        running = false;
        if (heartbeatRunnable != null) handler.removeCallbacks(heartbeatRunnable);
        heartbeatRunnable = null;
        if (locationManager != null && locationListener != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (SecurityException ignored) { }
        }
        locationListener = null;
        lastLocation = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        if (explicit || "capability_expired".equals(reason)
            || "capability_expired_or_invalid".equals(reason)) {
            if (projectId != null && sessionId != null) {
                NativeLoneWorkerOutbox.deadLetterSession(
                    getApplicationContext(), projectId, sessionId, reason
                );
            }
            clearPersistedConfig();
        }
        if ("native_start_failed".equals(reason)) setLastError(reason);
        stopSelf();
    }

    static void explicitStop(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String projectId = prefs.getString(PREF_PROJECT, null);
        String sessionId = prefs.getString(PREF_SESSION, null);
        if (projectId != null && sessionId != null) {
            NativeLoneWorkerOutbox.deadLetterSession(
                context,
                projectId,
                sessionId,
                "explicit_stop"
            );
        }
        prefs.edit()
            .remove(PREF_PROJECT)
            .remove(PREF_SESSION)
            .remove(PREF_CAPABILITY)
            .remove(PREF_API_BASE)
            .remove(PREF_EXPIRES_AT)
            .remove(PREF_INTERVAL)
            .commit();
        context.stopService(new Intent(context, NativeLoneWorkerForegroundService.class));
    }

    static void authorityGone(Context context, String projectId, String sessionId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String configuredProject = prefs.getString(PREF_PROJECT, null);
        String configuredSession = prefs.getString(PREF_SESSION, null);
        if (projectId.equals(configuredProject) && sessionId.equals(configuredSession)) {
            NativeLoneWorkerOutbox.deadLetterSession(
                context,
                projectId,
                sessionId,
                "authority_gone"
            );
            prefs.edit()
                .remove(PREF_PROJECT)
                .remove(PREF_SESSION)
                .remove(PREF_CAPABILITY)
                .remove(PREF_API_BASE)
                .remove(PREF_EXPIRES_AT)
                .remove(PREF_INTERVAL)
                .commit();
            context.stopService(new Intent(context, NativeLoneWorkerForegroundService.class));
        }
    }

    static boolean isRunning() {
        return running;
    }

    static NativeLoneWorkerStatusSnapshot status(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        NativeLoneWorkerStatusSnapshot result = new NativeLoneWorkerStatusSnapshot();
        result.running = running;
        result.lastHeartbeatAt = prefs.getString(PREF_LAST_HEARTBEAT, null);
        result.lastError = prefs.getString(PREF_LAST_ERROR, null);
        return result;
    }

    private void persistConfig() {
        prefs().edit()
            .putString(PREF_PROJECT, projectId)
            .putString(PREF_SESSION, sessionId)
            .putString(PREF_CAPABILITY, capability)
            .putString(PREF_API_BASE, apiBaseUrl)
            .putLong(PREF_EXPIRES_AT, capabilityExpiresAtMs)
            .putLong(PREF_INTERVAL, heartbeatIntervalMs)
            .commit();
    }

    private void clearPersistedConfig() {
        prefs().edit()
            .remove(PREF_PROJECT)
            .remove(PREF_SESSION)
            .remove(PREF_CAPABILITY)
            .remove(PREF_API_BASE)
            .remove(PREF_EXPIRES_AT)
            .remove(PREF_INTERVAL)
            .commit();
    }

    private void setLastError(String error) {
        prefs().edit().putString(PREF_LAST_ERROR, error).commit();
    }

    private void clearLastError() {
        prefs().edit().remove(PREF_LAST_ERROR).commit();
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Override
    public void onDestroy() {
        if (locationManager != null && locationListener != null) {
            try {
                locationManager.removeUpdates(locationListener);
            } catch (SecurityException ignored) { }
        }
        if (heartbeatRunnable != null) handler.removeCallbacks(heartbeatRunnable);
        running = false;
        super.onDestroy();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // Do not stop or clear state here. START_STICKY + persisted authority
        // handles normal task removal; explicit session end remains the stop gate.
        super.onTaskRemoved(rootIntent);
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Guardian — Trabajador solitario",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(
            "Heartbeat y ubicación nativos de una sesión de trabajo solitario."
        );
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private Notification buildNotification() {
        return new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle("Guardian activo — Trabajo solitario")
            .setContentText("Heartbeat nativo y ubicación activos mientras la sesión siga abierta.")
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .build();
    }

    private static long parseEpochMs(String raw) {
        if (raw == null) return 0L;
        try {
            return java.time.Instant.parse(raw).toEpochMilli();
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private static long clamp(long value, long min, long max) {
        return Math.max(min, Math.min(max, value));
    }

    private static boolean validHttps(String value) {
        return value != null && value.startsWith("https://") && value.length() <= 512;
    }

    private static boolean validSegment(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{1,200}");
    }

    private static boolean validCapability(String value) {
        return value != null && value.matches("[A-Za-z0-9_-]{32,256}");
    }

    static final class NativeLoneWorkerStatusSnapshot {
        boolean running;
        String lastHeartbeatAt;
        String lastError;
    }
}
